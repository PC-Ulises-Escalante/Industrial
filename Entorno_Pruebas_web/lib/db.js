const path = require('path');
const fs = require('fs');

// Determine which database to use (accept Supabase's POSTGRES_URL as well)
const usePg = !!((process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) || (process.env.POSTGRES_URL && process.env.POSTGRES_URL.trim()));
let pgModule = null;
let sqliteModule = null;
let db = null;

if (usePg) {
    console.log('Using PostgreSQL database');
    pgModule = require('./pg');
} else {
    console.log('Using SQLite database');
    const initSqlJs = require('sql.js');
    const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

    // Load or create SQLite database
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new (initSqlJs.Database)(buffer);
        console.log('Loaded existing SQLite database');
    } else {
        db = new (initSqlJs.Database)();
        console.log('Created new SQLite database');
    }
}

function convertPlaceholders(sql) {
    let i = 1;
    return sql.replace(/\?/g, () => '$' + (i++));
}

async function initDb() {
    if (usePg) {
        // Use a SINGLE client for all schema queries to avoid opening 17 separate TCP connections
        const { createSingleClient, endSingleClient } = pgModule;
        const client = await createSingleClient();
        try {
            await client.query(`CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                rol TEXT NOT NULL CHECK (rol IN ('alumno','invitado','maestro','administrador')),
                numero_control TEXT,
                semestre INTEGER,
                sexo TEXT,
                horario TEXT,
                edad INTEGER,
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS ponentes (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                profesion TEXT,
                topic_title TEXT,
                topic_desc TEXT,
                foto_path TEXT,
                linkedin TEXT,
                facebook TEXT,
                instagram TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS conferencias (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                fecha DATE NOT NULL,
                lugar TEXT NOT NULL,
                descripcion TEXT,
                ponente_nombre TEXT,
                ponente_profesion TEXT,
                ponente_foto TEXT,
                foto_evento TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS conferencias_inscripciones (
                id SERIAL PRIMARY KEY,
                conferencia_id INTEGER REFERENCES conferencias(id),
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(conferencia_id, user_id)
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS conferencia_qr_codes (
                id SERIAL PRIMARY KEY,
                conferencia_id INTEGER REFERENCES conferencias(id),
                qr_token TEXT UNIQUE NOT NULL,
                qr_data_url TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS asistencias_conferencias (
                id SERIAL PRIMARY KEY,
                conferencia_id INTEGER REFERENCES conferencias(id),
                user_id INTEGER REFERENCES users(id),
                qr_token TEXT,
                scanned_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(conferencia_id, user_id)
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS deportes_equipos (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                deporte TEXT NOT NULL CHECK (deporte IN ('futbol','basquetbol')),
                dias TEXT NOT NULL,
                created_by_user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS deportes_equipo_integrantes (
                id SERIAL PRIMARY KEY,
                equipo_id INTEGER REFERENCES deportes_equipos(id),
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(equipo_id, user_id)
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS deportes_qr_codes (
                id SERIAL PRIMARY KEY,
                equipo_id INTEGER REFERENCES deportes_equipos(id),
                qr_token TEXT UNIQUE NOT NULL,
                qr_data_url TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS asistencias_deportes (
                id SERIAL PRIMARY KEY,
                equipo_id INTEGER REFERENCES deportes_equipos(id),
                user_id INTEGER REFERENCES users(id),
                qr_token TEXT,
                scanned_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(equipo_id, user_id)
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS proyectos (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                descripcion TEXT NOT NULL,
                created_by_user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS proyecto_integrantes (
                id SERIAL PRIMARY KEY,
                proyecto_id INTEGER REFERENCES proyectos(id),
                user_id INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(proyecto_id, user_id)
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS proyectos_qr_codes (
                id SERIAL PRIMARY KEY,
                proyecto_id INTEGER REFERENCES proyectos(id),
                qr_token TEXT UNIQUE NOT NULL,
                qr_data_url TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            );`);

            await client.query(`CREATE TABLE IF NOT EXISTS asistencias_proyectos (
                id SERIAL PRIMARY KEY,
                proyecto_id INTEGER REFERENCES proyectos(id),
                user_id INTEGER REFERENCES users(id),
                qr_token TEXT,
                scanned_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(proyecto_id, user_id)
            );`);
            // Migrations: add columns that may be missing from older table versions.
            // These are safe to run repeatedly — they silently no-op if the column already exists.
            const migrations = [
                `ALTER TABLE conferencias ADD COLUMN IF NOT EXISTS foto_evento TEXT`,
                `ALTER TABLE conferencias ADD COLUMN IF NOT EXISTS ponente_foto TEXT`,
            ];
            for (const sql of migrations) {
                try { await client.query(sql); } catch (e) { /* column already exists, ignore */ }
            }
        } finally {
            await endSingleClient(client);
        }
    } else {
        // SQLite schema
        db.exec(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            rol TEXT NOT NULL CHECK (rol IN ('alumno','invitado','maestro','administrador')),
            numero_control TEXT,
            semestre INTEGER,
            sexo TEXT,
            horario TEXT,
            edad INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS ponentes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            profesion TEXT,
            topic_title TEXT,
            topic_desc TEXT,
            foto_path TEXT,
            linkedin TEXT,
            facebook TEXT,
            instagram TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS conferencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT NOT NULL,
            fecha DATE NOT NULL,
            lugar TEXT NOT NULL,
            descripcion TEXT,
            ponente_nombre TEXT,
            ponente_profesion TEXT,
            ponente_foto TEXT,
            foto_evento TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS conferencias_inscripciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conferencia_id INTEGER REFERENCES conferencias(id),
            user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(conferencia_id, user_id)
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS conferencia_qr_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conferencia_id INTEGER REFERENCES conferencias(id),
            qr_token TEXT UNIQUE NOT NULL,
            qr_data_url TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS asistencias_conferencias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conferencia_id INTEGER REFERENCES conferencias(id),
            user_id INTEGER REFERENCES users(id),
            qr_token TEXT,
            scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(conferencia_id, user_id)
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS deportes_equipos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            deporte TEXT NOT NULL CHECK (deporte IN ('futbol','basquetbol')),
            dias TEXT NOT NULL,
            created_by_user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS deportes_equipo_integrantes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipo_id INTEGER REFERENCES deportes_equipos(id),
            user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(equipo_id, user_id)
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS deportes_qr_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipo_id INTEGER REFERENCES deportes_equipos(id),
            qr_token TEXT UNIQUE NOT NULL,
            qr_data_url TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS asistencias_deportes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipo_id INTEGER REFERENCES deportes_equipos(id),
            user_id INTEGER REFERENCES users(id),
            qr_token TEXT,
            scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(equipo_id, user_id)
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS proyectos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            created_by_user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS proyecto_integrantes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER REFERENCES proyectos(id),
            user_id INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(proyecto_id, user_id)
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS proyectos_qr_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER REFERENCES proyectos(id),
            qr_token TEXT UNIQUE NOT NULL,
            qr_data_url TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);

        db.exec(`CREATE TABLE IF NOT EXISTS asistencias_proyectos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proyecto_id INTEGER REFERENCES proyectos(id),
            user_id INTEGER REFERENCES users(id),
            qr_token TEXT,
            scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(proyecto_id, user_id)
        );`);

        saveDb();
    }
    console.log('Database initialized');
}

