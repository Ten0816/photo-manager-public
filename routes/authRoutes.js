const express = require('express');
const { SESSION_COOKIE_NAME, SESSION_MAX_AGE, login, revokeSession } = require('../auth');
const router = express.Router();

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 6;
function clientKey(req) { return req.ip || req.socket.remoteAddress || 'unknown'; }
function cookie(req, token, maxAge) {
    const secure = req.secure || process.env.COOKIE_SECURE === 'true';
    return `${SESSION_COOKIE_NAME}=${token ? encodeURIComponent(token) : ''}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
router.post('/login', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    const key = clientKey(req);
    const entry = attempts.get(key);
    if (entry && entry.until > now && entry.count >= MAX_ATTEMPTS) {
        res.setHeader('Retry-After', Math.ceil((entry.until - now) / 1000));
        return res.status(429).json({ error: 'ログイン試行回数が多すぎます。しばらくしてから再試行してください。' });
    }
    try {
        const { username, password } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const token = await login(username, password);
        if (!token) {
            const current = entry && entry.until > now ? entry : { count: 0, until: now + WINDOW_MS };
            current.count++;
            attempts.set(key, current);
            return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません。' });
        }
        attempts.delete(key);
        res.setHeader('Set-Cookie', cookie(req, token, Math.floor(SESSION_MAX_AGE / 1000)));
        res.json({ message: 'Login successful' });
    } catch (error) {
        console.error('Login failed:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});
router.post('/logout', (req, res) => {
    revokeSession(req);
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ message: 'Logout successful' });
});
module.exports = router;
