const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {createNewsletterService}=require('../newsletter');

async function harness(){
 const db=new PGlite(),sent=[],validated=new Set();let now=new Date('2026-09-20T10:00:00Z'),sequence=0,mode='ok';
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 await db.exec(`CREATE TABLE newsletter_subscribers(id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,subscribed_at TIMESTAMP DEFAULT NOW(),active INTEGER DEFAULT 1,unsubscribe_token TEXT,source TEXT DEFAULT 'luce-healing');
 CREATE TABLE admin_settings(key TEXT PRIMARY KEY,value TEXT);INSERT INTO admin_settings VALUES('smtp_user','lucehealing13@gmail.com');
 CREATE TABLE blog_posts(id SERIAL PRIMARY KEY,title TEXT,slug TEXT UNIQUE,content TEXT,excerpt TEXT,published INTEGER DEFAULT 1,created_at TIMESTAMP DEFAULT NOW(),updated_at TIMESTAMP DEFAULT NOW());
 CREATE TABLE newsletter_sends(id SERIAL PRIMARY KEY,send_id TEXT UNIQUE,blog_post_id INTEGER,subject TEXT,sent_at TIMESTAMP DEFAULT NOW(),recipients_count INTEGER DEFAULT 0);
 INSERT INTO newsletter_subscribers(email,name,active) VALUES('legacy@example.com','Preserved historical subscriber',1),('optedout@example.com','Unsubscribed historical subscriber',0);
 INSERT INTO blog_posts(title,slug,content,excerpt) VALUES('Original article','original-article','<h2>Original article body</h2><p>Keep this article intact.</p>','An existing article');`);
 const env={TURNSTILE_SITE_KEY:'private-test-site',TURNSTILE_SECRET_KEY:'private-test-secret',TURNSTILE_HOSTNAMES:'localhost',NEWSLETTER_BASE_URL:'http://localhost',NEWSLETTER_WORKER_ENABLED:'true',NEWSLETTER_TRUST_PROXY_HOPS:'1'};
 const transporter={verify:async()=>{if(mode==='offline')throw Error('offline');},sendMail:async mail=>{sent.push(mail);if(mode==='timeout'&&!mail.subject.startsWith('Confirm'))throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});if(mode==='bounce'&&!mail.subject.startsWith('Confirm'))throw Object.assign(Error('no mailbox'),{command:'RCPT TO',responseCode:550});return {accepted:[mail.to],messageId:'local-'+sent.length};}};
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const data=JSON.parse(options.body);assert.equal(data.secret,env.TURNSTILE_SECRET_KEY);
  const valid=data.response.startsWith('valid-')&&!validated.has(data.response);validated.add(data.response);
  return {ok:true,json:async()=>({success:valid,hostname:data.response.includes('wrong-host')?'elsewhere.example':'localhost',action:data.response.includes('wrong-action')?'contact':'newsletter_signup'})};
 };
 const service=createNewsletterService({pool,env,getTransporter:()=>transporter,fetcher,clock:()=>now});
 await service.initialize();
 const app=express();app.use(express.json());service.register(app,(req,res,next)=>req.query.password==='test-only'?next():res.status(401).json({error:'Unauthorized'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const call=async(p,method='GET',body,ip='192.0.2.1')=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json','x-forwarded-for':ip},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 const admin=(p,m='GET',b)=>call('/api/admin/newsletter'+p+'?password=test-only',m,b);
 const signup=(email,prefs={wants_newsletter:true,wants_blog:true},extra={})=>call('/api/newsletter/subscribe','POST',{email,name:'Test',...prefs,turnstile_token:'valid-'+(++sequence),...extra},'192.0.2.'+(sequence+1));
 const confirmation=()=>sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
 const confirm=secret=>call('/api/newsletter/confirm','POST',{token:secret});
 const verified=async(email,prefs)=>{const r=await signup(email,prefs);assert.equal(r.status,200,JSON.stringify(r));const c=await confirm(confirmation());assert.equal(c.status,200,JSON.stringify(c));return c.data.preferencesUrl.split('token=')[1];};
 const draft=async(segment='newsletter',more={})=>{const r=await admin('/campaigns','POST',{subject:'A Luce Healing update',content:'A quiet moment to reflect.\n\nA second paragraph.',segment,...more});assert.equal(r.status,200,JSON.stringify(r));return r.data;};
 return {db,pool,service,env,sent,admin,call,signup,confirmation,confirm,verified,draft,setMode:x=>mode=x,advance:ms=>{now=new Date(now.getTime()+ms);},now:()=>now,close:async()=>{service.stop();await new Promise(r=>server.close(r));await db.close();}};
}

test('migration preserves old data, flags historical uncertainty, and is idempotent',async()=>{const h=await harness();try{
 const before=(await h.db.query('SELECT id,email,name,active,subscribed_at FROM newsletter_subscribers ORDER BY id')).rows;
 const blogs=(await h.db.query('SELECT title,slug,content,published FROM blog_posts')).rows;
 await h.service.initialize();assert.deepEqual((await h.db.query('SELECT id,email,name,active,subscribed_at FROM newsletter_subscribers ORDER BY id')).rows,before);assert.deepEqual((await h.db.query('SELECT title,slug,content,published FROM blog_posts')).rows,blogs);
 assert.deepEqual((await h.admin('/subscribers')).data.map(x=>x.status),['unsubscribed','legacy_unverified']);
 assert.equal((await h.call('/api/admin/newsletter/subscribers')).status,401);
 assert(!(await h.admin('/subscribers')).data.some(x=>'verification_hash' in x||'unsubscribe_token' in x));
}finally{await h.close();}});

test('server-side anti-bot controls reject missing, forged, reused, wrong-host/action tokens and rate-limit persistent attempts',async()=>{const h=await harness();try{
 for(const value of ['', 'forged', 'valid-wrong-host','valid-wrong-action'])assert.equal((await h.signup('person@example.com',undefined,{turnstile_token:value})).status,400);
 assert.equal((await h.signup('person@example.com',undefined,{turnstile_token:'valid-once'})).status,200);
 assert.equal((await h.signup('person@example.com',undefined,{turnstile_token:'valid-once'})).status,400);
 const count=h.sent.length;assert.equal((await h.signup('trap@example.com',undefined,{website:'spam'})).status,200);assert.equal(h.sent.length,count);assert.equal((await h.db.query("SELECT id FROM newsletter_subscribers WHERE email='trap@example.com'")).rows.length,0);
 for(let i=0;i<12;i++)await h.call('/api/newsletter/subscribe','POST',{email:'bad',turnstile_token:'bad'},'198.51.100.8');
 assert.equal((await h.call('/api/newsletter/subscribe','POST',{},'198.51.100.8')).status,429);
 const another=createNewsletterService({pool:h.pool,getTransporter:()=>null,env:h.env});
 assert.equal(another.clientIP({headers:{'x-forwarded-for':'spoof, 198.51.100.8'},socket:{remoteAddress:'127.0.0.1'}}),'198.51.100.8');
 delete h.env.TURNSTILE_SECRET_KEY;assert.equal((await h.signup('closed@example.com')).status,503);
}finally{await h.close();}});

test('double opt-in, expiry, cooldown, resends, replay protection and preference changes',async()=>{const h=await harness();try{
 await h.signup(' Person@Example.COM ',{wants_newsletter:true,wants_blog:false});const original=h.confirmation();
 let row=(await h.db.query("SELECT * FROM newsletter_subscribers WHERE email='person@example.com'")).rows[0];assert.equal(row.status,'pending');assert.equal(row.active,0);assert.notEqual(row.verification_hash,original);
 assert.equal((await h.confirm('a'.repeat(64))).status,410);
 const count=h.sent.length;await h.signup('person@example.com');assert.equal(h.sent.length,count);
 h.advance(86400001);assert.equal((await h.confirm(original)).status,410);
 await h.signup('person@example.com',{wants_newsletter:true,wants_blog:false});const result=await h.confirm(h.confirmation());assert.equal(result.status,200);assert.equal((await h.confirm(h.confirmation())).status,410);
 const secret=result.data.preferencesUrl.split('token=')[1];let prefs=await h.call('/api/newsletter/preferences?token='+secret);assert.equal(prefs.data.wants_newsletter,true);assert.equal(prefs.data.wants_blog,false);
 assert.equal((await h.call('/api/newsletter/preferences','POST',{token:secret,wants_newsletter:false,wants_blog:true})).status,200);
 prefs=await h.call('/api/newsletter/preferences?token='+secret);assert.equal(prefs.data.wants_blog,true);assert.equal(prefs.data.wants_newsletter,false);
 await h.call('/api/newsletter/unsubscribe','POST',{token:secret});row=(await h.db.query("SELECT * FROM newsletter_subscribers WHERE email='person@example.com'")).rows[0];assert.equal(row.status,'unsubscribed');assert.equal(row.name,'Test');assert(row.verified_at);
 h.advance(86400000);await h.signup('person@example.com');assert.equal((await h.db.query("SELECT status FROM newsletter_subscribers WHERE email='person@example.com'")).rows[0].status,'unsubscribed');await h.confirm(h.confirmation());assert.equal((await h.db.query("SELECT status FROM newsletter_subscribers WHERE email='person@example.com'")).rows[0].status,'verified');
}finally{await h.close();}});

test('draft, preview, send-now, segmentation, deduplication and email unsubscribe footer',async()=>{const h=await harness();try{
 await h.verified('news@example.com',{wants_newsletter:true,wants_blog:false});await h.verified('blog@example.com',{wants_newsletter:false,wants_blog:true});await h.verified('both@example.com',{wants_newsletter:true,wants_blog:true});await h.signup('pending@example.com');
 let c=await h.draft();const before=h.sent.length;
 const preview=await h.admin('/preview','POST',{subject:c.subject,content:c.content,segment:c.segment});assert.equal(preview.status,200);assert(preview.data.html.includes('Manage email preferences'));assert.equal(h.sent.length,before);
 const queued=await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision});assert.equal(queued.status,200);await Promise.all([h.service.tick(),h.service.tick()]);
 const sends=h.sent.slice(before);assert.deepEqual(sends.map(x=>x.to).sort(),['both@example.com','news@example.com']);for(const mail of sends){assert.match(mail.html,/unsubscribe\?token=[a-f0-9]{64}/);assert.match(mail.html,/newsletter\/preferences\?token=/);assert.equal(mail.from.address,'lucehealing13@gmail.com');assert(mail.headers['List-Unsubscribe-Post']);assert(!mail.html.includes('PREVIEW'));}
 assert.equal((await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision})).status,409);await h.service.tick();assert.equal(h.sent.length,before+2);
 c=await h.draft('blog',{blog_post_id:1});await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision});await h.service.tick();assert.deepEqual(h.sent.slice(before+2).map(x=>x.to).sort(),['blog@example.com','both@example.com']);assert(h.sent.at(-1).text.includes('Keep this article intact.'));
 assert.equal((await h.admin('/send','POST',{blogPostId:1})).status,409);
}finally{await h.close();}});

