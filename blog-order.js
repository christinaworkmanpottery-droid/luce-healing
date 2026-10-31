// Editorial order is independent of content, publication dates and newsletter delivery.
const orderBy = (alias = '') => {
  const p = alias ? alias + '.' : '';
  return `(SELECT position FROM blog_editorial_order WHERE post_id=${p}id) ASC NULLS LAST, ${p}created_at ASC, ${p}id ASC`;
};
function createBlogOrder(pool) {
  async function transaction(fn) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function initialize() {
    await transaction(async c => {
      await c.query('CREATE TABLE IF NOT EXISTS blog_editorial_order (post_id INTEGER PRIMARY KEY REFERENCES blog_posts(id) ON DELETE CASCADE, position INTEGER NOT NULL)');
      await c.query('CREATE TABLE IF NOT EXISTS blog_editorial_meta (id INTEGER PRIMARY KEY, initialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await c.query('LOCK TABLE blog_editorial_meta IN EXCLUSIVE MODE');
      if ((await c.query('SELECT id FROM blog_editorial_meta WHERE id=1')).rows.length) return;
      // Only the monthly November forecast is seeded first; never repeat this on restart.
      await c.query(`INSERT INTO blog_editorial_order(post_id,position)
        SELECT id, ROW_NUMBER() OVER (ORDER BY CASE WHEN (title || ' ' || slug) ~* 'november[ -]+2026' AND (title || ' ' || slug) ~* 'forecast|horoscope' THEN 0 ELSE 1 END, created_at DESC, id DESC)::int
        FROM blog_posts WHERE published=1`);
      await c.query('INSERT INTO blog_editorial_meta(id) VALUES(1)');
    });
  }
  async function save(ids, previous) {
    if (!Array.isArray(ids) || !Array.isArray(previous) || ids.some(id => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) {
      throw Object.assign(new Error('Provide each published post exactly once.'), {status:400});
    }
    return transaction(async c => {
      await c.query('LOCK TABLE blog_posts IN SHARE ROW EXCLUSIVE MODE');
      await c.query('LOCK TABLE blog_editorial_order IN EXCLUSIVE MODE');
      const current = (await c.query(`SELECT id FROM blog_posts WHERE published=1 ORDER BY ${orderBy()}`)).rows.map(p => p.id);
      if (JSON.stringify(current) !== JSON.stringify(previous)) throw Object.assign(new Error('Posts changed in another session. Refresh the list and try again.'), {status:409});
      if (ids.length !== current.length || ids.some(id => !current.includes(id))) throw Object.assign(new Error('Include all published posts, and no drafts.'), {status:400});
      for (let i=0;i<ids.length;i++) await c.query('INSERT INTO blog_editorial_order(post_id,position) VALUES($1,$2) ON CONFLICT(post_id) DO UPDATE SET position=EXCLUDED.position',[ids[i],i+1]);
      return {ids};
    });
  }
  return {initialize,save};
}
module.exports={createBlogOrder,orderBy};
