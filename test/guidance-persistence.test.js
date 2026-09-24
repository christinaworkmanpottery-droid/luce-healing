const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {PGlite}=require('@electric-sql/pglite');const Stripe=require('stripe');
const {createMembership,signs}=require('../private-membership/service');
async function harness(){const db=new PGlite(),sent=[];let date=new Date('2026-09-20T20:00:00Z'),sub;
const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
const real=new Stripe('sk_test_fake');const stripe={webhooks:real.webhooks,subscriptions:{retrieve:async()=>sub},billingPortal:{configurations:{retrieve:async()=>({id:'bpc_test',livemode:false,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}})},sessions:{create:async x=>{assert.equal(x.customer,'cus_test');return {url:'https://billing.stripe.com/p/session/test'};}}}};
const env={NODE_ENV:'test',MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET:'whsec_private_test',MEMBERSHIP_PORTAL_TEST_CONFIGURATION:'bpc_test'};
const service=createMembership({pool,env,stripeClient:stripe,clock:()=>date,getMailer:()=>({sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}})});await service.initialize();const app=express();app.use('/api/membership/stripe/webhook',express.raw({type:'application/json'}));app.use(express.json());service.register(app,(req,res,next)=>req.query.password==='admin-test'||req.body?.password==='admin-test'?next():res.status(401).json({error:'Unauthorized'}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let cookies={};
const call=async(p,method='GET',body,opts={})=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',Cookie:Object.entries(opts.cookies??cookies).map(([k,v])=>k+'='+v).join('; '),...opts.headers},body:body?JSON.stringify(body):undefined});for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');cookies[k]=v;}const text=await r.text();let data;try{data=JSON.parse(text);}catch(_){data=text;}return {status:r.status,data,headers:r.headers};};
const admin=(p,m='GET',b)=>call('/api/admin/membership/'+p+'?password=admin-test',m,b);
const open=()=>call('/api/membership/review-login','POST',{password:'admin-test'});
const signup=()=>call('/api/membership/signup','POST',{name:'Christina',email:'info@christinaworkman.com',member_password:'Private-test-password-123'});
const secret=()=>sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
const verify=async()=>{await open();await signup();return call('/api/membership/verify','POST',{token:secret()});};
const webhook=async(type,id='evt_'+Math.random())=>{const event={id,type,livemode:false,data:{object:type.startsWith('invoice.')?{subscription:'sub_test'}:sub}};const raw=JSON.stringify(event);return call('/api/membership/stripe/webhook','POST',event,{headers:{'stripe-signature':real.webhooks.generateTestHeaderString({payload:raw,secret:env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET})}});};
return {db,sent,call,admin,open,signup,secret,verify,webhook,service,env,cookies,setSub:x=>sub=x,advance:ms=>date=new Date(+date+ms),close:async()=>{await new Promise(r=>server.close(r));await db.close();}};}



