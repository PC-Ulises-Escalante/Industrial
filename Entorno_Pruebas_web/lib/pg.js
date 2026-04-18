const { Pool, Client } = require('pg');
const fs = require('fs');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const rawMode = process.env.PGSSLMODE;
const pgSslMode = rawMode ? String(rawMode).toLowerCase() : null;

// Decide SSL option for `pg` Pool. By default no SSL (for local sqlite use).
// If PGSSLMODE is provided, interpret common values:
// - 'disable' / '0' / 'false' => no SSL
// - 'verify-full' => enforce certificate verification
// - 'require' | 'prefer' | 'verify-ca' | 'true' => enable SSL but do NOT reject unauthorized (pragmatic)
// If the connection string includes `sslmode=...` we'll honor it similarly.
function resolveSslOption() {
    if (pgSslMode) {
        if (pgSslMode === 'disable' || pgSslMode === '0' || pgSslMode === 'false') return false;
        if (pgSslMode === 'verify-full') return { rejectUnauthorized: true };
        return { rejectUnauthorized: false };
    }

    if (connectionString) {
        const m = connectionString.match(/sslmode=([^&]+)/i);
        if (m && m[1]) {
            const mode = decodeURIComponent(m[1]).toLowerCase();
            if (mode === 'disable') return false;
            if (mode === 'verify-full') return { rejectUnauthorized: true };
            return { rejectUnauthorized: false };
        }
    }

    return false;
}

// If the connection string contains sslmode=..., remove it so that we can
// control SSL behavior via the explicit `ssl` option. This prevents the
// pg-connection-string parser from forcing verify-full semantics.
function sanitizeConnectionString(cs) {
    if (!cs) return cs;
    try {
        const u = new URL(cs);
        const params = new URLSearchParams(u.search);
        if (params.has('sslmode')) params.delete('sslmode');
        u.search = params.toString() ? `?${params.toString()}` : '';
        return u.toString();
    } catch (e) {
        // If parsing fails, return original string (best-effort)
        return cs;
    }
}

const sanitizedConnectionString = sanitizeConnectionString(connectionString);

// Decide whether to use a long-lived Pool or create a Client per request.
// Default: on Vercel prefer per-request Client to avoid lingering sockets unless explicitly overridden.
const usePool = !((process.env.VERCEL === '1' || process.env.PG_CLOSE_AFTER_REQUEST === '1') && process.env.PG_USE_POOL !== '1');

const poolConfig = {
    connectionString: sanitizedConnectionString,
    ssl: buildSslOption(),
    max: parseInt(process.env.PG_MAX_CLIENTS || '2', 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '10000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
    allowExitOnIdle: (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1')
};

function createPool() {
    const p = new Pool(poolConfig);
    p.on('error', (err) => {
        console.error('Postgres pool error', err && err.message ? err.message : err);
    });
    return p;
}

function getPool() {
    if (!global.__pgPool) global.__pgPool = createPool();
    return global.__pgPool;
}

async function endPool() {
    if (usePool) {
        if (global.__pgPool) {
            try { await global.__pgPool.end(); } catch (err) { console.error('Error ending pg pool', err && err.message ? err.message : err); }
            try { delete global.__pgPool; } catch (e) { global.__pgPool = undefined; }
        }
    } else {
        // no-op for per-request clients
        return;
    }
}

// Helper to convert '?' placeholders to $1, $2 for pg
function convertPlaceholders(sql) {
    let i = 1;
    return sql.replace(/\?/g, () => '$' + (i++));
}

async function query(text, params) {
    if (!usePool) {
        const c = new Client({ connectionString: sanitizedConnectionString, ssl: buildSslOption() });
        await c.connect();
        try {
            return await c.query(text, params || []);
        } finally {
            try { await c.end(); } catch (e) { /* ignore */ }
        }
    }
    return getPool().query(text, params || []);
}

async function getClient() {
    if (!usePool) {
        const client = new Client({ connectionString: sanitizedConnectionString, ssl: buildSslOption() });
        await client.connect();
        client.queryWithPlaceholders = (sql, params) => {
            const text = convertPlaceholders(sql);
            return client.query(text, params || []);
        };
        client.release = async () => { try { await client.end(); } catch (e) { /* ignore */ } };
        return client;
    }
    return getPool().connect();
}

module.exports = { query, getClient, endPool };

function buildSslOption() {
    const opt = resolveSslOption(); // existing resolve
    if (opt === false) return false;

    // Ensure we have an object we can extend
    const base = (typeof opt === 'object') ? Object.assign({}, opt) : { rejectUnauthorized: false };

    // Allow providing CA as a file path in PG_SSL_ROOT_CERT or base64 content in PG_SSL_ROOT_CERT_BASE64
    const pemSource = process.env.PG_SSL_ROOT_CERT_BASE64 || process.env.PG_SSL_ROOT_CERT;
    if (pemSource) {
        try {
            const pem = process.env.PG_SSL_ROOT_CERT_BASE64 ? Buffer.from(pemSource, 'base64').toString('utf8') : fs.readFileSync(pemSource, 'utf8');
            base.ca = pem;
        } catch (err) {
            console.error('Failed to load PG SSL root cert:', err && err.message ? err.message : err);
            // ignore and return base without ca
        }
    }
    return base;
}
