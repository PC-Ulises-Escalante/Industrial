require('dotenv').config({ override: true });
// Force use SQLite for local development by clearing DATABASE_URL
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() === '') {
    process.env.DATABASE_URL = '';
}
const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const jwtLib = require('./lib/jwt');
const dbLib = require('./lib/db');
const os = require('os');

// Optional Supabase Storage client. Configure with SUPABASE_URL and SUPABASE_SERVICE_KEY.
let supabase = null;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'images';
try {
    const { createClient } = require('@supabase/supabase-js');
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        console.log('Supabase storage enabled for uploads');
    }
} catch (e) {
    supabase = null;
    console.log('Supabase client not available (dependency missing) or not configured.');
}

// Helper: intenta guardar una image: primero local, luego Supabase (si está), luego tmpdir.
async function saveImage(dataUrl, subdir) {
    const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) throw new Error('Formato de imagen inválido');
    const mime = m[1];
    const base64 = m[2];
    const ext = mime.split('/')[1].split('+')[0];
    const filename = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '.' + ext;

    // Determine if we're running in a serverless/read-only deployment.
    const isServerlessEnvironment = (process.env.VERCEL === '1') || !!process.env.FUNCTIONS_WORKER_RUNTIME || !!process.env.AWS_REGION || (process.env.DISABLE_LOCAL_IMAGE_SAVE === '1');

    const buffer = Buffer.from(base64, 'base64');

    // If Supabase is configured, try uploading there first (preferred).
    if (supabase) {
        try {
            const bucketPath = `${subdir}/${filename}`;
            const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(bucketPath, buffer, { contentType: mime, upsert: false });
            if (uploadError) throw uploadError;
            const { data: publicUrlData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(bucketPath);
            if (publicUrlData && publicUrlData.publicUrl) {
                console.log(`Supabase upload success: ${publicUrlData.publicUrl}`);
                return publicUrlData.publicUrl;
            }
            // If SDK didn't return publicUrl, try to construct one (common Supabase pattern)
            if (process.env.SUPABASE_URL) {
                const base = process.env.SUPABASE_URL.replace(/\/$/, '');
                return `${base}/storage/v1/object/public/${SUPABASE_BUCKET}/${bucketPath.split('/').map(encodeURIComponent).join('/')}`;
            }
            return null;
        } catch (err) {
            console.warn(`Supabase upload failed for ${subdir}:`, err && err.message ? err.message : err);
            // fallthrough to local/tmp save
        }
    }

    // Next, attempt to save locally when not running in a serverless/read-only environment
    if (!isServerlessEnvironment) {
        try {
            const destDir = path.join(__dirname, 'Images', subdir);
            fs.mkdirSync(destDir, { recursive: true });
            const filepath = path.join(destDir, filename);
            fs.writeFileSync(filepath, buffer);
            // Return an absolute URL path so the browser can load it (express.static serves __dirname)
            return '/' + path.posix.join('Images', subdir, filename);
        } catch (err) {
            console.warn(`Local image save failed for ${subdir}:`, err && err.code ? err.code + ': ' + err.message : err);
        }
    } else {
        console.debug(`Skipping local image save for ${subdir} on serverless environment`);
    }

    // Last-resort: try to write into Images from tmpdir then return web path
    try {
        const tmpDir = path.join(os.tmpdir(), 'entorno_pruebas_images', subdir);
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpPath = path.join(tmpDir, filename);
        fs.writeFileSync(tmpPath, buffer);
        // Attempt to copy into web-accessible Images folder
        try {
            const destDir = path.join(__dirname, 'Images', subdir);
            fs.mkdirSync(destDir, { recursive: true });
            const destPath = path.join(destDir, filename);
            fs.copyFileSync(tmpPath, destPath);
            return '/' + path.posix.join('Images', subdir, filename);
        } catch (copyErr) {
            console.warn('Could not copy tmp image into Images folder:', copyErr && copyErr.message ? copyErr.message : copyErr);
            // As a last fallback, do not return an absolute filesystem path (browser cannot access it)
            return null;
        }
    } catch (err) {
        console.warn('Fallback to tmpdir failed:', err && err.code ? err.code + ': ' + err.message : err);
        return null;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.sqlite');

let db;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
// Ensure API responses are not cached by browsers or CDNs (prevents 304 stale responses)
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});
// Serve the QR scan landing page (GET) so scanner apps that only perform GET requests
// can open a friendly page which will POST to the API to register attendance.
app.get('/qr/scan/:resource/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr-scan.html'));
});
// Session middleware: disable in serverless environments by setting DISABLE_SESSIONS=1
// Auto-disable sessions when running on Vercel (serverless) to avoid MemoryStore timers
const disableSessions = (process.env.DISABLE_SESSIONS === '1') || (process.env.VERCEL === '1') || (process.env.NODE_ENV === 'production' && process.env.DISABLE_SESSIONS !== '0');
if (!disableSessions) {
    app.use(session({
        secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
    }));
    console.log('Sessions ENABLED');
} else {
    console.log('Sessions are disabled (serverless/VERCEL or DISABLE_SESSIONS=1). Using JWT-only auth.');
}

