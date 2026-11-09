const crypto = require('crypto');
const db = require('./database');
const SESSION_COOKIE_NAME = 'photo_manager_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET;
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH;
if (!SESSION_SECRET || !AUTH_USERNAME || !AUTH_PASSWORD_HASH) {
    throw new Error('SESSION_SECRET, AUTH_USERNAME and AUTH_PASSWORD_HASH must be configured');
}

function hashPassword(password, salt) {
    return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) =>
        err ? reject(err) : resolve(key)));
}
async function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || password.length > 1024) return false;
    const [algorithm, salt, hash, extra] = storedHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !/^[0-9a-f]{128}$/i.test(hash || '') || extra !== undefined) return false;
    const expected = Buffer.from(hash, 'hex');
    const actual = await hashPassword(password, salt);
    return crypto.timingSafeEqual(expected, actual);
}

// Existing stateless cookies are deliberately invalidated when upgrading.
// Database-backed random bearer tokens make explicit logout and revocation possible.
const getSession = db.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash = ?');
const putSession = db.prepare('INSERT INTO auth_sessions (token_hash, username, expires_at) VALUES (?, ?, ?)');
const deleteSession = db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
const purgeExpired = db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?');
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');

function createSessionToken(username) {
    const token = crypto.randomBytes(32).toString('base64url');
    purgeExpired.run(Date.now());
    putSession.run(hashToken(token), username, Date.now() + SESSION_MAX_AGE);
    return token;
}
function verifySessionToken(token) {
    if (typeof token !== 'string' || token.length > 200) return false;
    const session = getSession.get(hashToken(token));
    return Boolean(session && session.expires_at > Date.now());
}
function getSessionToken(req) {
    const cookies = (req.headers.cookie || '').split(';');
    for (const cookie of cookies) {
        const index = cookie.indexOf('=');
        if (index < 0 || cookie.slice(0, index).trim() !== SESSION_COOKIE_NAME) continue;
        try { return decodeURIComponent(cookie.slice(index + 1)); } catch { return null; }
    }
    return null;
}
function revokeSession(req) {
    const token = getSessionToken(req);
    if (token) deleteSession.run(hashToken(token));
}
function revokeAllSessions() { db.prepare('DELETE FROM auth_sessions').run(); }
function requireApiAuth(req, res, next) {
    if (!verifySessionToken(getSessionToken(req))) return res.status(401).json({ error: 'Authentication required' });
    next();
}
function requirePageAuth(req, res, next) {
    if (!verifySessionToken(getSessionToken(req))) return res.redirect('/login.html');
    next();
}
async function login(username, password) {
    if (username !== AUTH_USERNAME || !await verifyPassword(password, AUTH_PASSWORD_HASH)) return null;
    return createSessionToken(username);
}
module.exports = {
    SESSION_COOKIE_NAME, SESSION_MAX_AGE, getSessionToken,
    revokeSession, revokeAllSessions, requireApiAuth, requirePageAuth, login
};
