const { app, initDb } = require('../server');

// In serverless we invoke the Express `app` directly (no server) to avoid internal listening sockets
async function invokeAppDirect(req, res) {
    return new Promise((resolve, reject) => {
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
            reject(err);
        }
        // Safety: if the response hasn't finished within 25s, resolve to allow cleanup (prevents stuck promises)
        setTimeout(() => { if (!finished) { finished = true; resolve(); } }, 25000);
    });
}
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
        await invokeAppDirect(req, res);
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

                // If there are socket handles, log more info to help identify them
                if (handles.length > 0) {
                    for (const h of handles) {
                        try {
                            const ctor = (h && h.constructor && h.constructor.name) ? h.constructor.name : typeof h;
                            if (ctor === 'Socket' || ctor === 'TLSSocket') {
                                console.log('[api] socket-handle', { ctor, remoteAddress: h.remoteAddress, remotePort: h.remotePort, localAddress: h.localAddress, localPort: h.localPort, connecting: h.connecting });
                            } else if (ctor === 'Server') {
                                try {
                                    const addr = h.address ? h.address() : null;
                                    console.log('[api] server-handle', { ctor, listening: !!(h.listening || (addr && addr.port)), addr });
                                } catch (e) {
                                    console.log('[api] server-handle (no addr)', { ctor });
                                }
                            } else {
                                // generic
                                console.log('[api] handle', { ctor });
                            }
                        } catch (e) {
                            console.error('[api] error examining handle', e && e.stack ? e.stack : e);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[api] error inspecting active handles', e && e.stack ? e.stack : e);
        }

        // If configured to do so, close the Postgres pool to allow the process to exit
        try {
            const shouldClose = (process.env.PG_CLOSE_AFTER_REQUEST !== '0') && (
                process.env.VERCEL === '1' || process.env.DISABLE_SESSIONS === '1' || process.env.NODE_ENV === 'production' || !!process.env.AWS_REGION || !!process.env.FUNCTIONS_WORKER_RUNTIME
            );
            console.log('[api] pg-close-check', { VERCEL: process.env.VERCEL, DISABLE_SESSIONS: process.env.DISABLE_SESSIONS, NODE_ENV: process.env.NODE_ENV, PG_CLOSE_AFTER_REQUEST: process.env.PG_CLOSE_AFTER_REQUEST, shouldClose });

            if (shouldClose) {
                try {
                    const beforeHandles = (typeof process._getActiveHandles === 'function') ? process._getActiveHandles().length : null;

                    // Close the internal http server created by serverless-http (if present)
                    try {
                        if (handler && handler.server && typeof handler.server.close === 'function') {
                            console.log('[api] closing handler.server to free listening socket');
                            await new Promise((resolve) => handler.server.close(() => resolve()));
                            console.log('[api] handler.server.close completed');
                        }
                    } catch (e) {
                        console.error('[api] error closing handler.server', e && e.stack ? e.stack : e);
                    }

                    // Destroy any tracked server sockets to ensure they don't keep the process alive
                    try {
                        if (activeServerSockets && activeServerSockets.size > 0) {
                            console.log('[api] destroying activeServerSockets', activeServerSockets.size);
                            for (const s of Array.from(activeServerSockets)) {
                                try { s.destroy(); } catch (e) { /* ignore */ }
                            }
                        }
                    } catch (e) {
                        console.error('[api] error destroying server sockets', e && e.stack ? e.stack : e);
                    }

                    // Aggressively close any Server handles and destroy local Sockets discovered via process._getActiveHandles()
                    try {
                        if (typeof process._getActiveHandles === 'function') {
                            const handles = process._getActiveHandles();
                            for (const h of handles) {
                                try {
                                    const ctor = (h && h.constructor && h.constructor.name) ? h.constructor.name : typeof h;
                                    if (ctor === 'Server' && typeof h.close === 'function') {
                                        try {
                                            console.log('[api] closing Server handle', { addr: (typeof h.address === 'function') ? h.address() : null });
                                            await new Promise((resolve) => {
                                                try { h.close(() => resolve()); }
                                                catch (e) { resolve(); }
                                            });
                                            console.log('[api] closed Server handle');
                                        } catch (e) {
                                            console.error('[api] error closing Server handle', e && e.stack ? e.stack : e);
                                        }
                                    } else if ((ctor === 'Socket' || ctor === 'TLSSocket') && typeof h.destroy === 'function') {
                                        // Only destroy loopback/local sockets to avoid terminating remote connections unexpectedly
                                        try {
                                            const local = h.localAddress || '';
                                            if (!local || local === '127.0.0.1' || local === '::1') {
                                                try { h.destroy(); } catch (e) { /* ignore */ }
                                            }
                                        } catch (e) { /* ignore */ }
                                    }
                                } catch (e) {
                                    /* ignore per-handle errors */
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[api] error closing handles from _getActiveHandles', e && e.stack ? e.stack : e);
                    }

                    const pg = require('../lib/pg');
                    if (pg && typeof pg.endPool === 'function') {
                        await pg.endPool();
                        console.log('[api] pg.endPool() called to allow process exit');
                    } else if (pg && typeof pg.end === 'function') {
                        await pg.end();
                        console.log('[api] pg.end() called to allow process exit');
                    } else {
                        console.log('[api] no pg.endPool/end available on require(../lib/pg)');
                    }

                    const afterHandles = (typeof process._getActiveHandles === 'function') ? process._getActiveHandles().length : null;
                    console.log('[api] handles-before-after', { beforeHandles, afterHandles, reqId });
                } catch (e) {
                    console.error('[api] error closing pg pool', e && e.stack ? e.stack : e);
                }
            } else {
                console.log('[api] pg.end skipped', { shouldClose });
            }
        } catch (e) {
            console.error('[api] error in pg close block', e && e.stack ? e.stack : e);
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