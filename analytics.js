// Forward-only analytics. Existing blog_posts.view_count and page_views are never written here.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WINDOW_MS = 30 * 60 * 1000;
const publicPages = new Set(['/', '/blog', '/reading', '/forecast', '/subscribe', '/gift', '/pricing', '/astrology-membership', '/memes-gallery', '/about', '/contact', '/faq', '/readings']);
function publicPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  const url = new URL(value, 'https://analytics.invalid');
  if ([...url.searchParams.keys()].some(k => /preview|admin|password|edit|token|session_id/i.test(k)) || /admin|preview|edit/i.test(url.hash)) return null;
  const p = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  if (p === '/index') return '/';
  return publicPages.has(p) || /^\/blog\/[a-z0-9][a-z0-9-]*$/i.test(p) ? p : null;
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')));
}
function excluded(req) {
  const ua = req.headers['user-agent'] || '';
  return !/Mozilla\/5\.0/.test(ua) || /bot|crawl|spider|preview|slurp|scanner|headless|lighthouse|uptime|monitor|pingdom|facebook|facebot|whatsapp|telegram|discord|slack|curl|wget|python|httpclient|selenium|playwright|puppeteer/i.test(ua) ||
    /prefetch|prerender/i.test((req.headers.purpose || '') + (req.headers['sec-purpose'] || '')) ||
    cookies(req).luce_analytics_admin === '1' || /\/(admin|api\/admin)(?:[/.?#]|$)/i.test(req.headers.referer || '') ||
    Object.keys(req.query || {}).some(k => /preview|admin|password|edit|token|session_id/i.test(k));
}
function markAdmin(req, res) {
  res.cookie('luce_analytics_admin', '1', {httpOnly:true, sameSite:'lax', secure:req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge:365*86400000, path:'/'});
}
function createAnalytics({pool, clock = () => Date.now()}) {
  let secret;
  const sign = value => crypto.createHmac('sha256', secret).update(value).digest('hex');
  async function initialize() {
    await pool.query(`CREATE TABLE IF NOT EXISTS filtered_analytics_meta (id INTEGER PRIMARY KEY, secret TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query('INSERT INTO filtered_analytics_meta (id,secret) VALUES (1,$1) ON CONFLICT DO NOTHING', [crypto.randomBytes(32).toString('hex')]);
    secret = (await pool.query('SELECT secret FROM filtered_analytics_meta WHERE id=1')).rows[0].secret;
    await pool.query(`CREATE TABLE IF NOT EXISTS filtered_analytics_dedup (visitor TEXT NOT NULL, path TEXT NOT NULL, last_seen TIMESTAMPTZ NOT NULL, PRIMARY KEY(visitor,path))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS filtered_page_views (id BIGSERIAL PRIMARY KEY, visitor TEXT NOT NULL, path TEXT NOT NULL, referrer TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL)`);
    await pool.query('CREATE INDEX IF NOT EXISTS filtered_views_path_date ON filtered_page_views(path,created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS filtered_views_date ON filtered_page_views(created_at)');
  }
  function middleware(req,res,next) {
    if (/^\/admin(?:[/.]|$)/.test(req.path)) markAdmin(req,res);
    const send = res.send.bind(res);
    res.send = body => {
      const p = publicPath(req.path);
      if (secret && req.method === 'GET' && res.statusCode === 200 && p && !excluded(req) && typeof body === 'string' && /<body\b/i.test(body)) {
        let visitor = cookies(req).luce_reader;
        if (!/^[a-f0-9]{32}$/.test(visitor || '')) visitor = crypto.randomBytes(16).toString('hex');
        res.cookie('luce_reader', visitor, {httpOnly:true, sameSite:'lax', secure:req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge:365*86400000, path:'/'});
        // The per-browser challenge must never enter a shared cache.
        res.set('Cache-Control','private, no-store');
        const payload = Buffer.from(JSON.stringify({p,v:visitor,t:clock()})).toString('base64url');
        body = body.replace(/<\/body>/i, `<script src="/reader-tracking.js" data-token="${payload}.${sign(payload)}" defer></script></body>`);
      }
      return send(body);
    };
    next();
  }
  async function record(req,res) {
    res.set('Cache-Control','no-store');
    if (!secret || req.method !== 'POST' || excluded(req)) return res.json({ok:true,counted:false});
    try {
      const origin = new URL(req.headers.origin || req.headers.referer || '');
      if (origin.host !== req.get('host') || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) return res.json({ok:true,counted:false});
      const [payload,signature] = String(req.body?.token || '').split('.');
      if (!payload || !/^[a-f0-9]{64}$/.test(signature || '') || !crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(sign(payload)))) return res.json({ok:true,counted:false});
      const {p,v,t} = JSON.parse(Buffer.from(payload,'base64url').toString());
      const now = clock();
      if (v !== cookies(req).luce_reader || now-t > WINDOW_MS || now-t < 0 || publicPath(req.body.path) !== p || req.body.visible !== true) return res.json({ok:true,counted:false});
      if (p.startsWith('/blog/')) {
        const post = await pool.query('SELECT id FROM blog_posts WHERE slug=$1 AND published=1',[p.slice(6)]);
        if (!post.rows.length) return res.json({ok:true,counted:false});
      }
      let referrer = '';
      try { const ref = new URL(req.body.referrer); if (/^https?:$/.test(ref.protocol) && ref.host !== origin.host) referrer=ref.origin; } catch {}
      // Atomic rolling-window gate handles concurrent refreshes/tabs and survives deployments.
      const result = await pool.query(`WITH accepted AS (
        INSERT INTO filtered_analytics_dedup(visitor,path,last_seen) VALUES($1,$2,$3)
        ON CONFLICT(visitor,path) DO UPDATE SET last_seen=EXCLUDED.last_seen
        WHERE filtered_analytics_dedup.last_seen <= $3::timestamptz - INTERVAL '30 minutes'
        RETURNING visitor,path
      ) INSERT INTO filtered_page_views(visitor,path,referrer,created_at)
        SELECT visitor,path,$4,$3 FROM accepted RETURNING id`,[sign(v),p,new Date(now),referrer]);
      res.json({ok:true,counted:result.rows.length === 1});
    } catch (error) { console.error('Filtered analytics event failed:', error.message); res.json({ok:true,counted:false}); }
  }
  async function summary() {
    const totals = (await pool.query(`SELECT COUNT(*)::int AS total, COUNT(DISTINCT visitor)::int AS unique_total,
      COUNT(*) FILTER(WHERE (created_at AT TIME ZONE 'America/Los_Angeles')::date = (NOW() AT TIME ZONE 'America/Los_Angeles')::date)::int AS today,
      COUNT(*) FILTER(WHERE created_at >= NOW()-INTERVAL '7 days')::int AS week,
      COUNT(*) FILTER(WHERE created_at >= NOW()-INTERVAL '30 days')::int AS month,
      COUNT(DISTINCT visitor) FILTER(WHERE created_at >= NOW()-INTERVAL '30 days')::int AS unique_month
      FROM filtered_page_views`)).rows[0];
    const topPages = (await pool.query('SELECT path,COUNT(*)::int AS views FROM filtered_page_views GROUP BY path ORDER BY views DESC LIMIT 10')).rows;
    const dailyViews = (await pool.query(`SELECT (created_at AT TIME ZONE 'America/Los_Angeles')::date::text AS date, COUNT(*)::int AS views FROM filtered_page_views WHERE created_at >= NOW()-INTERVAL '30 days' GROUP BY 1 ORDER BY 1 DESC`)).rows;
    const topReferrers = (await pool.query("SELECT referrer,COUNT(*)::int AS views FROM filtered_page_views WHERE referrer != '' GROUP BY referrer ORDER BY views DESC LIMIT 10")).rows;
    const startedAt = (await pool.query('SELECT started_at FROM filtered_analytics_meta WHERE id=1')).rows[0].started_at;
    const legacyTotal = (await pool.query('SELECT COUNT(*)::int AS count FROM page_views')).rows[0].count;
    return {...totals,topPages,dailyViews,topReferrers,startedAt,legacyTotal};
  }
  function register(app) {
    app.get('/reader-tracking.js',(req,res)=>res.type('js').send(fs.readFileSync(path.join(__dirname,'reader-tracking.js'),'utf8')));
    app.post('/api/track',record);
  }
  return {initialize,middleware,register,summary};
}
module.exports = {createAnalytics,publicPath,excluded,markAdmin};
