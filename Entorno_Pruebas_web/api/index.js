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

        // Diagnostic: inspect active handles/requests to detect handles preventing process exit
        try {
            if (typeof process._getActiveHandles === 'function') {
                const handles = process._getActiveHandles();
                const requests = (typeof process._getActiveRequests === 'function') ? process._getActiveRequests() : [];
                const summary = handles.reduce((acc, h) => {
                    const name = (h && h.constructor && h.constructor.name) ? h.constructor.name : typeof h;
                    acc[name] = (acc[name] || 0) + 1;
                    return acc;
                }, {});
                console.log(`[api] activeHandles=${handles.length} activeRequests=${requests.length} reqId=${reqId} summary=${JSON.stringify(summary)}`);
            }
        } catch (e) {
            console.error('[api] error inspecting active handles', e && e.stack ? e.stack : e);
        }
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