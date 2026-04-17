const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';

function sign(payload, opts = {}) {
    return jwt.sign(payload, SECRET, Object.assign({ expiresIn: '7d' }, opts));
}

function verify(token) {
    return jwt.verify(token, SECRET);
}

module.exports = { sign, verify };
