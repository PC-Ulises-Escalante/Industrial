const { app, initDb } = require('../server');

let initPromise = null;
let inited = false;

module.exports = async function (req, res) {
    const reqId = req.headers['x-vercel-id'] || req.headers['x-request-id'] || '-';
    const start = Date.now();

    try {
        // Initialize DB on first invocation (cold start)
        if (!inited) {
            if (!initPromise) {
                initPromise = initDb().then(() => {
                    inited = true;
                }).catch((err) => {
                    initPromise = null;
                    throw err;
                });
            }
            await initPromise;
        }

        // Forward request to Express app and wait for response to finish
        await new Promise((resolve, reject) => {
            let finished = false;
            const onFinish = () => {
                if (finished) return;
                finished = true;
                resolve();
            };
            res.once('finish', onFinish);
            res.once('close', onFinish);
            try {
                app(req, res);
            } catch (err) {
                if (!finished) { finished = true; reject(err); }
            }
            // Safety: don't hang forever if response never finishes
            setTimeout(() => {
                if (!finished) { finished = true; resolve(); }
            }, 25000).unref();
        });

        console.log(`[api] ${req.method} ${req.url} completed in ${Date.now() - start}ms`);

        // No cleanup needed — Vercel manages process lifecycle.
        // Avoid closing PG pool or destroying sockets to prevent
        // blocking the event loop and causing 30s timeouts.

    } catch (err) {
        console.error('[api] Error:', err && err.stack ? err.stack : err);
        try {
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end('Error de servidor');
            }
        } catch (e) { /* ignore */ }
    }
};