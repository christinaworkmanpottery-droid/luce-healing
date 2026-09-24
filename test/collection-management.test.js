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


test('metadata updates preserve every content snapshot; early publishing, featuring, hiding, rescheduling and conflicts work',async()=>{
 const h=await harness();try{
 await h.verify();
 const content={General:'General October reading including Full Moon boundary scripts',...Object.fromEntries(signs.map(s=>[s,s+' unchanged forecast']))};
 let row=(await h.admin('horoscopes/2026-10','PUT',{title:'Monthly Horoscopes (2026-10)',content})).data;
 // Simulate additional previously saved content outside the known editor fields.
 await h.db.query("UPDATE luce_horoscopes SET draft=draft || $1::jsonb WHERE month='2026-10'",[JSON.stringify({BoundaryScripts:'Exact full moon scripts <p>unchanged</p>',Other:{text:'retain me'}})]);
 row=(await h.admin('horoscopes/2026-10/publish','POST',{revision:row.revision})).data;
 const original=structuredClone(row.published);
 let details={title:'October 2026 Horoscopes',display_month:'2026-10',subtitle:'A month of reflection',featured:true,status:'published'};
 const patch=async(extra={})=>{const r=await h.admin('horoscopes/2026-10/details','PATCH',{...details,revision:row.revision,...extra});assert.equal(r.status,200,JSON.stringify(r.data));row=r.data;return row;};
 await patch();assert.deepEqual(row.draft,original);assert.deepEqual(row.published,original);
 let months=(await h.call('/api/membership/horoscopes')).data;assert.equal(months[0].title,details.title);assert.equal(months[0].month,'2026-10');
 assert.equal((await h.call('/api/membership/config')).data.latestMonth,'2026-10');
 const stale=row.revision;
 await patch({display_month:'2026-11',title:'My chosen title',localTime:'2026-09-19T10:00'});
 assert.equal(row.month,'2026-10');assert.equal(row.display_month,'2026-11');assert.deepEqual(row.published,original);
 assert.equal((await h.admin('horoscopes/2026-10/details','PATCH',{...details,revision:stale})).status,409);
 assert.equal((await h.call('/api/admin/membership/horoscopes/2026-10/details','PATCH',{...details,revision:row.revision})).status,401);
 await patch({status:'draft'});assert.deepEqual(row.published,original);assert.deepEqual(row.draft,original);
 assert(!(await h.call('/api/membership/horoscopes')).data.some(x=>x.month==='2026-10'));
 assert.equal((await h.call('/api/membership/reading?month=2026-10')).status,404);
 await patch({status:'scheduled',localTime:'2026-09-21T08:00'});const scheduled=structuredClone(row.scheduled_draft);
 await patch({status:'scheduled',localTime:'2026-09-22T08:00',title:'Renamed scheduled collection'});assert.deepEqual(row.scheduled_draft,scheduled);assert.deepEqual(row.published,original);
 h.advance(48*3600000);await h.service.tick();
 row=(await h.admin('horoscopes')).data.find(x=>x.month==='2026-10');assert.equal(row.collection_hidden,false);assert.deepEqual(row.published,original);assert.equal(row.published_title,'Renamed scheduled collection');
 // A known-field reading edit keeps extra stored scripts and objects.
 row=(await h.admin('horoscopes/2026-10','PUT',{title:row.title,content,revision:row.revision})).data;
 assert.equal(row.draft.BoundaryScripts,original.BoundaryScripts);assert.deepEqual(row.draft.Other,original.Other);
 let older=(await h.admin('horoscopes/2026-09','PUT',{title:'September 2026 Horoscopes',content})).data;
 older=(await h.admin('horoscopes/2026-09/details','PATCH',{...details,title:'September 2026 Horoscopes',display_month:'2026-09',revision:older.revision})).data;
 assert.equal((await h.call('/api/membership/horoscopes')).data[0].month,'2026-09');
 assert.equal((await h.admin('horoscopes')).data.filter(x=>x.featured_at).length,1);
 assert.equal(h.sent.length,1);
 }finally{await h.close();}
});
