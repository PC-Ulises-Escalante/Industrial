const serverless = require('serverless-http');
const { app, initDb } = require('../server');

// Create the serverless handler once and reuse it across invocations
const handler = serverless(app);
let initPromise = null;
let inited = false;

module.exports = async function (req, res) {
    const reqId = req.headers['x-vercel-id'] || req.headers['x-request-id'] || '-';
    console.log(`[api] invoked ${req.method} ${req.url} reqId=${reqId}`);
    const start = Date.now();
    try {
        if (!inited) {
            if (!initPromise) {
                console.log('[api] initDb start');
                initPromise = initDb().then(() => { inited = true; console.log('[api] initDb done'); }).catch((err) => {
                    // reset so future invocations can retry initialization
                    initPromise = null;
                    throw err;
                });
            }
            await initPromise;
        }
        console.log('[api] forwarding to handler');
        const result = await handler(req, res);
        console.log(`[api] handler completed in ${Date.now() - start}ms reqId=${reqId}`);
        return result;
    } catch (err) {
        console.error('[api] Error inicializando la app:', err && err.stack ? err.stack : err);
        // If headers not sent, send a 500 response
        try {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Error de servidor');
            }
        } catch (e) { /* ignore */ }
        return;
    }
};