const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {createAnalytics,publicPath}=require('../analytics');
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1';
async function harness(){
 const db=new PGlite();let now=Date.now();
 await db.exec("CREATE TABLE blog_posts(id SERIAL PRIMARY KEY,slug TEXT,published INTEGER,view_count INTEGER); INSERT INTO blog_posts(slug,published,view_count) VALUES('sample',1,193),('draft',0,17); CREATE TABLE page_views(id SERIAL PRIMARY KEY,path TEXT); INSERT INTO page_views(path) VALUES('/'),('/#admin');");
 const service=createAnalytics({pool:db,clock:()=>now});await service.initialize();
 const app=express();app.use(express.json());app.use(service.middleware);service.register(app);require('../public-navigation').install(app,require('path').resolve(__dirname,'..'));
 app.get('/blog/:slug',async(req,res)=>{const p=(await db.query('SELECT * FROM blog_posts WHERE slug=$1 AND published=1',[req.params.slug])).rows[0];res.status(p?200:404).send('<html><body>Article</body></html>');});
 app.get('/',(req,res)=>res.sendFile(require('path').resolve(__dirname,'../index.html')));
 app.get('/admin',(req,res)=>res.send('<html><body>Admin</body></html>'));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const get=async(p='/blog/sample',cookie='',headers={},method='GET')=>{const r=await fetch(base+p,{method,headers:{'user-agent':UA,cookie,...headers}});const text=await r.text();return {status:r.status,token:text.match(/data-token="([^"]+)"/)?.[1],cookie:r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),text};};
 const send=async(page,extra={},headers={})=>{const r=await fetch(base+'/api/track',{method:'POST',headers:{'content-type':'application/json','user-agent':UA,origin:base,cookie:page.cookie,...headers},body:JSON.stringify({token:page.token,path:'/blog/sample',visible:true,...extra})});return r.json();};
 return {db,service,get,send,advance:ms=>now+=ms,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
test('public visit, repeat/concurrent refreshes, unique browsers, expiry and legacy preservation',async()=>{const h=await harness();try{
 const legacy=await h.db.query('SELECT * FROM blog_posts ORDER BY id');const oldEvents=await h.db.query('SELECT * FROM page_views ORDER BY id');
 const page=await h.get();assert(page.token);assert.equal((await h.send(page)).counted,true);
 const repeats=await Promise.all(Array.from({length:8},()=>h.send(page)));assert(repeats.every(r=>!r.counted));
 const refresh=await h.get('/blog/sample',page.cookie);assert.equal((await h.send(refresh)).counted,false);
 const home=await h.get('/',page.cookie);assert(home.token);assert.equal((await h.send(home,{path:'/'})).counted,true);
 const summary=await h.service.summary();assert.equal(summary.total,2);assert.equal(summary.unique_total,1);assert.equal(summary.legacyTotal,2);assert(summary.topPages.some(x=>x.path==='/blog/sample'&&x.views===1));
 const other=await h.get();assert.equal((await h.send(other)).counted,true);assert.equal((await h.service.summary()).unique_total,2);
 h.advance(31*60000);assert.equal((await h.send(page)).counted,false);const later=await h.get('/blog/sample',page.cookie);assert.equal((await h.send(later)).counted,true);
 await h.service.initialize();assert.deepEqual((await h.db.query('SELECT * FROM blog_posts ORDER BY id')).rows,legacy.rows);assert.deepEqual((await h.db.query('SELECT * FROM page_views ORDER BY id')).rows,oldEvents.rows);
}finally{await h.close();}});
test('admin, preview, HEAD, bots, prefetch, draft, forged and cross-origin events excluded',async()=>{const h=await harness();try{
 const page=await h.get();
 for(const p of ['/admin','/blog/sample?preview=1','/blog/draft','/blog/missing']) assert.equal((await h.get(p)).token,undefined,p);
 assert.equal((await h.get('/blog/sample','',{},'HEAD')).token,undefined);
 for(const ua of ['Googlebot',UA+' facebookexternalhit',UA+' HeadlessChrome','curl/8','UptimeRobot']) {assert.equal((await h.get('/blog/sample','',{'user-agent':ua})).token,undefined);assert.equal((await h.send(page,{}, {'user-agent':ua})).counted,false);}
 assert.equal((await h.get('/blog/sample','',{purpose:'prefetch'})).token,undefined);
 const admin=await h.get('/admin');assert(admin.cookie.includes('luce_analytics_admin=1'));assert.equal((await h.get('/blog/sample',admin.cookie)).token,undefined);
 assert.equal((await h.send(page,{}, {cookie:page.cookie+'; '+admin.cookie})).counted,false);
 for(const extra of [{path:'/admin'},{path:'/blog/sample?preview=1'},{path:'/#admin'},{visible:false},{token:'forged'}])assert.equal((await h.send(page,extra)).counted,false);
 assert.equal((await h.send(page,{}, {origin:'https://elsewhere.example'})).counted,false);
 assert.equal((await h.send(page,{}, {referer:'https://lucehealing.com/admin'})).counted,false);
 assert.equal((await h.service.summary()).total,0);
 const campaign=await h.get('/blog/sample?utm_source=instagram');assert(campaign.token);assert.equal((await h.send(campaign,{path:'/blog/sample?utm_source=instagram'})).counted,true);
}finally{await h.close();}});
test('public page aliases normalize; server never updates legacy counts and both admin lists label counts',()=>{
 for(const p of ['/','/blog','/reading','/gift','/forecast','/subscribe','/pricing.html','/astrology-membership','/memes-gallery.html'])assert(publicPath(p));
 assert.equal(publicPath('/index.html'),'/');assert.equal(publicPath('/reading.html'),'/reading');
 const source=fs.readFileSync(require.resolve('../server'),'utf8');assert(!/UPDATE blog_posts SET view_count/.test(source));assert(!/INSERT INTO page_views/.test(source));assert(source.includes('analytics.initialize()'));assert(source.includes('analytics.middleware'));assert(source.includes("require('./analytics').markAdmin(req, res)"));
 for(const file of ['../index.html','../admin.html']){const text=fs.readFileSync(require.resolve(file),'utf8');assert(text.includes('Legacy Views'));assert(text.includes('Filtered Reader Views'));}
});
test('browser script waits for visible page and excludes admin/hash, stored admin, automation',async()=>{
 const {JSDOM}=require('jsdom');const source=fs.readFileSync(require.resolve('../reader-tracking'),'utf8');
 for(const mode of ['normal','hidden','admin','stored','automated']){
  const dom=new JSDOM('<script data-token="test"></script>',{url:'https://lucehealing.com/blog/sample'+(mode==='admin'?'#admin':''),runScripts:'outside-only'}),w=dom.window;const calls=[],timers=[];
  Object.defineProperty(w.document,'currentScript',{value:w.document.querySelector('script')});Object.defineProperty(w.document,'visibilityState',{value:mode==='hidden'?'hidden':'visible'});Object.defineProperty(w.navigator,'webdriver',{value:mode==='automated'});
  if(mode==='stored')w.sessionStorage.setItem('luce-admin-pw','test-only');w.setTimeout=fn=>timers.push(fn);w.clearTimeout=()=>{};w.fetch=(...a)=>{calls.push(a);return Promise.resolve();};w.eval(source);timers.forEach(fn=>fn());assert.equal(calls.length,mode==='normal'?1:0,mode);w.close();
 }
});
