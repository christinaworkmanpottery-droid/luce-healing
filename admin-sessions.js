const crypto = require('node:crypto');
const COOKIE = '__Host-luce-admin';
const OPTIONS = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };
const fingerprint = value => crypto.createHash('sha256').update(value).digest('hex');

function createAdminSessions({ dbGet, dbRun, verifyPassword, now = Date.now }) {
  function tokenFrom(req) {
    const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='));
    const token = value?.slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
  }
  const keyFor = token => 'admin_session:' + fingerprint(token);
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.get('host'); } catch { return false; }
  }
  async function valid(req, passwordHash) {
    if (!sameOrigin(req)) return false;
    const token = tokenFrom(req);
    if (!token) return false;
    const row = await dbGet('SELECT value FROM admin_settings WHERE key = $1', [keyFor(token)]);
    if (!row) return false;
    try {
      const session = JSON.parse(row.value);
      return session.expires > now() && session.passwordVersion === fingerprint(passwordHash);
    } catch { return false; }
  }
  async function revoke(req, res) {
    const token = tokenFrom(req);
    if (token) await dbRun('DELETE FROM admin_settings WHERE key = $1', [keyFor(token)]);
    res.clearCookie(COOKIE, OPTIONS);
  }
  function register(app) {
    app.post('/api/admin/session', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Please sign in from this website.' });
      try {
        const record = await dbGet('SELECT value FROM admin_settings WHERE key = $1', ['admin_password']);
        if (typeof req.body.password !== 'string' || req.body.password.length > 1024 || !record || !verifyPassword(req.body.password, record.value)) {
          return res.status(401).json({ error: 'Incorrect password.' });
        }
        await revoke(req, res);
        const token = crypto.randomBytes(32).toString('hex');
        const remember = req.body.remember === true;
        const lifetime = (remember ? 30 * 24 : 12) * 60 * 60 * 1000;
        await dbRun('INSERT INTO admin_settings (key, value) VALUES ($1, $2)', [keyFor(token), JSON.stringify({ expires: now() + lifetime, passwordVersion: fingerprint(record.value) })]);
        res.cookie(COOKIE, token, { ...OPTIONS, ...(remember ? { maxAge: lifetime } : {}) });
        res.json({ authenticated: true });
      } catch { res.status(500).json({ error: 'Unable to sign in. Please try again.' }); }
    });
    app.get('/api/admin/session', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const record = await dbGet('SELECT value FROM admin_settings WHERE key = $1', ['admin_password']);
        const authenticated = !!record && await valid(req, record.value);
        res.status(authenticated ? 200 : 401).json({ authenticated });
      } catch { res.status(500).json({ error: 'Unable to check your sign-in. Please try again.' }); }
    });
    app.delete('/api/admin/session', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Please sign out from this website.' });
      try { await revoke(req, res); res.json({ authenticated: false }); }
      catch { res.status(500).json({ error: 'Unable to sign out. Please try again.' }); }
    });
  }
  return { valid, register, revoke };
}
module.exports = { createAdminSessions };