const fs=require('node:fs'),{JSDOM}=require('jsdom');
async function editor(h,storage={},failFetch=()=>false){
 const d=new JSDOM('<div data-membership-admin></div>',{url:'https://lucehealing.com',runScripts:'outside-only'});
 d.window.HTMLElement.prototype.scrollIntoView=function(){};d.window.confirm=()=>true;
 for(const [k,v] of Object.entries(storage))d.window.localStorage.setItem(k,v);
 d.window.fetch=async(url,opts)=>{if(failFetch(url,opts))throw Error('Simulated network failure');const path=url.split('/api/admin/membership/')[1].split('?')[0];const r=await h.admin(path,opts.method,opts.body?JSON.parse(opts.body):undefined);return {ok:r.status<400,json:async()=>r.data};};
 d.window.eval("const adminPassword='admin-test';");d.window.eval(fs.readFileSync('membership-admin.js','utf8'));await d.window.loadMembershipAdmin();return d;
}
const values={General:'[TEST] General overview\n\n'+('Long guidance — tips, crystals, Unicode ♀, and line breaks.\n'.repeat(120)),...Object.fromEntries(signs.map(s=>[s,'[TEST] '+s+'\n'+('Detailed disposable test text with tips and crystals.\n'.repeat(100))]))};
function fill(d,title='[TEST] Persistence verification'){const doc=d.window.document;doc.querySelector('#mb-kind').value='special';doc.querySelector('#mb-title').value=title;doc.querySelector('#mb-month').value='2026-09';doc.querySelector('#mb-subtitle').value='[TEST] Subtitle — retained exactly';for(const [k,v] of Object.entries(values)){const el=doc.querySelector('#mb-'+k);el.value=v;el.dispatchEvent(new d.window.Event('input',{bubbles:true}));}}
const storage=d=>Object.fromEntries(Array.from({length:d.window.localStorage.length},(_,i)=>{const k=d.window.localStorage.key(i);return [k,d.window.localStorage.getItem(k)];}));
test('legacy new-month collision reproduces; independent collection saves, reopens, publishes, edits and deletes through real API/database',async()=>{
 const h=await harness();let d;try{
 await h.verify();
 let original=(await h.admin('horoscopes/2026-09','PUT',{title:'Existing Full Moon',content:values})).data;
 original=(await h.admin('horoscopes/2026-09/publish','POST',{revision:original.revision})).data;
 const prior=JSON.stringify((await h.db.query("SELECT * FROM luce_horoscopes WHERE month='2026-09'")).rows[0]);
 const collision=await h.admin('horoscopes/2026-09','PUT',{title:'[TEST] Legacy new special guidance',content:values});assert.equal(collision.status,409);
 d=await editor(h);fill(d);await d.window.document.querySelector('#mb-save').onclick();
 assert.match(d.window.document.querySelector('#mb-action-message').textContent,/saved and verified/);
 let rows=(await h.admin('horoscopes')).data,record=rows.find(x=>x.title==='[TEST] Persistence verification');assert(record);assert.match(record.month,/^collection-/);assert.equal(record.collection_type,'special');assert.deepEqual(record.draft,values);assert.equal(record.published,null);
 const id=record.month;d.window.close();d=await editor(h);d.window.document.querySelector(`[data-open-month="${id}"]`).click();
 for(const [k,v] of Object.entries(values))assert.equal(d.window.document.querySelector('#mb-'+k).value,v);assert.equal(d.window.document.querySelector('#mb-subtitle').value,'[TEST] Subtitle — retained exactly');
 await d.window.document.querySelector('#mb-publish').onclick();assert.match(d.window.document.querySelector('#mb-action-message').textContent,/Published and verified/);
 record=(await h.admin('collections/'+id)).data;assert.deepEqual(record.published,values);
 let members=(await h.call('/api/membership/horoscopes')).data;assert.deepEqual(members.find(x=>x.month===id).content,values);assert.equal(members.find(x=>x.month===id).collection_type,'special');
 assert.equal((await h.call('/api/membership/reading?month='+id)).status,200);
 const changed=values.General+'\n[TEST] FINAL EDIT';d.window.document.querySelector('#mb-General').value=changed;await d.window.document.querySelector('#mb-save').onclick();d.window.close();d=await editor(h);d.window.document.querySelector(`[data-open-month="${id}"]`).click();assert.equal(d.window.document.querySelector('#mb-General').value,changed);
 record=(await h.admin('collections/'+id)).data;assert.equal(record.draft.General,changed);assert.equal(record.published.General,values.General);
 // A second collection in the same month is independent as well.
 d.window.document.querySelector('#mb-new').onclick();fill(d,'[TEST] Second guidance same month');await d.window.document.querySelector('#mb-save').onclick();
 assert.equal((await h.admin('horoscopes')).data.filter(x=>x.collection_type==='special').length,2);
 assert.equal(JSON.stringify((await h.db.query("SELECT * FROM luce_horoscopes WHERE month='2026-09'")).rows[0]),prior);
 assert((await h.db.query('SELECT * FROM luce_horoscope_history WHERE collection_id=$1',[id])).rows.length>=4);
 d.window.document.querySelector(`[data-open-month="${id}"]`).click();await d.window.document.querySelector('#mb-delete').onclick();assert.equal((await h.admin('collections/'+id)).status,404);assert(!(await h.call('/api/membership/horoscopes')).data.some(x=>x.month===id));
 }finally{d?.window.close();await h.close();}
});
test('failed save and reload retain every field; independent read-back failure never reports success; stale edits cannot overwrite',async()=>{
 const h=await harness();let d;try{
 let fail=true;d=await editor(h,{},(url,opts)=>fail&&opts.method==='PUT');fill(d);await d.window.document.querySelector('#mb-save').onclick();assert.match(d.window.document.querySelector('#mb-action-message').textContent,/Not completed/);
 for(const [k,v] of Object.entries(values))assert.equal(d.window.document.querySelector('#mb-'+k).value,v);
 const recovery=storage(d);assert.equal(Object.keys(recovery).length,1);d.window.close();fail=false;let failRead=true;d=await editor(h,recovery,(url,opts)=>failRead&&opts.method==='GET'&&url.includes('/collections/'));
 d.window.document.querySelector('[data-recover]').click();for(const [k,v] of Object.entries(values))assert.equal(d.window.document.querySelector('#mb-'+k).value,v);
 await d.window.document.querySelector('#mb-save').onclick();assert.match(d.window.document.querySelector('#mb-action-message').textContent,/Not completed/);assert.equal(Object.keys(storage(d)).length,1);
 failRead=false;await d.window.document.querySelector('#mb-save').onclick();assert.match(d.window.document.querySelector('#mb-action-message').textContent,/saved and verified/);assert.equal(Object.keys(storage(d)).length,0);
 const record=(await h.admin('horoscopes')).data.find(x=>x.title==='[TEST] Persistence verification');const data={title:record.title,display_month:record.display_month,subtitle:record.subtitle,collection_type:'special',featured:false,demo:false,content:values,revision:record.revision-1};assert.equal((await h.admin('collections/'+record.month,'PUT',data)).status,409);
 const bad={...data,revision:record.revision,subtitle:'x'.repeat(501),content:{...values,General:'MUST NOT SAVE'}};assert.equal((await h.admin('collections/'+record.month,'PUT',bad)).status,400);assert.deepEqual((await h.admin('collections/'+record.month)).data.draft,values);
 const workingFetch=d.window.fetch;d.window.fetch=async(url,opts)=>{if(url.includes('/publish?'))throw Error('Simulated publish failure');return workingFetch(url,opts);};
 await d.window.document.querySelector('#mb-publish').onclick();assert.match(d.window.document.querySelector('#mb-action-message').textContent,/Not completed/);
 assert.deepEqual((await h.admin('collections/'+record.month)).data.draft,values);assert.equal((await h.admin('collections/'+record.month)).data.published,null);
 for(const [k,v] of Object.entries(values))assert.equal(d.window.document.querySelector('#mb-'+k).value,v);

 }finally{d?.window.close();await h.close();}
});