// PostgreSQL functions
async function queryOne(sql, params) {
    if (usePg) {
        const { query } = pgModule;
        const text = convertPlaceholders(sql);
        const res = await query(text, params || []);
        return res.rows && res.rows.length > 0 ? res.rows[0] : null;
    } else {
        const stmt = db.prepare(sql);
        if (params) {
            for (let i = 0; i < params.length; i++) {
                stmt.bind([i + 1, params[i]]);
            }
        }
        const result = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return result;
    }
}

async function queryAll(sql, params) {
    if (usePg) {
        const { query } = pgModule;
        const text = convertPlaceholders(sql);
        const res = await query(text, params || []);
        return res.rows || [];
    } else {
        const stmt = db.prepare(sql);
        if (params) {
            for (let i = 0; i < params.length; i++) {
                stmt.bind([i + 1, params[i]]);
            }
        }
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    }
}

async function run(sql, params) {
    if (usePg) {
        const { query } = pgModule;
        const text = convertPlaceholders(sql);
        return (await query(text, params || [])).rowCount;
    } else {
        if (params) {
            const stmt = db.prepare(sql);
            for (let i = 0; i < params.length; i++) {
                stmt.bind([i + 1, params[i]]);
            }
            stmt.step();
            stmt.free();
        } else {
            db.exec(sql);
        }
        saveDb();
        return db.getRowsModified();
    }
}

async function runTransaction(fn) {
    if (usePg) {
        const { getClient } = pgModule;
        const client = await getClient();
        client.queryWithPlaceholders = (sql, params) => {
            const text = convertPlaceholders(sql);
            return client.query(text, params || []);
        };
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } else {
        // SQLite transactions are automatically handled
        // For simplicity, we'll just run the function
        const mockClient = {
            queryWithPlaceholders: (sql, params) => {
                return run(sql, params);
            },
            query: (sql, params) => {
                return run(sql, params);
            }
        };
        return fn(mockClient);
    }
}

function saveDb() {
    if (!usePg && db) {
        const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

function getSqliteDb() {
    if (usePg) {
        return null;
    }
    return db;
}

module.exports = {
    initDb,
    queryOne,
    queryAll,
    run,
    runTransaction,
    saveDb,
    getSqliteDb,
    usePg
};