// Request logging middleware to help debug long-running requests
app.use((req, res, next) => {
    const start = Date.now();
    console.log(`[req start] ${req.method} ${req.originalUrl}`);
    res.on('finish', () => {
        console.log(`[req end] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
});

app.use((err, req, res, next) => {
    if (err && err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.warn('Request contained invalid JSON:', err.message);
        return res.status(400).json({ error: 'JSON inválido o malformado' });
    }
    next(err);
});

function getTokenFromReq(req) {
    const auth = req.headers && req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    const cookieHeader = req.headers && req.headers.cookie;
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').map(c => c.trim());
        for (const c of cookies) {
            if (c.startsWith('token=')) return decodeURIComponent(c.split('=')[1]);
        }
    }
    return null;
}

app.use((req, res, next) => {
    const token = getTokenFromReq(req);
    if (token) {
        try { req.jwtUser = jwtLib.verify(token); } catch (e) { req.jwtUser = null; }
    }
    if (req.session && req.session.user) {
        req.user = req.session.user;
    } else if (req.jwtUser) {
        req.user = req.jwtUser;
        if (req.session) req.session.user = req.jwtUser;
    }
    next();
});

app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(204).end();
});

function saveDb() {
    try { return dbLib.saveDb(); } catch (e) { /* ignore */ }
}

function queryOne(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
}

function queryAll(sql, params) {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

async function qOne(sql, params) {
    if (dbLib.usePg) return await dbLib.queryOne(sql, params);
    return queryOne(sql, params);
}

async function qAll(sql, params) {
    if (dbLib.usePg) return await dbLib.queryAll(sql, params);
    return queryAll(sql, params);
}

async function runSql(sql, params) {
    if (dbLib.usePg) return await dbLib.run(sql, params);
    const r = db.run(sql, params);
    saveDb();
    return r;
}

function requireRole(...roles) {
    return (req, res, next) => {
        const user = req.user || (req.session && req.session.user) || req.jwtUser;
        if (!user) return res.status(401).json({ error: 'No autenticado' });
        if (!roles.includes(user.rol)) return res.status(403).json({ error: 'No autorizado' });
        next();
    };
}

/* ══════════════════════════════════════════
   API ROUTES
   ══════════════════════════════════════════ */

app.post('/api/login', async (req, res) => {
    const start = Date.now();
    const { email, password } = req.body || {};
    console.log('[login] start', { ip: req.ip, email: email ? email.toLowerCase() : null });
    if (!email || !password) {
        console.log('[login] missing email or password');
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    try {
        const lookupStart = Date.now();
        console.log('[login] lookup user start');
        const user = await qOne('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        console.log('[login] lookup user done', { durationMs: Date.now() - lookupStart, found: !!user, userId: user ? user.id : null });

        if (!user) {
            console.log('[login] user not found');
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const bcryptStart = Date.now();
        let match;
        try {
            match = await new Promise((resolve, reject) => {
                bcrypt.compare(password, user.password, (err, ok) => {
                    if (err) return reject(err);
                    resolve(ok);
                });
            });
            console.log('[login] bcrypt.compare done', { durationMs: Date.now() - bcryptStart, match });
        } catch (err) {
            console.error('[login] bcrypt.compare error', err && err.stack ? err.stack : err);
            return res.status(500).json({ error: 'Error interno' });
        }

        if (!match) {
            console.log('[login] password mismatch for user', user.id);
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        const sessionUser = { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol };
        if (req.session) req.session.user = sessionUser;

        try {
            const signStart = Date.now();
            const token = jwtLib.sign(sessionUser);
            console.log('[login] token signed', { durationMs: Date.now() - signStart });
            res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
            res.json({ user: sessionUser, token });
            console.log('[login] success', { userId: user.id, durationMs: Date.now() - start });
        } catch (err) {
            console.error('[login] token sign error', err && err.stack ? err.stack : err);
            res.json({ user: sessionUser });
        }
    } catch (err) {
        console.error('[login] unexpected error', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/logout', (req, res) => {
    if (req.session && typeof req.session.destroy === 'function') {
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.clearCookie('token');
            res.json({ ok: true });
        });
    } else {
        // Sessions disabled or not available — clear token cookie and return OK
        try { res.clearCookie('token'); } catch (e) { /* ignore */ }
        res.json({ ok: true });
    }
});

app.get('/api/session', (req, res) => {
    try {
        console.log('[session] start', { ip: req.ip, hasSession: !!(req.session && req.session.user), hasJwt: !!req.jwtUser });
        const user = req.session && req.session.user ? req.session.user : (req.jwtUser || null);
        res.json({ user });
        console.log('[session] responded', { userId: user ? user.id : null });
    } catch (err) {
        console.error('[session] error', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Error interno' });
    }
});

app.post('/api/register', async (req, res) => {
    const { nombre, email, rol, numero_control, semestre, sexo, horario, edad, password } = req.body;

    if (!nombre || !email) {
        return res.status(400).json({ error: 'Nombre y email son requeridos' });
    }

    const userRol = (rol === 'invitado') ? 'invitado' : 'alumno';

    let plainPassword;
    if (password) {
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
        }
        plainPassword = password;
    } else {
        plainPassword = email.split('@')[0] + '2026';
    }

    const hash = await bcrypt.hash(plainPassword, 10);

    const existing = await dbLib.queryOne('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Este correo ya está registrado' });

    try {
        const params = [nombre.trim(), email.trim().toLowerCase(), hash, userRol,
        numero_control || null, semestre ? parseInt(semestre) : null,
        sexo || null, horario || null, edad ? parseInt(edad) : null];

        if (dbLib.usePg) {
            const inserted = await dbLib.queryOne('INSERT INTO users (nombre, email, password, rol, numero_control, semestre, sexo, horario, edad) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', params);
            res.json({ id: inserted ? inserted.id : 0, message: 'Registro exitoso' });
        } else {
            await runSql(
                'INSERT INTO users (nombre, email, password, rol, numero_control, semestre, sexo, horario, edad) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                params
            );
            const newUser = await qOne('SELECT last_insert_rowid() as id');
            saveDb();
            res.json({ id: newUser ? newUser.id : 0, message: 'Registro exitoso' });
        }
    } catch (err) {
        console.error('Error registering user:', err);
        return res.status(500).json({ error: 'Error al registrar' });
    }
});

app.get('/api/users', requireRole('administrador', 'maestro'), async (req, res) => {
    try {
        const users = await dbLib.queryAll('SELECT id, nombre, email, rol, numero_control, semestre, sexo, horario, edad, created_at FROM users ORDER BY created_at DESC');
        res.json(users);
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/users/email/:email', async (req, res) => {
    try {
        const email = req.params.email.trim().toLowerCase();
        const user = await dbLib.queryOne('SELECT id, nombre, email, rol FROM users WHERE email = ?', [email]);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user);
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/users/:id', requireRole('administrador'), async (req, res) => {
    const { rol } = req.body;
    const validRoles = ['alumno', 'invitado', 'maestro', 'administrador'];
    if (!rol || !validRoles.includes(rol)) {
        return res.status(400).json({ error: 'Rol inválido' });
    }
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID inválido' });

    try {
        if (dbLib.usePg) await dbLib.run('UPDATE users SET rol = ? WHERE id = ?', [rol, userId]);
        else { await runSql('UPDATE users SET rol = ? WHERE id = ?', [rol, userId]); saveDb(); }
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/users/:id', requireRole('administrador'), async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID inválido' });
    const currentUserId = (req.user && req.user.id) || (req.session && req.session.user && req.session.user.id);
    if (userId === currentUserId) return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    try {
        if (dbLib.usePg) await dbLib.run('DELETE FROM users WHERE id = ?', [userId]);
        else { await runSql('DELETE FROM users WHERE id = ?', [userId]); saveDb(); }
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/stats', requireRole('administrador', 'maestro'), async (req, res) => {
    try {
        const totalRow = await dbLib.queryOne('SELECT COUNT(*) as c FROM users');
        const total = totalRow ? totalRow.c : 0;
        const alumnosRow = await dbLib.queryOne("SELECT COUNT(*) as c FROM users WHERE rol='alumno'");
        const alumnos = alumnosRow ? alumnosRow.c : 0;
        const invitadosRow = await dbLib.queryOne("SELECT COUNT(*) as c FROM users WHERE rol='invitado'");
        const invitados = invitadosRow ? invitadosRow.c : 0;
        const maestrosRow = await dbLib.queryOne("SELECT COUNT(*) as c FROM users WHERE rol='maestro'");
        const maestros = maestrosRow ? maestrosRow.c : 0;
        const adminsRow = await dbLib.queryOne("SELECT COUNT(*) as c FROM users WHERE rol='administrador'");
        const admins = adminsRow ? adminsRow.c : 0;

        const recent = await dbLib.queryAll('SELECT id, nombre, email, rol, created_at FROM users ORDER BY created_at DESC LIMIT 10');
        const horarios = await dbLib.queryAll("SELECT horario, COUNT(*) as count FROM users WHERE horario IS NOT NULL AND horario != '' GROUP BY horario ORDER BY count DESC");
        const semestres = await dbLib.queryAll("SELECT semestre, COUNT(*) as count FROM users WHERE semestre IS NOT NULL GROUP BY semestre ORDER BY semestre ASC");
        const roles = await dbLib.queryAll("SELECT rol, COUNT(*) as count FROM users GROUP BY rol ORDER BY count DESC");

        let registrosDiarios;
        if (dbLib.usePg) {
            registrosDiarios = await dbLib.queryAll("SELECT DATE(created_at) as fecha, COUNT(*) as count FROM users WHERE created_at >= now() - interval '7 days' GROUP BY DATE(created_at) ORDER BY fecha ASC");
        } else {
            registrosDiarios = await dbLib.queryAll("SELECT DATE(created_at) as fecha, COUNT(*) as count FROM users WHERE created_at >= DATE('now', '-7 days') GROUP BY DATE(created_at) ORDER BY fecha ASC");
        }

        res.json({ total, alumnos, invitados, maestros, admins, recent, horarios, semestres, roles, registrosDiarios });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener estadísticas' }); }
});

app.get('/api/ponentes', async (req, res) => {
    try {
        const rows = await dbLib.queryAll('SELECT id, nombre, profesion, topic_title, topic_desc, foto_path, linkedin, facebook, instagram, created_at FROM ponentes ORDER BY id DESC');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/ponentes', requireRole('administrador'), async (req, res) => {
    const { nombre, profesion, topic_title, topic_desc, linkedin, facebook, instagram, imageData } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre es requerido' });

    let fotoPath = null;
    if (imageData) {
        try {
            fotoPath = await saveImage(imageData, 'ponentes');
        } catch (err) {
            if (err && err.message === 'Formato de imagen inválido') return res.status(400).json({ error: 'Formato de imagen inválido' });
            console.warn('No se pudo guardar la imagen de ponente:', err && err.message ? err.message : err);
            fotoPath = null;
        }
    }

    try {
        const params = [nombre.trim(), profesion || null, topic_title || null, topic_desc || null, fotoPath, linkedin || null, facebook || null, instagram || null];
        if (dbLib.usePg) {
            const inserted = await dbLib.queryOne('INSERT INTO ponentes (nombre, profesion, topic_title, topic_desc, foto_path, linkedin, facebook, instagram) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', params);
            res.json({ id: inserted ? inserted.id : null, ok: true });
        } else {
            await runSql('INSERT INTO ponentes (nombre, profesion, topic_title, topic_desc, foto_path, linkedin, facebook, instagram) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', params);
            const newRow = await qOne('SELECT last_insert_rowid() as id');
            saveDb();
            res.json({ id: newRow ? newRow.id : null, ok: true });
        }
    } catch (err) {
        console.error('Error creating ponente:', err);
        res.status(500).json({ error: 'Error al crear ponente' });
    }
});

app.get('/api/conferencias', async (req, res) => {
    try {
        const rows = await qAll(`
            SELECT c.*, COUNT(ci.id) as inscritos
            FROM conferencias c
            LEFT JOIN conferencias_inscripciones ci ON c.id = ci.conferencia_id
            GROUP BY c.id
            ORDER BY c.fecha ASC, c.created_at DESC
        `);
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.post('/api/conferencias', requireRole('administrador'), async (req, res) => {
    const { titulo, fecha, lugar, descripcion, ponente_nombre, ponente_profesion, imageData } = req.body;
    if (!titulo || !fecha || !lugar) {
        return res.status(400).json({ error: 'Título, fecha y lugar son requeridos' });
    }

    let fotoEventoPath = null;
    if (imageData) {
        try {
            fotoEventoPath = await saveImage(imageData, 'eventos');
        } catch (err) {
            if (err && err.message === 'Formato de imagen inválido') return res.status(400).json({ error: 'Formato de imagen inválido' });
            console.warn('No se pudo guardar la imagen del evento:', err && err.message ? err.message : err);
            fotoEventoPath = null;
        }
    }

    try {
        const params = [titulo.trim(), fecha, lugar.trim(), descripcion || null, ponente_nombre || null, ponente_profesion || null, fotoEventoPath];
        if (dbLib.usePg) {
            const inserted = await dbLib.queryOne('INSERT INTO conferencias (titulo, fecha, lugar, descripcion, ponente_nombre, ponente_profesion, foto_evento) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', params);
            res.json({ id: inserted ? inserted.id : null, ok: true });
        } else {
            await runSql('INSERT INTO conferencias (titulo, fecha, lugar, descripcion, ponente_nombre, ponente_profesion, foto_evento) VALUES (?, ?, ?, ?, ?, ?, ?)', params);
            const newRow = await qOne('SELECT last_insert_rowid() as id');
            saveDb();
            res.json({ id: newRow ? newRow.id : null, ok: true });
        }
    } catch (err) {
        console.error('Error creating conferencia:', err);
        res.status(500).json({ error: 'Error al crear conferencia' });
    }
});

// Get single conference
app.get('/api/conferencias/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
        const row = await qOne('SELECT * FROM conferencias WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: 'Conferencia no encontrada' });
        res.json(row);
    } catch (err) {
        console.error('Error getting conferencia:', err);
        res.status(500).json({ error: 'Error' });
    }
});

// Update conference
app.put('/api/conferencias/:id', requireRole('administrador'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const { titulo, fecha, lugar, descripcion, ponente_nombre, ponente_profesion, imageData } = req.body || {};
    if (!titulo || !fecha || !lugar) return res.status(400).json({ error: 'Título, fecha y lugar son requeridos' });

    try {
        let fotoEventoPath = null;
        if (imageData) {
            try {
                fotoEventoPath = await saveImage(imageData, 'eventos');
            } catch (err) {
                console.warn('No se pudo guardar la imagen del evento (update):', err && err.message ? err.message : err);
                fotoEventoPath = null;
            }
        }

        const params = [titulo.trim(), fecha, lugar.trim(), descripcion || null, ponente_nombre || null, ponente_profesion || null, fotoEventoPath, id];
        if (dbLib.usePg) {
            // If fotoEventoPath is null, we should avoid overwriting existing foto_evento with null.
            if (fotoEventoPath === null) {
                await dbLib.run('UPDATE conferencias SET titulo = ?, fecha = ?, lugar = ?, descripcion = ?, ponente_nombre = ?, ponente_profesion = ? WHERE id = ?', [titulo.trim(), fecha, lugar.trim(), descripcion || null, ponente_nombre || null, ponente_profesion || null, id]);
            } else {
                await dbLib.run('UPDATE conferencias SET titulo = ?, fecha = ?, lugar = ?, descripcion = ?, ponente_nombre = ?, ponente_profesion = ?, foto_evento = ? WHERE id = ?', params);
            }
            res.json({ ok: true });
        } else {
            if (fotoEventoPath === null) {
                await runSql('UPDATE conferencias SET titulo = ?, fecha = ?, lugar = ?, descripcion = ?, ponente_nombre = ?, ponente_profesion = ? WHERE id = ?', [titulo.trim(), fecha, lugar.trim(), descripcion || null, ponente_nombre || null, ponente_profesion || null, id]);
            } else {
                await runSql('UPDATE conferencias SET titulo = ?, fecha = ?, lugar = ?, descripcion = ?, ponente_nombre = ?, ponente_profesion = ?, foto_evento = ? WHERE id = ?', params);
            }
            saveDb();
            res.json({ ok: true });
        }
    } catch (err) {
        console.error('Error updating conferencia:', err);
        res.status(500).json({ error: 'Error al actualizar conferencia' });
    }
});

app.post('/api/conferencias/inscribir', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });
    const { conferencia_id } = req.body;
    if (!conferencia_id) return res.status(400).json({ error: 'ID de conferencia requerido' });

    try {
        const existing = await qOne('SELECT id FROM conferencias_inscripciones WHERE conferencia_id = ? AND user_id = ?', [conferencia_id, currentUser.id]);
        if (existing) return res.status(400).json({ error: 'Ya estás inscrito en esta conferencia' });
        await runSql('INSERT INTO conferencias_inscripciones (conferencia_id, user_id) VALUES (?, ?)', [conferencia_id, currentUser.id]);
        saveDb();
        res.json({ ok: true });
    } catch (err) {
        console.error('Error inscribiendo a conferencia:', err);
        res.status(500).json({ error: 'Error al inscribirse' });
    }
});

app.get('/api/conferencias/inscripciones/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: 'ID de usuario inválido' });
    try {
        const rows = await qAll('SELECT conferencia_id FROM conferencias_inscripciones WHERE user_id = ?', [userId]);
        res.json(rows.map(r => r.conferencia_id));
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

/* ── Generar o actualizar QR para una conferencia ── */
app.post('/api/conferencias/:id/qr', requireRole('administrador', 'maestro'), async (req, res) => {
    const conferenciaId = parseInt(req.params.id);
    if (isNaN(conferenciaId)) return res.status(400).json({ error: 'ID de conferencia inválido' });

    const conferencia = await qOne('SELECT id FROM conferencias WHERE id = ?', [conferenciaId]);
    if (!conferencia) return res.status(404).json({ error: 'Conferencia no encontrada' });

    try {
        const qrToken = uuidv4();
        // New: point QR to a landing page that will POST to the API (`/qr/scan/:resource/:token`)
        const qrUrl = `${req.protocol}://${req.get('host')}/qr/scan/conferencias/${qrToken}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });

        const existing = await qOne('SELECT id FROM conferencia_qr_codes WHERE conferencia_id = ?', [conferenciaId]);
        if (existing) {
            // FIX: Use correct SQL dialect for UPDATE
            if (dbLib.usePg) {
                await dbLib.run("UPDATE conferencia_qr_codes SET qr_token = ?, qr_data_url = ?, expires_at = now() + interval '14 days' WHERE conferencia_id = ?", [qrToken, qrDataUrl, conferenciaId]);
            } else {
                await runSql('UPDATE conferencia_qr_codes SET qr_token = ?, qr_data_url = ?, expires_at = datetime("now", "+14 days") WHERE conferencia_id = ?', [qrToken, qrDataUrl, conferenciaId]);
            }
        } else {
            // FIX: Use correct interval syntax for Postgres INSERT
            if (dbLib.usePg) {
                await dbLib.queryOne("INSERT INTO conferencia_qr_codes (conferencia_id, qr_token, qr_data_url, expires_at) VALUES (?, ?, ?, now() + interval '14 days') RETURNING id", [conferenciaId, qrToken, qrDataUrl]);
            } else {
                await runSql('INSERT INTO conferencia_qr_codes (conferencia_id, qr_token, qr_data_url, expires_at) VALUES (?, ?, ?, datetime("now", "+14 days"))', [conferenciaId, qrToken, qrDataUrl]);
            }
        }
        saveDb();

        res.json({
            qr_token: qrToken,
            qr_data_url: qrDataUrl,
            scan_url: qrUrl,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });
    } catch (err) {
        console.error('Error generando QR:', err);
        res.status(500).json({ error: 'Error al generar QR' });
    }
});

app.get('/api/conferencias/:id/qr', requireRole('administrador', 'maestro'), async (req, res) => {
    const conferenciaId = parseInt(req.params.id);
    if (isNaN(conferenciaId)) return res.status(400).json({ error: 'ID de conferencia inválido' });
    const qrData = await qOne('SELECT qr_token, qr_data_url, expires_at FROM conferencia_qr_codes WHERE conferencia_id = ?', [conferenciaId]);
    if (!qrData) return res.status(404).json({ error: 'QR no generado para esta conferencia' });
    // Compute scan_url from stored token (same format as POST endpoint)
    qrData.scan_url = `${req.protocol}://${req.get('host')}/qr/scan/conferencias/${qrData.qr_token}`;
    res.json(qrData);
});

app.post('/api/conferencias/qr/scan/:token', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token de QR requerido' });

    const qrInfo = await qOne('SELECT conferencia_id, expires_at FROM conferencia_qr_codes WHERE qr_token = ?', [token]);
    if (!qrInfo) return res.status(404).json({ error: 'QR inválido o expirado' });

    if (qrInfo.expires_at && new Date(qrInfo.expires_at) < new Date()) {
        return res.status(400).json({ error: 'QR expirado' });
    }

    const conferenciaId = qrInfo.conferencia_id;
    const userId = currentUser.id;

    const user = await qOne('SELECT rol, horario FROM users WHERE id = ?', [userId]);
    if (!user || user.rol !== 'alumno') {
        return res.status(403).json({ error: 'Solo alumnos pueden registrar asistencia' });
    }

    const horario = user.horario;
    const maxAsistencias = (horario === 'vespertino') ? 4 : 2;

    const countResult = await qOne('SELECT COUNT(*) as count FROM asistencias_conferencias WHERE user_id = ?', [userId]);
    const asistenciasActuales = countResult ? parseInt(countResult.count) : 0;

    if (asistenciasActuales >= maxAsistencias) {
        return res.status(400).json({
            error: `Límite de asistencias alcanzado. Máximo ${maxAsistencias} asistencias para horario ${horario}.`,
            current: asistenciasActuales,
            max: maxAsistencias
        });
    }

    const yaAsistio = await qOne('SELECT id FROM asistencias_conferencias WHERE conferencia_id = ? AND user_id = ?', [conferenciaId, userId]);
    if (yaAsistio) {
        return res.status(400).json({ error: 'Ya has registrado asistencia a esta conferencia' });
    }

    try {
        await dbLib.runTransaction(async (tx) => {
            if (dbLib.usePg) {
                await tx.queryWithPlaceholders('INSERT INTO asistencias_conferencias (conferencia_id, user_id, qr_token) VALUES (?, ?, ?)', [conferenciaId, userId, token]);
            } else {
                tx.run('INSERT INTO asistencias_conferencias (conferencia_id, user_id, qr_token) VALUES (?, ?, ?)', [conferenciaId, userId, token]);
            }
        });
        if (!dbLib.usePg) saveDb();

        const conferencia = await qOne('SELECT titulo, fecha, lugar FROM conferencias WHERE id = ?', [conferenciaId]);
        res.json({ success: true, message: 'Asistencia registrada exitosamente', conferencia, asistencias_actuales: asistenciasActuales + 1, max_asistencias: maxAsistencias });
    } catch (err) {
        console.error('Error registrando asistencia:', err);
        res.status(500).json({ error: 'Error al registrar asistencia' });
    }
});

app.get('/api/conferencias/asistencias/:userId?', async (req, res) => {
    let userId = parseInt(req.params.userId);
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (isNaN(userId)) {
        if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });
        userId = currentUser.id;
    } else {
        if (!currentUser || (currentUser.rol !== 'administrador' && currentUser.rol !== 'maestro' && currentUser.id !== userId)) {
            return res.status(403).json({ error: 'No autorizado' });
        }
    }

    try {
        const asistencias = await qAll(`
            SELECT ac.*, c.titulo, c.fecha, c.lugar
            FROM asistencias_conferencias ac
            JOIN conferencias c ON ac.conferencia_id = c.id
            WHERE ac.user_id = ?
            ORDER BY ac.scanned_at DESC
        `, [userId]);

        const user = await qOne('SELECT rol, horario FROM users WHERE id = ?', [userId]);
        const horario = user ? user.horario : null;
        const maxAsistencias = (horario === 'vespertino') ? 4 : 2;

        res.json({ user_id: userId, horario, asistencias, total: asistencias.length, max_asistencias: maxAsistencias, min_asistencias: 1, disponible: Math.max(0, maxAsistencias - asistencias.length) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.get('/api/conferencias/:id/asistencias', requireRole('administrador', 'maestro'), async (req, res) => {
    const conferenciaId = parseInt(req.params.id);
    if (isNaN(conferenciaId)) return res.status(400).json({ error: 'ID de conferencia inválido' });
    try {
        const asistencias = await qAll(`
            SELECT ac.*, u.nombre, u.email, u.numero_control, u.horario
            FROM asistencias_conferencias ac
            JOIN users u ON ac.user_id = u.id
            WHERE ac.conferencia_id = ?
            ORDER BY ac.scanned_at DESC
        `, [conferenciaId]);
        res.json({ conferencia_id: conferenciaId, total_asistencias: asistencias.length, asistencias });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

/* ── Deportes ── */
app.get('/api/deportes/equipos', async (req, res) => {
    try {
        let sql;
        if (dbLib.usePg) {
            sql = `
                SELECT e.*, COUNT(ei.id) as integrantes_count,
                       string_agg(u.nombre || '|' || u.email, ',') as integrantes_info
                FROM deportes_equipos e
                LEFT JOIN deportes_equipo_integrantes ei ON e.id = ei.equipo_id
                LEFT JOIN users u ON ei.user_id = u.id
                GROUP BY e.id ORDER BY e.created_at DESC
            `;
        } else {
            sql = `
                SELECT e.*, COUNT(ei.id) as integrantes_count,
                       GROUP_CONCAT(u.nombre || '|' || u.email) as integrantes_info
                FROM deportes_equipos e
                LEFT JOIN deportes_equipo_integrantes ei ON e.id = ei.equipo_id
                LEFT JOIN users u ON ei.user_id = u.id
                GROUP BY e.id ORDER BY e.created_at DESC
            `;
        }
        const rows = await qAll(sql);
        const equipos = rows.map(e => {
            const integrantes = [];
            if (e.integrantes_info) {
                e.integrantes_info.split(',').forEach(p => {
                    const [nombre, email] = p.split('|');
                    if (nombre && email) integrantes.push({ nombre, email });
                });
            }
            return { ...e, integrantes, integrantes_count: parseInt(e.integrantes_count) || 0 };
        });
        res.json(equipos);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.post('/api/deportes/equipos', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });
    const { nombre, deporte, dias, integrantes } = req.body;
    if (!nombre || !deporte || !dias || !Array.isArray(integrantes) || integrantes.length === 0) {
        return res.status(400).json({ error: 'Nombre, deporte, días e integrantes son requeridos' });
    }
    if (!['futbol', 'basquetbol'].includes(deporte)) {
        return res.status(400).json({ error: 'Deporte inválido' });
    }
    const creatorId = currentUser.id;
    const allIntegrantes = [...new Set([creatorId, ...integrantes.map(id => parseInt(id))])];

    try {
        const equipoId = await dbLib.runTransaction(async (tx) => {
            if (dbLib.usePg) {
                const inserted = await tx.queryWithPlaceholders('INSERT INTO deportes_equipos (nombre, deporte, dias, created_by_user_id) VALUES (?, ?, ?, ?) RETURNING id', [nombre.trim(), deporte, dias.join(','), creatorId]);
                const id = inserted && inserted.rows && inserted.rows[0] ? inserted.rows[0].id : null;
                for (const userId of allIntegrantes) {
                    await tx.queryWithPlaceholders('INSERT INTO deportes_equipo_integrantes (equipo_id, user_id) VALUES (?, ?)', [id, userId]);
                }
                return id;
            } else {
                tx.run('INSERT INTO deportes_equipos (nombre, deporte, dias, created_by_user_id) VALUES (?, ?, ?, ?)', [nombre.trim(), deporte, dias.join(','), creatorId]);
                const result = tx.exec('SELECT last_insert_rowid() as id');
                const id = result && result.length > 0 && result[0].values && result[0].values.length > 0 ? result[0].values[0][0] : null;
                allIntegrantes.forEach(userId => tx.run('INSERT INTO deportes_equipo_integrantes (equipo_id, user_id) VALUES (?, ?)', [id, userId]));
                return id;
            }
        });
        if (!dbLib.usePg) saveDb();
        res.json({ id: equipoId, ok: true });
    } catch (err) {
        console.error('Error creating equipo:', err);
        res.status(500).json({ error: 'Error al crear equipo' });
    }
});

/* ── Generar o actualizar QR para un equipo ── */
app.post('/api/deportes/equipos/:id/qr', requireRole('administrador', 'maestro'), async (req, res) => {
    const equipoId = parseInt(req.params.id);
    if (isNaN(equipoId)) return res.status(400).json({ error: 'ID de equipo inválido' });

    const equipo = await qOne('SELECT id FROM deportes_equipos WHERE id = ?', [equipoId]);
    if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });

    try {
        const qrToken = uuidv4();
        const qrUrl = `${req.protocol}://${req.get('host')}/qr/scan/deportes/${qrToken}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });

        const existing = await qOne('SELECT id FROM deportes_qr_codes WHERE equipo_id = ?', [equipoId]);
        if (existing) {
            // FIX: Use correct SQL dialect for UPDATE
            if (dbLib.usePg) {
                await dbLib.run("UPDATE deportes_qr_codes SET qr_token = ?, qr_data_url = ?, expires_at = now() + interval '14 days' WHERE equipo_id = ?", [qrToken, qrDataUrl, equipoId]);
            } else {
                await runSql('UPDATE deportes_qr_codes SET qr_token = ?, qr_data_url = ?, expires_at = datetime("now", "+14 days") WHERE equipo_id = ?', [qrToken, qrDataUrl, equipoId]);
            }
        } else {
            // FIX: Use correct interval syntax for Postgres INSERT
            if (dbLib.usePg) {
                await dbLib.queryOne("INSERT INTO deportes_qr_codes (equipo_id, qr_token, qr_data_url, expires_at) VALUES (?, ?, ?, now() + interval '14 days') RETURNING id", [equipoId, qrToken, qrDataUrl]);
            } else {
                await runSql('INSERT INTO deportes_qr_codes (equipo_id, qr_token, qr_data_url, expires_at) VALUES (?, ?, ?, datetime("now", "+14 days"))', [equipoId, qrToken, qrDataUrl]);
            }
        }
        saveDb();

        res.json({
            qr_token: qrToken,
            qr_data_url: qrDataUrl,
            scan_url: qrUrl,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });
    } catch (err) {
        console.error('Error generando QR para equipo:', err);
        res.status(500).json({ error: 'Error al generar QR' });
    }
});

app.get('/api/deportes/equipos/:id/qr', requireRole('administrador', 'maestro'), async (req, res) => {
    const equipoId = parseInt(req.params.id);
    if (isNaN(equipoId)) return res.status(400).json({ error: 'ID de equipo inválido' });
    const qrData = await qOne('SELECT qr_token, qr_data_url, expires_at FROM deportes_qr_codes WHERE equipo_id = ?', [equipoId]);
    if (!qrData) return res.status(404).json({ error: 'QR no generado para este equipo' });
    res.json(qrData);
});

app.post('/api/deportes/qr/scan/:token', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token de QR requerido' });

    const qrInfo = await qOne('SELECT equipo_id, expires_at FROM deportes_qr_codes WHERE qr_token = ?', [token]);
    if (!qrInfo) return res.status(404).json({ error: 'QR inválido o expirado' });

    if (qrInfo.expires_at && new Date(qrInfo.expires_at) < new Date()) {
        return res.status(400).json({ error: 'QR expirado' });
    }

    const equipoId = qrInfo.equipo_id;
    const userId = currentUser.id;

    const user = await qOne('SELECT rol, horario FROM users WHERE id = ?', [userId]);
    if (!user || user.rol !== 'alumno') {
        return res.status(403).json({ error: 'Solo alumnos pueden registrar asistencia' });
    }

    const horario = user.horario;
    const maxAsistencias = (horario === 'vespertino') ? 4 : 2;

    const countResult = await qOne('SELECT COUNT(*) as count FROM asistencias_deportes WHERE user_id = ?', [userId]);
    const asistenciasActuales = countResult ? parseInt(countResult.count) : 0;

    if (asistenciasActuales >= maxAsistencias) {
        return res.status(400).json({ error: `Límite de asistencias a deportes alcanzado. Máximo ${maxAsistencias} asistencias para horario ${horario}.`, current: asistenciasActuales, max: maxAsistencias });
    }

    const yaAsistio = await qOne('SELECT id FROM asistencias_deportes WHERE equipo_id = ? AND user_id = ?', [equipoId, userId]);
    if (yaAsistio) {
        return res.status(400).json({ error: 'Ya has registrado asistencia a este equipo deportivo' });
    }

    try {
        await dbLib.runTransaction(async (tx) => {
            if (dbLib.usePg) {
                await tx.queryWithPlaceholders('INSERT INTO asistencias_deportes (equipo_id, user_id, qr_token) VALUES (?, ?, ?)', [equipoId, userId, token]);
            } else {
                tx.run('INSERT INTO asistencias_deportes (equipo_id, user_id, qr_token) VALUES (?, ?, ?)', [equipoId, userId, token]);
            }
        });
        if (!dbLib.usePg) saveDb();
        const equipo = await qOne('SELECT nombre, deporte, dias FROM deportes_equipos WHERE id = ?', [equipoId]);
        res.json({ success: true, message: 'Asistencia a deporte registrada exitosamente', equipo, asistencias_actuales: asistenciasActuales + 1, max_asistencias: maxAsistencias });
    } catch (err) {
        console.error('Error registrando asistencia a deporte:', err);
        res.status(500).json({ error: 'Error al registrar asistencia' });
    }
});

app.get('/api/deportes/asistencias/:userId?', async (req, res) => {
    let userId = parseInt(req.params.userId);
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (isNaN(userId)) {
        if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });
        userId = currentUser.id;
    } else {
        if (!currentUser || (currentUser.rol !== 'administrador' && currentUser.rol !== 'maestro' && currentUser.id !== userId)) {
            return res.status(403).json({ error: 'No autorizado' });
        }
    }
    try {
        const asistencias = await qAll(`
            SELECT ad.*, e.nombre, e.deporte, e.dias
            FROM asistencias_deportes ad
            JOIN deportes_equipos e ON ad.equipo_id = e.id
            WHERE ad.user_id = ?
            ORDER BY ad.scanned_at DESC
        `, [userId]);
        const user = await qOne('SELECT rol, horario FROM users WHERE id = ?', [userId]);
        const horario = user ? user.horario : null;
        const maxAsistencias = (horario === 'vespertino') ? 4 : 2;
        res.json({ user_id: userId, horario, asistencias, total: asistencias.length, max_asistencias: maxAsistencias, min_asistencias: 1, disponible: Math.max(0, maxAsistencias - asistencias.length) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.get('/api/deportes/equipos/:id/asistencias', requireRole('administrador', 'maestro'), async (req, res) => {
    const equipoId = parseInt(req.params.id);
    if (isNaN(equipoId)) return res.status(400).json({ error: 'ID de equipo inválido' });
    try {
        const asistencias = await qAll(`
            SELECT ad.*, u.nombre, u.email, u.numero_control, u.horario
            FROM asistencias_deportes ad
            JOIN users u ON ad.user_id = u.id
            WHERE ad.equipo_id = ?
            ORDER BY ad.scanned_at DESC
        `, [equipoId]);
        res.json({ equipo_id: equipoId, total_asistencias: asistencias.length, asistencias });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

/* ── Proyectos ── */
app.get('/api/proyectos', async (req, res) => {
    try {
        let sql;
        if (dbLib.usePg) {
            sql = `
                SELECT p.*, COUNT(pi.id) as integrantes_count,
                       string_agg(u.nombre || '|' || u.email, ',') as integrantes_info
                FROM proyectos p
                LEFT JOIN proyecto_integrantes pi ON p.id = pi.proyecto_id
                LEFT JOIN users u ON pi.user_id = u.id
                GROUP BY p.id ORDER BY p.created_at DESC
            `;
        } else {
            sql = `
                SELECT p.*, COUNT(pi.id) as integrantes_count,
                       GROUP_CONCAT(u.nombre || '|' || u.email) as integrantes_info
                FROM proyectos p
                LEFT JOIN proyecto_integrantes pi ON p.id = pi.proyecto_id
                LEFT JOIN users u ON pi.user_id = u.id
                GROUP BY p.id ORDER BY p.created_at DESC
            `;
        }
        const rows = await qAll(sql);
        const proyectos = rows.map(p => {
            const integrantes = [];
            if (p.integrantes_info) {
                p.integrantes_info.split(',').forEach(part => {
                    const [nombre, email] = part.split('|');
                    if (nombre && email) integrantes.push({ nombre, email });
                });
            }
            return { ...p, integrantes, integrantes_count: parseInt(p.integrantes_count) || 0 };
        });
        res.json(proyectos);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.post('/api/proyectos', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });
    const { nombre, descripcion, integrantes } = req.body;
    if (!nombre || !descripcion || !Array.isArray(integrantes) || integrantes.length === 0) {
        return res.status(400).json({ error: 'Nombre, descripción e integrantes son requeridos' });
    }
    const creatorId = currentUser.id;
    const allIntegrantes = [...new Set([creatorId, ...integrantes.map(id => parseInt(id))])];

    try {
        const proyectoId = await dbLib.runTransaction(async (tx) => {
            if (dbLib.usePg) {
                const inserted = await tx.queryWithPlaceholders('INSERT INTO proyectos (nombre, descripcion, created_by_user_id) VALUES (?, ?, ?) RETURNING id', [nombre.trim(), descripcion.trim(), creatorId]);
                const id = inserted && inserted.rows && inserted.rows[0] ? inserted.rows[0].id : null;
                for (const userId of allIntegrantes) {
                    await tx.queryWithPlaceholders('INSERT INTO proyecto_integrantes (proyecto_id, user_id) VALUES (?, ?)', [id, userId]);
                }
                return id;
            } else {
                tx.run('INSERT INTO proyectos (nombre, descripcion, created_by_user_id) VALUES (?, ?, ?)', [nombre.trim(), descripcion.trim(), creatorId]);
                const result = tx.exec('SELECT last_insert_rowid() as id');
                const id = result && result.length > 0 && result[0].values && result[0].values.length > 0 ? result[0].values[0][0] : null;
                allIntegrantes.forEach(userId => tx.run('INSERT INTO proyecto_integrantes (proyecto_id, user_id) VALUES (?, ?)', [id, userId]));
                return id;
            }
        });
        if (!dbLib.usePg) saveDb();
        res.json({ id: proyectoId, ok: true });
    } catch (err) {
        console.error('Error creating proyecto:', err);
        res.status(500).json({ error: 'Error al crear proyecto' });
    }
});

/* ── Generar o actualizar QR para un proyecto ── */
app.post('/api/proyectos/:id/qr', requireRole('administrador', 'maestro'), async (req, res) => {
    const proyectoId = parseInt(req.params.id);
    if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID de proyecto inválido' });

    const proyecto = await qOne('SELECT id FROM proyectos WHERE id = ?', [proyectoId]);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' });

    try {
        const qrToken = uuidv4();
        const qrUrl = `${req.protocol}://${req.get('host')}/qr/scan/proyectos/${qrToken}`;
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } });

        const existing = await qOne('SELECT id FROM proyectos_qr_codes WHERE proyecto_id = ?', [proyectoId]);
        if (existing) {
            // FIX: Use correct SQL dialect for UPDATE
            if (dbLib.usePg) {
                await dbLib.run("UPDATE proyectos_qr_codes SET qr_token = ?, qr_data_url = ?, expires_at = now() + interval '14 days' WHERE proyecto_id = ?", [qrToken, qrDataUrl, proyectoId]);
            } else {
                await runSql('UPDATE proyectos_qr_codes SET qr_token = ?, qr_data_url = ?, expires_at = datetime("now", "+14 days") WHERE proyecto_id = ?', [qrToken, qrDataUrl, proyectoId]);
            }
        } else {
            // FIX: Use correct interval syntax for Postgres INSERT
            if (dbLib.usePg) {
                await dbLib.queryOne("INSERT INTO proyectos_qr_codes (proyecto_id, qr_token, qr_data_url, expires_at) VALUES (?, ?, ?, now() + interval '14 days') RETURNING id", [proyectoId, qrToken, qrDataUrl]);
            } else {
                await runSql('INSERT INTO proyectos_qr_codes (proyecto_id, qr_token, qr_data_url, expires_at) VALUES (?, ?, ?, datetime("now", "+14 days"))', [proyectoId, qrToken, qrDataUrl]);
            }
        }
        saveDb();

        res.json({
            qr_token: qrToken,
            qr_data_url: qrDataUrl,
            scan_url: qrUrl,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });
    } catch (err) {
        console.error('Error generando QR para proyecto:', err);
        res.status(500).json({ error: 'Error al generar QR' });
    }
});

app.get('/api/proyectos/:id/qr', requireRole('administrador', 'maestro'), async (req, res) => {
    const proyectoId = parseInt(req.params.id);
    if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID de proyecto inválido' });
    const qrData = await qOne('SELECT qr_token, qr_data_url, expires_at FROM proyectos_qr_codes WHERE proyecto_id = ?', [proyectoId]);
    if (!qrData) return res.status(404).json({ error: 'QR no generado para este proyecto' });
    res.json(qrData);
});

app.post('/api/proyectos/qr/scan/:token', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token de QR requerido' });

    const qrInfo = await qOne('SELECT proyecto_id, expires_at FROM proyectos_qr_codes WHERE qr_token = ?', [token]);
    if (!qrInfo) return res.status(404).json({ error: 'QR inválido o expirado' });

    if (qrInfo.expires_at && new Date(qrInfo.expires_at) < new Date()) {
        return res.status(400).json({ error: 'QR expirado' });
    }

    const proyectoId = qrInfo.proyecto_id;
    const userId = currentUser.id;

    const user = await qOne('SELECT rol, horario FROM users WHERE id = ?', [userId]);
    if (!user || user.rol !== 'alumno') {
        return res.status(403).json({ error: 'Solo alumnos pueden registrar asistencia' });
    }

    const horario = user.horario;
    const maxAsistencias = (horario === 'vespertino') ? 4 : 2;

    const countResult = await qOne('SELECT COUNT(*) as count FROM asistencias_proyectos WHERE user_id = ?', [userId]);
    const asistenciasActuales = countResult ? parseInt(countResult.count) : 0;

    if (asistenciasActuales >= maxAsistencias) {
        return res.status(400).json({ error: `Límite de asistencias a proyectos alcanzado. Máximo ${maxAsistencias} asistencias para horario ${horario}.`, current: asistenciasActuales, max: maxAsistencias });
    }

    const yaAsistio = await qOne('SELECT id FROM asistencias_proyectos WHERE proyecto_id = ? AND user_id = ?', [proyectoId, userId]);
    if (yaAsistio) {
        return res.status(400).json({ error: 'Ya has registrado asistencia a este proyecto' });
    }

    try {
        await dbLib.runTransaction(async (tx) => {
            if (dbLib.usePg) {
                await tx.queryWithPlaceholders('INSERT INTO asistencias_proyectos (proyecto_id, user_id, qr_token) VALUES (?, ?, ?)', [proyectoId, userId, token]);
            } else {
                tx.run('INSERT INTO asistencias_proyectos (proyecto_id, user_id, qr_token) VALUES (?, ?, ?)', [proyectoId, userId, token]);
            }
        });
        if (!dbLib.usePg) saveDb();
        const proyecto = await qOne('SELECT nombre, descripcion FROM proyectos WHERE id = ?', [proyectoId]);
        res.json({ success: true, message: 'Asistencia a proyecto registrada exitosamente', proyecto, asistencias_actuales: asistenciasActuales + 1, max_asistencias: maxAsistencias });
    } catch (err) {
        console.error('Error registrando asistencia a proyecto:', err);
        res.status(500).json({ error: 'Error al registrar asistencia' });
    }
});

app.get('/api/proyectos/asistencias/:userId?', async (req, res) => {
    let userId = parseInt(req.params.userId);
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (isNaN(userId)) {
        if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });
        userId = currentUser.id;
    } else {
        if (!currentUser || (currentUser.rol !== 'administrador' && currentUser.rol !== 'maestro' && currentUser.id !== userId)) {
            return res.status(403).json({ error: 'No autorizado' });
        }
    }
    try {
        const asistencias = await qAll(`
            SELECT ap.*, p.nombre, p.descripcion
            FROM asistencias_proyectos ap
            JOIN proyectos p ON ap.proyecto_id = p.id
            WHERE ap.user_id = ?
            ORDER BY ap.scanned_at DESC
        `, [userId]);
        const user = await qOne('SELECT rol, horario FROM users WHERE id = ?', [userId]);
        const horario = user ? user.horario : null;
        const maxAsistencias = (horario === 'vespertino') ? 4 : 2;
        res.json({ user_id: userId, horario, asistencias, total: asistencias.length, max_asistencias: maxAsistencias, min_asistencias: 1, disponible: Math.max(0, maxAsistencias - asistencias.length) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.get('/api/proyectos/:id/asistencias', requireRole('administrador', 'maestro'), async (req, res) => {
    const proyectoId = parseInt(req.params.id);
    if (isNaN(proyectoId)) return res.status(400).json({ error: 'ID de proyecto inválido' });
    try {
        const asistencias = await qAll(`
            SELECT ap.*, u.nombre, u.email, u.numero_control, u.horario
            FROM asistencias_proyectos ap
            JOIN users u ON ap.user_id = u.id
            WHERE ap.proyecto_id = ?
            ORDER BY ap.scanned_at DESC
        `, [proyectoId]);
        res.json({ proyecto_id: proyectoId, total_asistencias: asistencias.length, asistencias });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

/* ── Embellecimiento Industrial ── */
app.get('/api/embellecimiento', async (req, res) => {
    try {
        const rows = await qAll(`
            SELECT e.*, u.nombre as alumno_nombre, u.email as alumno_email
            FROM embellecimiento e
            LEFT JOIN users u ON e.user_id = u.id
            ORDER BY e.created_at DESC
        `);
        res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

app.post('/api/embellecimiento', async (req, res) => {
    const currentUser = req.user || (req.session && req.session.user) || req.jwtUser;
    if (!currentUser) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const { actividad, descripcion, profesor_responsable, que_hizo, imageData } = req.body;
    if (!actividad || !profesor_responsable || !que_hizo) {
        return res.status(400).json({ error: 'Actividad, profesor responsable y descripción de lo realizado son requeridos' });
    }

    let fotoPath = null;
    if (imageData) {
        try {
            fotoPath = await saveImage(imageData, 'embellecimiento');
        } catch (err) {
            if (err && err.message === 'Formato de imagen inválido') return res.status(400).json({ error: 'Formato de imagen inválido' });
            console.warn('No se pudo guardar la imagen de embellecimiento:', err && err.message ? err.message : err);
            fotoPath = null;
        }
    }

    try {
        const params = [actividad.trim(), descripcion ? descripcion.trim() : null, profesor_responsable.trim(), que_hizo.trim(), fotoPath, currentUser.id];
        if (dbLib.usePg) {
            const inserted = await dbLib.queryOne('INSERT INTO embellecimiento (actividad, descripcion, profesor_responsable, que_hizo, foto_evidencia, user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', params);
            res.json({ id: inserted ? inserted.id : null, ok: true });
        } else {
            await runSql('INSERT INTO embellecimiento (actividad, descripcion, profesor_responsable, que_hizo, foto_evidencia, user_id) VALUES (?, ?, ?, ?, ?, ?)', params);
            const newRow = await qOne('SELECT last_insert_rowid() as id');
            saveDb();
            res.json({ id: newRow ? newRow.id : null, ok: true });
        }
    } catch (err) {
        console.error('Error creating embellecimiento:', err);
        res.status(500).json({ error: 'Error al registrar actividad' });
    }
});

app.delete('/api/embellecimiento/:id', requireRole('administrador'), async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    try {
        if (dbLib.usePg) await dbLib.run('DELETE FROM embellecimiento WHERE id = ?', [id]);
        else { await runSql('DELETE FROM embellecimiento WHERE id = ?', [id]); saveDb(); }
        res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

/* ══════════════════════════════════════════
   DB INIT & SERVER START
   ══════════════════════════════════════════ */

async function initDb() {
    await dbLib.initDb();
    if (!dbLib.usePg) {
        db = dbLib.getSqliteDb();
    }

    const adminEmail = 'admin@tectijuana.edu.mx';
    const admin = await dbLib.queryOne('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (!admin) {
        const hash = bcrypt.hashSync('Martio109', 10);
        await dbLib.run('INSERT INTO users (nombre, email, password, rol) VALUES (?, ?, ?, ?)', ['Administrador', adminEmail, hash, 'administrador']);
        console.log('  ✓ Usuario administrador creado');
    }
}

if (require.main === module) {
    (async () => {
        try {
            await initDb();
            const server = app.listen(PORT, () => {
                console.log(`\n  ✓ Servidor ejecutándose en http://localhost:${PORT}\n`);
            });
            server.on('error', (err) => {
                if (err && err.code === 'EADDRINUSE') {
                    console.error(`\n  Error: el puerto ${PORT} ya está en uso.`);
                } else {
                    console.error('Error al iniciar el servidor:', err);
                }
                process.exit(1);
            });
        } catch (err) {
            console.error('Error al iniciar:', err);
            process.exit(1);
        }
    })();
}

module.exports = { app, initDb };