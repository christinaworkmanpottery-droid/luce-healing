// Editorial order is independent of content, publication dates and newsletter delivery.
const orderBy = (alias = '') => {
  const p = (alias || 'blog_posts') + '.';
  return `(SELECT position FROM blog_editorial_order WHERE post_id=${p}id) ASC NULLS FIRST, ${p}created_at DESC, ${p}id DESC`;
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
      await c.query('LOCK TABLE blog_posts IN SHARE ROW EXCLUSIVE MODE');
      await c.query('LOCK TABLE blog_editorial_meta IN EXCLUSIVE MODE');
      if (!(await c.query('SELECT id FROM blog_editorial_meta WHERE id=1')).rows.length) {
      // Only the monthly November forecast is seeded first; never repeat this on restart.
      await c.query(`INSERT INTO blog_editorial_order(post_id,position)
        SELECT id, ROW_NUMBER() OVER (ORDER BY CASE WHEN (title || ' ' || slug) ~* 'november[ -]+2026' AND (title || ' ' || slug) ~* 'forecast|horoscope' THEN 0 ELSE 1 END, created_at DESC, id DESC)::int
        FROM blog_posts WHERE published=1`);
      await c.query('INSERT INTO blog_editorial_meta(id) VALUES(1)');
      }
      // One-time correction, using existing slugs; only editorial positions change.
      if (!(await c.query('SELECT id FROM blog_editorial_meta WHERE id=2')).rows.length) {
        const slugs = ['november-2026-astrology-forecast', 'november-2026-scorpio-new-moon-meaning-rituals', 'two-week-astrology-forecast-mercury-retrograde-scorpio-new-moon-2026'];
        const rows = (await c.query(`SELECT id,slug FROM blog_posts WHERE published=1 ORDER BY ${orderBy()}`)).rows;
        const chosen = slugs.map(slug => rows.find(r => r.slug === slug)).filter(Boolean);
        const ordered = chosen.concat(rows.filter(r => !chosen.some(p => p.id === r.id)));
        for (let i=0; i<ordered.length; i++) await c.query('INSERT INTO blog_editorial_order(post_id,position) VALUES($1,$2) ON CONFLICT(post_id) DO UPDATE SET position=EXCLUDED.position', [ordered[i].id,i+1]);
        await c.query('INSERT INTO blog_editorial_meta(id) VALUES(2)');
      }
      // Fires inside the publishing transaction, including scheduled publication.
      await c.query(`CREATE OR REPLACE FUNCTION blog_promote_on_publish() RETURNS trigger AS $$
        BEGIN
          IF NEW.published=1 THEN
            IF TG_OP='INSERT' OR OLD.published IS DISTINCT FROM 1 THEN
              LOCK TABLE blog_editorial_order IN EXCLUSIVE MODE;
              INSERT INTO blog_editorial_order(post_id,position)
              SELECT NEW.id, COALESCE(MIN(position),1)-1 FROM blog_editorial_order
              ON CONFLICT(post_id) DO UPDATE SET position=EXCLUDED.position;
            END IF;
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql`);
      await c.query('DROP TRIGGER IF EXISTS blog_promote_on_publish ON blog_posts');
      await c.query('CREATE TRIGGER blog_promote_on_publish AFTER INSERT OR UPDATE OF published ON blog_posts FOR EACH ROW EXECUTE FUNCTION blog_promote_on_publish()');
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
