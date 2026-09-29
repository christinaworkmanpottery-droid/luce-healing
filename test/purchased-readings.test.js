const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),crypto=require('crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createMembership,signs}=require('../private-membership/service');
const source='Make room to review your commitments and consider which relationships support a balanced life. Give yourself time to reflect before making a choice.';
const generated=()=>({paragraphs:Array.from({length:5},(_,i)=>({text:`Reflection ${i+1}. Your priorities can become clearer when you pause and ask what feels sustainable for you. You can use this month as an invitation to listen closely to your needs, notice where you feel supported, and give your decisions enough space to develop. Consider a small adjustment in how you approach a commitment, allowing your relationships and your own wellbeing to inform the next step.`,evidence:[{source_id:'s1'}]}))});
async function setup(){
 const db=new PGlite();let calls=0,broken=false,sessions=[],contexts=[],messages=[],hook=null;
 let txTail=Promise.resolve();const pool={query:(...a)=>db.query(...a),connect:async()=>{const prior=txTail;let release;txTail=new Promise(r=>release=r);await prior;return {query:(...a)=>db.query(...a),release};}};
 const stripe={checkout:{sessions:{create:async(p,o)=>{const s={...p,id:'cs_'+sessions.length,url:'https://checkout.stripe.com/example',livemode:true,status:'open',payment_status:'unpaid',amount_total:1295,currency:'usd',options:o};sessions.push(s);return s;},retrieve:async id=>sessions.find(s=>s.id===id)}}};
 const env={NODE_ENV:'test',STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_WEBHOOK_SECRET:'fake',MEMBERSHIP_LIVE_ENABLED:'true',MEMBERSHIP_PORTAL_LIVE_CONFIGURATION:'fake',TURNSTILE_SITE_KEY:'fake',TURNSTILE_SECRET_KEY:'fake',MEMBERSHIP_LIVE_PRICE_FOUNDING:'fake',MEMBERSHIP_LIVE_PRICE_MONTHLY:'fake',MEMBERSHIP_LIVE_PRICE_ANNUAL:'fake'};
 const service=createMembership({pool,env,stripeClient:stripe,getMailer:()=>({sendMail:async m=>{messages.push(m);return {accepted:[m.to]};}}),fetcher:async()=>({ok:true,json:async()=>({success:true,hostname:'lucehealing.com',action:'membership_signup'})}),readingProvider:{enabled:()=>true,generate:async c=>{calls++;contexts.push(c);if(broken)throw Error('provider failed');if(hook)await hook();return generated();}}});await service.initialize();
 for(let id=1;id<=2;id++){await db.query("INSERT INTO luce_members(id,email,name,password_hash,verified_at,status,is_test) VALUES($1,$2,'Customer','unused',NOW(),'unpaid',false)",[id,`customer${id}@example.com`]);await db.query("INSERT INTO luce_member_sessions(token_hash,member_id,kind,expires_at) VALUES($1,$2,'member','2099-01-01')",[crypto.createHash('sha256').update(String(id).repeat(64)).digest('hex'),id]);}
 const content=JSON.stringify(Object.fromEntries(['General',...signs].map(s=>[s,source])));await db.query("INSERT INTO luce_horoscopes(month,title,draft,published,published_title,published_demo,published_at) VALUES('2026-10','October',$1,$1,'October',false,'2026-09-01')",[content]);
 const app=express();app.use(express.json());service.register(app,(_q,r)=>r.sendStatus(401));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path='',method='GET',body,id=1,headers={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+(path.startsWith('/api/')?path:'/api/purchased-readings'+path),{method,headers:{'Content-Type':'application/json',Cookie:id?'luce_member='+String(id).repeat(64):'',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers};};
 const wait=async(id,state,owner=1)=>{for(let i=0;i<100;i++){const r=await call('/'+id,'GET',null,owner);if(r.data.state===state)return r.data;await new Promise(r=>setTimeout(r,10));}throw Error('State never reached '+state);};
 return {call,wait,db,service,sessions,contexts,messages,hook:h=>hook=h,calls:()=>calls,break:v=>broken=v,close:async()=>{service.stop();await new Promise(r=>server.close(r));await db.close();}};
}
const input={recipient:'Recipient Example',month:'2026-10',birth:{date:'1980-05-10',unknownTime:true,unknownLocation:true}};
test('one-time purchase: payment reuse, verified payment, failure retry, saved reading and private sharing',async()=>{
 const h=await setup();try{
 assert.equal((await h.call('','GET',null,0)).status,401);
 assert.equal((await h.call('/catalog')).data.price,1295);
 const r=await h.call('','POST',input);assert.equal(r.status,200);const id=r.data.id;
 assert.equal((await h.call('','POST',input)).data.id,id);
 assert.equal((await h.call('/'+id,'GET',null,2)).status,404);
 assert.equal((await h.call('/'+id+'/retry','POST',{})).status,402);
 assert.equal((await h.call('/'+id+'/checkout','POST',{},1,{Origin:'https://bad.example'})).status,403);
 await h.call('/'+id+'/checkout','POST',{});await h.call('/'+id+'/checkout','POST',{});assert.equal(h.sessions.length,1);assert.equal(h.sessions[0].mode,'payment');assert.equal(h.sessions[0].line_items[0].price_data.unit_amount,1295);
 const s=h.sessions[0];s.status='complete';s.payment_status='paid';h.break(true);
 await assert.rejects(h.service.handleLiveEvent({livemode:true,type:'checkout.session.completed',data:{object:{...s,amount_total:1}}}),/does not match/);
 await h.call('/'+id+'/confirm','POST',{});await h.wait(id,'failed');assert.equal(h.calls(),1);
 h.break(false);await h.call('/'+id+'/retry','POST',{});const done=await h.wait(id,'complete');assert.ok(done.text);assert.equal(h.calls(),2);
 await h.service.handleLiveEvent({livemode:true,type:'checkout.session.completed',data:{object:s}});await h.call('/'+id+'/confirm','POST',{});await h.call('/'+id+'/retry','POST',{});assert.equal(h.calls(),2);assert.equal(h.sessions.length,1);
 assert.equal((await h.call('/'+id+'/checkout','POST',{})).data.paid,true);
 const c=JSON.stringify(h.contexts);assert.ok(!c.includes(input.recipient));assert.ok(!c.includes(input.birth.date));assert.ok(!c.includes('customer1@'));
 const share=await h.call('/'+id+'/share','POST',{});const token=share.data.url.split('/').pop();const shared=await h.call('/shared/'+token,'GET',null,0);assert.equal(shared.status,200);assert.equal(shared.data.recipient,input.recipient);assert.equal(shared.data.birth,undefined);assert.equal(shared.data.id,undefined);assert.equal(shared.data.text,done.text);assert.equal(shared.headers.get('cache-control'),'no-store');
 await h.call('/'+id+'/share','DELETE');assert.equal((await h.call('/shared/'+token,'GET',null,0)).status,404);
 assert.equal((await h.db.query('SELECT status FROM luce_members WHERE id=1')).rows[0].status,'unpaid');assert.equal((await h.db.query('SELECT * FROM luce_personal_readings')).rows.length,0);
 await h.db.query("UPDATE luce_members SET status='canceled',access_until='2020-01-01' WHERE id=1");assert.equal((await h.call('/'+id)).data.text,done.text);assert.equal((await h.call('/api/membership/personal-readings/2026-10')).status,403);
 }finally{await h.close();}
});
test('expired checkout gets a fresh key and unpaid accounts cannot retrieve others’ purchases',async()=>{const h=await setup();try{const r=(await h.call('','POST',input)).data;await h.call('/'+r.id+'/checkout','POST',{});h.sessions[0].status='expired';await h.call('/'+r.id+'/checkout','POST',{});assert.equal(h.sessions.length,2);assert.notEqual(h.sessions[0].options.idempotencyKey,h.sessions[1].options.idempotencyKey);assert.deepEqual((await h.call('','GET',null,2)).data,[]);await h.db.query('UPDATE luce_members SET verified_at=NULL WHERE id=1');assert.equal((await h.call('','POST',input)).status,403);}finally{await h.close();}});
test('customer UI opens saved reading without generation and offers print and private share',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');const dom=new JSDOM(fs.readFileSync('private-membership/purchased.html','utf8'),{url:'https://lucehealing.com/my-purchased-readings?reading=11111111-1111-1111-1111-111111111111',runScripts:'outside-only'});const requests=[];
 const r={id:'11111111-1111-1111-1111-111111111111',recipient:'Alex <script>',label:'October 2026',birth:{date:'1980-05-10'},placements:[{placement:'Sun',sign:'Taurus',reliable:true}],state:'complete',paid:true,text:'Your saved reading.'};
 dom.window.fetch=async(url,opts)=>{requests.push({url,method:opts.method});return {ok:true,json:async()=>url.endsWith('/account')?{name:'Purchaser',verified:true}:url.endsWith('/share')?{url:'https://lucehealing.com/shared-reading/'+'a'.repeat(64)}:r};};dom.window.eval(fs.readFileSync('private-membership/purchased.js','utf8'));await new Promise(r=>setTimeout(r,20));assert.match(dom.window.document.querySelector('.recipient').textContent,/Alex <script>/);assert.equal(dom.window.document.querySelector('article script'),null);assert.equal(dom.window.document.querySelector('.reading').textContent,r.text);assert.ok(dom.window.document.getElementById('print'));assert.ok(!requests.some(r=>/retry|checkout/.test(r.url)));dom.window.document.getElementById('share').click();await new Promise(r=>setTimeout(r,20));assert.match(dom.window.document.getElementById('email-share').href,/^mailto:/);assert.match(dom.window.document.getElementById('text-share').href,/^sms:/);dom.window.close();
});
test('public entry clearly presents price and existing member route before signup',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');const dom=new JSDOM(fs.readFileSync('private-membership/purchased.html','utf8'),{url:'https://lucehealing.com/personalized-monthly-reading',runScripts:'outside-only'});dom.window.fetch=async()=>({ok:true,json:async()=>null});dom.window.eval(fs.readFileSync('private-membership/purchased.js','utf8'));await new Promise(r=>setTimeout(r,20));assert.match(dom.window.document.body.textContent,/\$12\.95/);assert.ok(dom.window.document.querySelector('#app a[href="/members/reading"]'));assert.ok(dom.window.document.getElementById('auth'));dom.window.close();
});
test('normal customer signup, confirmation, login/logout and later membership keep the same account',async()=>{
 const h=await setup();try{
 await h.db.query("SELECT setval('luce_members_id_seq',100)");
 const s=await h.call('/api/membership/signup','POST',{name:'New customer',email:'new@example.com',member_password:'example-password',turnstile_token:'valid',purpose:'purchased_reading'},0);assert.equal(s.status,200);assert.equal(h.messages.length,1);
 let m=(await h.db.query("SELECT * FROM luce_members WHERE email='new@example.com'")).rows[0];assert.equal(m.tier,'customer');assert.equal(h.service.access(m),false);
 const token=h.messages[0].text.match(/token=([a-f0-9]{64})/)[1];const v=await h.call('/api/membership/verify','POST',{token},0);assert.equal(v.status,200);assert.equal(v.data.next,'/my-purchased-readings');
 const login=await h.call('/api/membership/login','POST',{email:m.email,member_password:'example-password'},0);assert.equal(login.status,200);const Cookie=login.headers.get('set-cookie').split(';')[0];
 const made=await h.call('','POST',input,0,{Cookie});assert.equal(made.status,200);const id=made.data.id;
 await h.call('/api/membership/logout','POST',{},0,{Cookie});assert.equal((await h.call('/'+id,'GET',null,0,{Cookie})).status,401);
 const again=await h.call('/api/membership/login','POST',{email:m.email,member_password:'example-password'},0);const cookie2=again.headers.get('set-cookie').split(';')[0];assert.equal((await h.call('/'+id,'GET',null,0,{Cookie:cookie2})).data.id,id);
 await h.db.query("UPDATE luce_members SET status='active',access_until='2099-01-01' WHERE id=$1",[m.id]);assert.equal((await h.call('/'+id,'GET',null,0,{Cookie:cookie2})).data.id,id);assert.equal((await h.db.query("SELECT COUNT(*)::int AS n FROM luce_members WHERE email='new@example.com'")).rows[0].n,1);
 }finally{await h.close();}
});
test('parallel taps, repeated webhook and concurrent retry cannot duplicate checkout or generation; purchase survives source/profile changes',async()=>{
 const h=await setup();try{
 const items=await Promise.all(Array.from({length:4},()=>h.call('','POST',input)));const id=items[0].data.id;assert.ok(items.every(r=>r.data.id===id));
 const checkouts=await Promise.all(Array.from({length:4},()=>h.call('/'+id+'/checkout','POST',{})));assert.ok(checkouts.every(r=>r.status===200));assert.equal(h.sessions.length,1);
 let entered,release;const ready=new Promise(r=>entered=r);h.hook(()=>{entered();return new Promise(r=>release=r)});const s=h.sessions[0];s.status='complete';s.payment_status='paid';const event={livemode:true,type:'checkout.session.completed',data:{object:s}};
 await h.service.handleLiveEvent(event);await ready;await Promise.all([h.service.handleLiveEvent(event),h.call('/'+id+'/confirm','POST',{}),h.call('/'+id+'/retry','POST',{})]);assert.equal(h.calls(),1);
 await h.db.query("UPDATE luce_members SET birth_chart='{}',status='canceled' WHERE id=1");await h.db.query("UPDATE luce_horoscopes SET published=NULL WHERE month='2026-10'");release();const done=await h.wait(id,'complete');assert.equal(done.birth.date,input.birth.date);assert.ok(done.purchasedAt);assert.equal(done.recipient,input.recipient);
 assert.equal((await h.call('/'+id)).data.text,done.text);const a=(await h.call('/'+id+'/share','POST',{})).data.url;await h.call('/'+id+'/share','POST',{});const shared=await h.call('/shared/'+a.split('/').pop(),'GET',null,0);assert.equal(shared.status,200);assert.deepEqual(shared.data.placements,done.placements);assert.match(shared.headers.get('x-robots-tag'),/noindex/);assert.equal(shared.headers.get('referrer-policy'),'no-referrer');for(const key of ['email','purchaser_id','payment_id','context','birth','id'])assert.equal(shared.data[key],undefined);
 }finally{await h.close();}
});
test('member can purchase for another recipient independently of the included saved membership reading',async()=>{
 const h=await setup();try{
 await h.db.query("UPDATE luce_members SET status='active',access_until='2099-01-01' WHERE id=2");await h.db.query("INSERT INTO luce_personal_readings(member_id,month,state,started_at,reading) VALUES(2,'2026-10','complete',NOW(),$1)",[JSON.stringify({text:'Existing included membership reading'})]);
 const r=(await h.call('','POST',{...input,recipient:'Someone Else'},2)).data;await h.call('/'+r.id+'/checkout','POST',{},2);const s=h.sessions[0];s.status='complete';s.payment_status='paid';await h.service.handleLiveEvent({livemode:true,type:'checkout.session.completed',data:{object:s}});const done=await h.wait(r.id,'complete',2);assert.equal(done.recipient,'Someone Else');
 assert.equal((await h.db.query('SELECT reading FROM luce_personal_readings WHERE member_id=2')).rows[0].reading.text,'Existing included membership reading');assert.equal((await h.db.query('SELECT status FROM luce_members WHERE id=2')).rows[0].status,'active');
 assert.equal((await h.call('/'+r.id+'/share','POST',{},2)).status,200);await h.db.query("UPDATE luce_members SET status='canceled' WHERE id=2");assert.equal((await h.call('/'+r.id,'GET',null,2)).data.text,done.text);
 }finally{await h.close();}
});
test('shared reading has recipient placements, attribution, print, no prices, and correct email/text/copy controls',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');const html=fs.readFileSync('private-membership/purchased.html','utf8'),js=fs.readFileSync('private-membership/purchased.js','utf8');const token='a'.repeat(64),url='https://lucehealing.com/shared-reading/'+token;
 const r={id:'11111111-1111-1111-1111-111111111111',state:'complete',paid:true,recipient:'Alex',label:'October 2026',birth:{date:'1980-05-10'},placements:[{placement:'Mars',sign:'Cancer',reliable:true},{placement:'Rising',reliable:false}],text:'A personal reflection.'};
 for(const shared of [false,true]){let printed=0,copied='';const dom=new JSDOM(html,{url:shared?url:'https://lucehealing.com/my-purchased-readings?reading='+r.id,runScripts:'outside-only'});const w=dom.window;w.print=()=>printed++;w.navigator.clipboard={writeText:async x=>copied=x};Object.defineProperty(w.navigator,'userAgent',{value:'iPhone'});w.fetch=async u=>({ok:true,json:async()=>u.endsWith('/account')?{verified:true}:u.endsWith('/share')?{url}:shared?{...r,birth:undefined}:r});w.eval(js);await new Promise(r=>setTimeout(r,25));assert.equal(w.document.querySelector('.recipient').textContent,'Alex');assert.match(w.document.querySelector('.placements').textContent,/Cancer/);assert.equal(w.document.querySelector('.attribution a').href,'https://lucehealing.com/');assert.match(w.document.querySelector('.attribution').textContent,/Personalized astrology guidance/);w.document.getElementById('print').click();assert.equal(printed,1);
 if(shared){assert.equal(w.document.getElementById('offer-price').hidden,true);assert.equal(w.document.getElementById('navigation').hidden,true);assert.equal(w.document.getElementById('share'),null);assert.ok(!w.document.querySelector('.summary').textContent.includes('1980'));}
 else{w.document.getElementById('share').click();await new Promise(r=>setTimeout(r,20));assert.ok(decodeURIComponent(w.document.getElementById('email-share').href).includes(url));assert.ok(w.document.getElementById('text-share').href.startsWith('sms:&body='));w.document.getElementById('copy-share').click();await new Promise(r=>setTimeout(r,10));assert.equal(copied,url);}
 w.close();}
});
test('natal placeholders capitalize sentence starts and preserve locked signs mid-sentence',()=>{
 const {renderNatalReferences}=require('../private-membership/personal-reading');const r=renderNatalReferences({paragraphs:[{text:'{{natal:Mars}} helps. {{natal:Jupiter}} supports, with {{natal:Moon}}.'}]},{placements:[{placement:'Mars',sign:'Cancer'},{placement:'Jupiter',sign:'Cancer'},{placement:'Moon',sign:'Taurus'}]});assert.equal(r.paragraphs[0].text,'Your natal Mars in Cancer helps. Your natal Jupiter in Cancer supports, with your natal Moon in Taurus.');
});
