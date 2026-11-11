const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createBlogOrder,orderBy}=require('../blog-order');
test('editorial order persists, seeds November once, prepends newly published posts, and preserves content and dates',async()=>{
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
 assert.deepEqual(await ids(),[5,1,2,3]);await service.save([5,1,2,3],[5,1,2,3]);
 assert.deepEqual(await ids(),[5,1,2,3]);
 await db.exec('UPDATE blog_posts SET published=1 WHERE id=4');assert.deepEqual(await ids(),[4,5,1,2,3]);
 await db.exec('DELETE FROM blog_posts WHERE id=2');assert.deepEqual(await ids(),[4,5,1,3]);
 }finally{await db.close();}
});
test('all touch controls persist through reloads and publication preserves manual ordering',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');
 const db=new PGlite(),pool={connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const dom=new JSDOM('<div id="postsList"></div>',{runScripts:'outside-only',url:'https://lucehealing.com'}),w=dom.window;
 try{
 await db.exec(`CREATE TABLE blog_posts(id SERIAL PRIMARY KEY,title TEXT,slug TEXT,content TEXT,created_at TIMESTAMPTZ,publish_at TIMESTAMPTZ,published INTEGER);
 INSERT INTO blog_posts(title,slug,content,created_at,published) VALUES
 ('November forecast','november-2026-astrology-forecast','unchanged','2026-10-20',1),
 ('New Moon','november-2026-scorpio-new-moon-meaning-rituals','unchanged','2026-11-08',1),
 ('Two week','two-week-astrology-forecast-mercury-retrograde-scorpio-new-moon-2026','unchanged','2026-10-28',1),
 ('Older','older','unchanged','2026-01-01',1);
 INSERT INTO blog_posts(title,slug,created_at,publish_at,published) VALUES('Scheduled','scheduled','2026-01-01','2026-12-01',0);`);
 const svc=createBlogOrder(pool);await svc.initialize();
 const rows=async()=>(await db.query(`SELECT * FROM blog_posts ORDER BY published DESC,${orderBy()}`)).rows;
 const ids=async()=>(await rows()).filter(p=>p.published).map(p=>p.id);
 const original=(await db.query('SELECT * FROM blog_posts ORDER BY id')).rows;
 assert.deepEqual(await ids(),[1,2,3,4]);
 // Qualified and unqualified order queries must agree (admin/public).
 assert.deepEqual((await db.query(`SELECT b.id FROM blog_posts b WHERE published=1 ORDER BY ${orderBy('b')}`)).rows.map(r=>r.id),await ids());
 w.fetch=async(url,opts)=>{try{return {ok:true,json:async()=>opts.method==='PUT'?await svc.save(...((b)=>[b.ids,b.previous])(JSON.parse(opts.body))):await rows()};}catch(e){return {ok:false,json:async()=>({error:e.message})};}};
 w.eval(fs.readFileSync(require.resolve('../admin-mobile.js'),'utf8'));
 async function move(id,dir,expected){
 await w.loadPosts();w.document.querySelector(`[data-move="${id}"][data-direction="${dir}"]`).click();
 for(let n=0;n<100&&!w.document.getElementById('blog-order-message').textContent;n++)await new Promise(r=>setTimeout(r,5));
 assert.match(w.document.getElementById('blog-order-message').textContent,/Order saved/);
 assert.deepEqual(await ids(),expected);await w.loadPosts();
 assert.deepEqual([...w.document.querySelectorAll('#blog-order-list [data-direction="top"]')].map(b=>Number(b.dataset.move)),expected);
 }
 await move(3,'-1',[1,3,2,4]);await move(3,'1',[1,2,3,4]);await move(3,'top',[3,1,2,4]);
 await createBlogOrder(pool).initialize();assert.deepEqual(await ids(),[3,1,2,4]);
 assert.deepEqual((await db.query('SELECT * FROM blog_posts ORDER BY id')).rows,original);
 await db.exec("UPDATE blog_posts SET publish_at='2026-12-02' WHERE id=5");assert.deepEqual(await ids(),[3,1,2,4]);
 await db.exec('UPDATE blog_posts SET published=1,publish_at=NULL WHERE id=5');assert.deepEqual(await ids(),[5,3,1,2,4]);
 await move(5,'1',[3,5,1,2,4]);
 await db.exec("UPDATE blog_posts SET title='Scheduled edited' WHERE id=5");assert.deepEqual(await ids(),[3,5,1,2,4]);
 }finally{w.close();await db.close();}
});
