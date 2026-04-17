const serverless = require('serverless-http');
const { app, initDb } = require('../server');

// Create the serverless handler once and reuse it across invocations
const handler = serverless(app);
let initPromise = null;
let inited = false;

module.exports = async function (req, res) {
    try {
        if (!inited) {
            if (!initPromise) {
                initPromise = initDb().then(() => { inited = true; }).catch((err) => {
                    // reset so future invocations can retry initialization
                    initPromise = null;
                    throw err;
                });
            }
            await initPromise;
        }
        return handler(req, res);
    } catch (err) {
        console.error('Error inicializando la app:', err);
        res.statusCode = 500;
        res.end('Error de servidor');
        return;
    }
};