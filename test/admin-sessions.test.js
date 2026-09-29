const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdminSessions } = require('../admin-sessions');

function setup() {
  const data = new Map([['admin_password', 'password-hash']]);
  let time = 1000;
  const sessions = createAdminSessions({
    dbGet: async (_sql, [key]) => data.has(key) ? { value: data.get(key) } : null,
    dbRun: async (sql, [key, value]) => sql.startsWith('DELETE') ? data.delete(key) : data.set(key, value),
    verifyPassword: (password, hash) => password === 'correct' && hash === 'password-hash',
    now: () => time
  });
  const routes = {};
  sessions.register(Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (path, handler) => { routes[method] = handler; }])));
  const req = (body = {}, cookie = '', origin = 'https://lucehealing.com') => ({ body, headers: { cookie, origin }, get: () => 'lucehealing.com' });
  const res = () => ({ code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, cookie(name, value, options) { this.saved = { name, value, options }; }, clearCookie() { this.cleared = true; } });
  return { data, sessions, routes, req, res, advance: ms => { time += ms; } };
}

test('remembered login issues a secure 30-day cookie and stores only token hash', async () => {
  const s = setup(), r = s.res();
  await s.routes.post(s.req({ password: 'correct', remember: true }), r);
  assert.equal(r.code, 200);
  assert.equal(r.saved.options.maxAge, 30 * 86400000);
  assert.equal(r.saved.options.httpOnly, true);
  assert.equal(r.saved.options.secure, true);
  assert.equal(r.saved.options.sameSite, 'strict');
  assert.ok(!JSON.stringify([...s.data]).includes(r.saved.value));
  assert.ok(!JSON.stringify([...s.data]).includes('correct'));
  const request = s.req({}, `${r.saved.name}=${r.saved.value}`);
  assert.equal(await s.sessions.valid(request, 'password-hash'), true);
  s.advance(30 * 86400000 + 1);
  assert.equal(await s.sessions.valid(request, 'password-hash'), false);
});
test('unchecked remember uses a browser session cookie with 12-hour server expiry', async () => {
  const s = setup(), r = s.res();
  await s.routes.post(s.req({ password: 'correct', remember: false }), r);
  assert.equal(r.saved.options.maxAge, undefined);
  s.advance(12 * 3600000 + 1);
  assert.equal(await s.sessions.valid(s.req({}, `${r.saved.name}=${r.saved.value}`), 'password-hash'), false);
});
test('password changes, forged tokens and cross-origin requests do not authenticate', async () => {
  const s = setup(), r = s.res();
  await s.routes.post(s.req({ password: 'correct', remember: true }), r);
  const cookie = `${r.saved.name}=${r.saved.value}`;
  assert.equal(await s.sessions.valid(s.req({}, cookie), 'new-password-hash'), false);
  assert.equal(await s.sessions.valid(s.req({}, cookie, 'https://other.example'), 'password-hash'), false);
  assert.equal(await s.sessions.valid(s.req({}, `${r.saved.name}=${'a'.repeat(64)}`), 'password-hash'), false);
});
test('sign out revokes the session on the server', async () => {
  const s = setup(), r = s.res();
  await s.routes.post(s.req({ password: 'correct', remember: true }), r);
  const request = s.req({}, `${r.saved.name}=${r.saved.value}`), out = s.res();
  await s.routes.delete(request, out);
  assert.equal(out.cleared, true);
  assert.equal(await s.sessions.valid(request, 'password-hash'), false);
});
test('bad password and cross-origin login create no session', async () => {
  const s = setup(), bad = s.res(), cross = s.res();
  await s.routes.post(s.req({ password: 'wrong' }), bad);
  await s.routes.post(s.req({ password: 'correct' }, '', 'https://other.example'), cross);
  assert.equal(bad.code, 401);
  assert.equal(cross.code, 403);
  assert.equal(s.data.size, 1);
});