test('schedules survive service recreation, support edit/cancel, and respect last-minute unsubscribes',async()=>{const h=await harness();try{
 const secret=await h.verified('scheduled@example.com');let c=await h.draft();
 c=(await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision,scheduled_at:new Date(h.now().getTime()+3600000).toISOString()})).data;
 const before=h.sent.length;await h.service.tick();assert.equal(h.sent.length,before);
 assert.equal((await h.admin('/campaigns/'+c.id,'PUT',{subject:'Edited scheduled draft',content:'Edited content',segment:'newsletter',revision:c.revision-1})).status,409);
 c=(await h.admin('/campaigns/'+c.id,'PUT',{subject:'Edited scheduled draft',content:'Edited content',segment:'newsletter',revision:c.revision})).data;assert.equal(c.status,'draft');
 c=(await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision,scheduled_at:new Date(h.now().getTime()+3600000).toISOString()})).data;
 c=(await h.admin('/campaigns/'+c.id+'/cancel','POST',{revision:c.revision})).data;assert.equal(c.status,'canceled');h.advance(3600001);await h.service.tick();assert.equal(h.sent.length,before);
 c=(await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision})).data;await h.call('/api/newsletter/one-click?token='+secret,'POST',{});
 const restart=createNewsletterService({pool:h.pool,env:h.env,getTransporter:()=>({verify:async()=>{},sendMail:async()=>{throw Error('Unsubscribed person must never be sent an email')}}),clock:h.now});await restart.tick();assert.equal((await h.admin('/campaigns')).data[0].status,'sent');assert.equal((await h.admin('/campaigns/'+c.id+'/deliveries')).data.length,0);
}finally{await h.close();}});

