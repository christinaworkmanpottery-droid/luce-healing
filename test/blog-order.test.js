const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createBlogOrder,orderBy}=require('../blog-order');
test('editorial order persists, seeds November once, appends new posts, and preserves content and dates',async()=>{
 const db=new PGlite();const pool={connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 try{
 await db.exec(`CREATE TABLE blog_posts(id SERIAL PRIMARY KEY,title TEXT,slug TEXT,content TEXT,created_at TIMESTAMPTZ,published INTEGER);
 INSERT INTO blog_posts(title,slug,content,created_at,published) VALUES ('Older','older','first','2026-01-01',1),('November 2026 Astrology Forecast','november-2026-astrology-forecast','forecast','2026-10-20',1),('Newest','newest','third','2026-10-31',1),('Draft','draft','draft','2026-11-01',0);`);
 const original=(await db.query('SELECT * FROM blog_posts ORDER BY id')).rows;
 const service=createBlogOrder(pool),ids=async()=>(await db.query(`SELECT id FROM blog_posts WHERE published=1 ORDER BY ${orderBy()}`)).rows.map(r=>r.id);
 await service.initialize();assert.deepEqual(await ids(),[2,3,1]);
 await service.save([1,2,3],[2,3,1]);assert.deepEqual(await ids(),[1,2,3]);
 await createBlogOrder(pool).initialize();assert.deepEqual(await ids(),[1,2,3]);
 assert.deepEqual((await db.query('SELECT * FROM blog_posts ORDER BY id')).rows,original);
 await assert.rejects(service.save([2,1,3],[2,3,1]),{status:409});assert.deepEqual(await ids(),[1,2,3]);
 for(const invalid of [[1,1,3],[1,2],[1,2,4],[1,'2',3]])await assert.rejects(service.save(invalid,[1,2,3]),{status:400});
 await db.exec("INSERT INTO blog_posts(title,slug,created_at,published) VALUES('New article','new','2026-11-02',1)");
 assert.deepEqual(await ids(),[1,2,3,5]);await service.save([5,1,2,3],[1,2,3,5]);
 assert.deepEqual(await ids(),[5,1,2,3]);
 await db.exec('UPDATE blog_posts SET published=1 WHERE id=4');assert.deepEqual(await ids(),[5,1,2,3,4]);
 await db.exec('DELETE FROM blog_posts WHERE id=2');assert.deepEqual(await ids(),[5,1,3,4]);
 }finally{await db.close();}
});
