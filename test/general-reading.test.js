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

test('general reading follows draft, scheduling and publication snapshots without changing the twelve signs',async()=>{
 const h=await harness();try{
 await h.verify();
 const content=Object.fromEntries(signs.map(s=>[s,s+' October forecast']));
 let r=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content});
 assert.equal(r.status,200);assert.equal(r.data.draft.General,'');
 r=await h.admin('horoscopes/2026-10/schedule','POST',{revision:r.data.revision,localTime:'2026-09-21T08:00'});
 assert.equal(r.status,200);assert.equal(new Date(r.data.scheduled_at).toISOString(),'2026-09-21T15:00:00.000Z');
 assert.equal((await h.call('/api/membership/horoscopes')).data.some(x=>x.month==='2026-10'),false);
 // Adding optional content requires an explicit save and reschedule under the existing rules.
 r=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content:{...content,General:'October overview <script>example</script>'},revision:r.data.revision});
 assert.equal(r.status,200);assert.equal(r.data.scheduled_at,null);
 r=await h.admin('horoscopes/2026-10/schedule','POST',{revision:r.data.revision,localTime:'2026-09-21T08:00'});
 assert.equal(r.status,200);
 h.advance(19*3600000);await h.service.tick();
 let month=(await h.call('/api/membership/horoscopes')).data.find(x=>x.month==='2026-10');
 assert.equal(month.content.General,'October overview <script>example</script>');
 for(const sign of signs)assert.equal(month.content[sign],content[sign]);
 let saved=(await h.admin('horoscopes')).data.find(x=>x.month==='2026-10');
 // Older clients that omit General must preserve the stored overview.
 r=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content,revision:saved.revision});
 assert.equal(r.data.draft.General,month.content.General);
 const invalid=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content:{...content,General:42},revision:r.data.revision});assert.equal(invalid.status,400);
 saved=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content:{...content,General:'New draft'},revision:r.data.revision});
 month=(await h.call('/api/membership/horoscopes')).data.find(x=>x.month==='2026-10');assert.notEqual(month.content.General,'New draft');
 assert.equal(h.sent.length,1);
 }finally{await h.close();}
});

