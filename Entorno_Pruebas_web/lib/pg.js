const { Pool } = require('pg');
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

const poolConfig = {
    connectionString: sanitizedConnectionString,
    ssl: buildSslOption(),
    max: parseInt(process.env.PG_MAX_CLIENTS || '5', 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '10000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
    allowExitOnIdle: (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1')
};

const pool = global.__pgPool || new Pool(poolConfig);
if (!global.__pgPool) global.__pgPool = pool;

pool.on('error', (err) => {
    console.error('Postgres pool error', err && err.message ? err.message : err);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect()
};

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