test('blog publication is independent of email; scheduled opt-in emails target only the blog audience',async()=>{const h=await harness();try{
 await h.verified('blog-reader@example.com',{wants_newsletter:false,wants_blog:true});await h.verified('news-only@example.com',{wants_newsletter:true,wants_blog:false});const before=h.sent.length;
 await h.service.saveBlog({title:'Publish only',slug:'publish-only',content:'<p>No email please.</p>',published:true,email_blog:false});await h.service.tick();assert.equal(h.sent.length,before);
 const post=await h.service.saveBlog({title:'Scheduled astrology',slug:'scheduled-astrology',content:'<p>A future article.</p>',publish_at:new Date(h.now().getTime()+3600000).toISOString(),email_blog:true});assert.equal(post.published,0);await h.service.tick();assert.equal(h.sent.length,before);
 h.advance(3600001);await h.service.tick();assert.equal((await h.db.query('SELECT published FROM blog_posts WHERE id=$1',[post.id])).rows[0].published,1);assert.equal(h.sent.length,before+1);assert.equal(h.sent.at(-1).to,'blog-reader@example.com');
 await h.service.saveBlog({title:post.title,slug:post.slug,content:post.content,published:true,email_blog:true},post.id);await h.service.tick();assert.equal(h.sent.length,before+1,'Saving again must not repeat the original publication email');
 const canceled=await h.service.saveBlog({title:'Canceled publication',slug:'canceled-publication',content:'<p>Draft</p>',publish_at:new Date(h.now().getTime()+3600000).toISOString(),email_blog:true});await h.service.saveBlog({title:canceled.title,slug:canceled.slug,content:canceled.content,published:false,email_blog:false},canceled.id);h.advance(3600001);await h.service.tick();assert.equal((await h.db.query('SELECT published FROM blog_posts WHERE id=$1',[canceled.id])).rows[0].published,0);
}finally{await h.close();}});

test('failures are honest, uncertain sends are not retried, and explicit permanent bounces are suppressed',async()=>{const h=await harness();try{
 await h.verified('failure@example.com');let c=await h.draft();const before=h.sent.length;h.setMode('offline');await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision});await h.service.tick();assert.equal(h.sent.length,before);assert.equal((await h.admin('/campaigns')).data[0].status,'scheduled');
 h.setMode('timeout');h.advance(300001);await h.service.tick();assert.equal((await h.admin('/campaigns')).data[0].status,'partial');assert.equal((await h.admin('/campaigns/'+c.id+'/deliveries')).data[0].status,'unknown');await h.service.tick();assert.equal(h.sent.length,before+1);
 h.setMode('bounce');c=await h.draft();await h.admin('/campaigns/'+c.id+'/queue','POST',{revision:c.revision});await h.service.tick();assert.equal((await h.db.query("SELECT status FROM newsletter_subscribers WHERE email='failure@example.com'")).rows[0].status,'bounced');
 await h.db.query("UPDATE admin_settings SET value='wrong-brand@example.com' WHERE key='smtp_user'");assert.equal((await h.signup('other@example.com')).status,503);
}finally{await h.close();}});
