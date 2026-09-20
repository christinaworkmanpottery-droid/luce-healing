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

test('private gate, no purchasing, signup verification, session security and reset replay protection',async()=>{const h=await harness();try{
assert.equal((await h.call('/members')).status,404);assert.equal((await h.call('/private-membership/service.js')).status,404);assert.equal((await h.call('/api/membership/checkout','POST',{})).status,403);assert.equal((await h.call('/api/admin/membership/members')).status,401);assert.equal((await h.open()).status,200);
assert.equal((await h.call('/api/membership/signup','POST',{name:'Other',email:'other@example.com',member_password:'Private-test-password-123'})).status,400);
assert.equal((await h.signup()).status,200);assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'info@christinaworkman.com');assert.equal(h.sent[0].from.address,'lucehealing13@gmail.com');assert(!h.sent[0].html.includes('Potter'));
assert.equal((await h.call('/api/membership/horoscopes')).status,403);const verification=h.secret();assert.equal((await h.call('/api/membership/verify','POST',{token:verification})).status,200);assert.equal((await h.call('/api/membership/verify','POST',{token:verification})).status,410);
let me=await h.call('/api/membership/me');assert(me.data.access);const oldCookie={...h.cookies};assert.equal((await h.call('/api/membership/forgot','POST',{email:me.data.email})).status,200);const reset=h.secret();assert.equal((await h.call('/api/membership/reset','POST',{token:reset,member_password:'Changed-test-password-123'})).status,200);assert.equal((await h.call('/api/membership/me','GET',null,{cookies:oldCookie})).status,401);assert.equal((await h.call('/api/membership/reset','POST',{token:reset,member_password:'Changed-again-password-123'})).status,410);
assert.equal((await h.call('/api/membership/login','POST',{email:me.data.email,member_password:'Private-test-password-123'})).status,401);assert.equal((await h.call('/api/membership/login','POST',{email:me.data.email,member_password:'Changed-test-password-123'})).status,200);
assert.equal((await h.call('/api/membership/logout','POST',{}, {headers:{Origin:'https://evil.example','sec-fetch-site':'cross-site'}})).status,403);
const db=(await h.db.query('SELECT * FROM luce_members')).rows[0];assert(!db.password_hash.includes('Changed'));assert.equal((await h.db.query('SELECT count(*)::int n FROM luce_members')).rows[0].n,1);
}finally{await h.close();}});

test('all twelve signs, published snapshots, drafts, stale editing, and expired access',async()=>{const h=await harness();try{await h.verify();const demo=(await h.call('/api/membership/horoscopes')).data;assert.equal(demo[0].demo,true);assert.equal(Object.keys(demo[0].content).length,12);
const content=Object.fromEntries(signs.map(s=>[s,'Original '+s]));let d=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content,demo:false});assert.equal(d.status,200);assert.equal((await h.call('/api/membership/horoscopes')).data.length,1);
let pub=await h.admin('horoscopes/2026-10/publish','POST',{revision:d.data.revision});assert.equal(pub.status,200);content.Aries='Changed draft';d=await h.admin('horoscopes/2026-10','PUT',{title:'October 2026',content,revision:pub.data.revision});assert.equal(d.status,200);assert.equal((await h.call('/api/membership/horoscopes')).data.find(m=>m.month==='2026-10').content.Aries,'Original Aries');assert.equal((await h.admin('horoscopes/2026-10/publish','POST',{revision:pub.data.revision})).status,409);
assert.equal((await h.admin('horoscopes/2026-10/unpublish','POST',{revision:d.data.revision})).status,200);
const id=(await h.call('/api/membership/me')).data.id;await h.admin('members/'+id+'/preview','POST',{status:'expired'});assert.equal((await h.call('/api/membership/horoscopes')).status,403);assert.equal((await h.call('/api/membership/me')).data.status,'expired');await h.admin('members/'+id+'/preview','POST',{status:'preview'});h.advance(8*86400000);assert(!h.service.access((await h.db.query('SELECT * FROM luce_members')).rows[0]));assert.equal(h.sent.length,1);
}finally{await h.close();}});

test('signed sandbox billing, cancellation through paid period, payment failure/recovery and no live events',async()=>{const h=await harness();try{await h.verify();const id=(await h.call('/api/membership/me')).data.id;let sub={id:'sub_test',customer:'cus_test',status:'active',livemode:false,metadata:{luce_member_id:String(id),luce_membership:'preview'},current_period_start:1790000000,current_period_end:1792000000,cancel_at_period_end:false};h.setSub(sub);
assert.equal((await h.call('/api/membership/stripe/webhook','POST',{})).status,400);assert.equal((await h.webhook('customer.subscription.created','evt_first')).status,200);assert.equal((await h.webhook('customer.subscription.created','evt_first')).status,200);assert.equal((await h.db.query('SELECT count(*)::int n FROM luce_member_events')).rows[0].n,1);
assert.equal((await h.call('/api/membership/portal','POST',{})).status,200);sub={...sub,cancel_at_period_end:true};h.setSub(sub);await h.webhook('customer.subscription.updated');let me=(await h.call('/api/membership/me')).data;assert(me.access&&me.cancel_at_period_end);
sub={...sub,status:'past_due'};h.setSub(sub);await h.webhook('invoice.payment_failed');assert.equal((await h.call('/api/membership/horoscopes')).status,403);
sub={...sub,status:'active'};h.setSub(sub);await h.webhook('invoice.paid');assert((await h.call('/api/membership/me')).data.access);
sub={...sub,status:'canceled'};h.setSub(sub);await h.webhook('customer.subscription.deleted');assert.equal((await h.call('/api/membership/horoscopes')).status,403);assert.equal((await h.db.query('SELECT count(*)::int n FROM luce_members')).rows[0].n,1);
await assert.rejects(()=>h.service.syncSubscription({...sub,livemode:true}),/Live membership billing/);assert.equal(h.sent.length,1);
}finally{await h.close();}});

test('eight-character signup/reset, private chart persistence, own-account access and published-only matching',async()=>{const h=await harness();try{
 await h.open();let r=await h.call('/api/membership/signup','POST',{name:'Christina',email:'info@christinaworkman.com',member_password:'Abcd123'});assert.equal(r.status,400);
 r=await h.call('/api/membership/signup','POST',{name:'Christina',email:'info@christinaworkman.com',member_password:'Abcd1234'});assert.equal(r.status,200);await h.call('/api/membership/verify','POST',{token:h.secret()});
 r=await h.call('/api/membership/chart','PUT',{date:'1990-01-01',unknownTime:true,unknownLocation:true});assert.equal(r.status,200);assert.equal(r.data.chart.placements.find(x=>x.placement==='Sun').sign,'Capricorn');
 assert.equal((await h.call('/api/membership/chart')).data.profile.date,'1990-01-01');assert.equal((await h.call('/api/membership/chart','GET',null,{cookies:{}})).status,404);
 const other=await h.db.query("INSERT INTO luce_members(email,name,password_hash) VALUES('other@example.com','Other','unused') RETURNING id");await h.db.query("INSERT INTO luce_member_sessions(token_hash,member_id,kind,expires_at) VALUES($1,$2,'member','2099-01-01')",[require('crypto').createHash('sha256').update('a'.repeat(64)).digest('hex'),other.rows[0].id]);
 assert.equal((await h.call('/api/membership/chart','GET',null,{cookies:{luce_member:'a'.repeat(64)}})).data.profile,null);
 assert.equal((await h.admin('members')).data[0].birth_profile,undefined);
 let d=await h.admin('horoscopes/2026-09','PUT',{title:'September',content:Object.fromEntries(signs.map(x=>[x,'Published '+x])),demo:false});await h.admin('horoscopes/2026-09/publish','POST',{revision:d.data.revision});
 r=await h.call('/api/membership/reading?month=2026-09');assert.equal(r.status,200);assert.equal(r.data.groups.filter(x=>x.sign==='Capricorn').length,1);assert.equal(r.data.groups.find(x=>x.sign==='Capricorn').content,'Published Capricorn');assert.equal((await h.call('/api/membership/reading?month=2026-10')).status,404);
 await h.call('/api/membership/forgot','POST',{email:'info@christinaworkman.com'});const reset=h.secret();assert.equal((await h.call('/api/membership/reset','POST',{token:reset,member_password:'1234567'})).status,400);assert.equal((await h.call('/api/membership/reset','POST',{token:reset,member_password:'Newpass8'})).status,200);
}finally{await h.close();}});

test('Pacific schedules publish atomically without an admin session; edits, cancellation, drafts and emails remain controlled',async()=>{const h=await harness();try{
 await h.verify();await h.call('/api/membership/chart','PUT',{date:'1990-01-01',unknownTime:true,unknownLocation:true});
 const content=Object.fromEntries(signs.map(s=>[s,'Scheduled '+s]));
 let row=(await h.admin('horoscopes/2026-10','PUT',{title:'October',content:{...content,Pisces:''},demo:false})).data;
 let r=await h.admin('horoscopes/2026-10/schedule','POST',{revision:row.revision,localTime:'2026-10-01T00:00'});assert.equal(r.status,400);assert.match(r.data.error,/Pisces/);
 row=(await h.admin('horoscopes/2026-10','PUT',{title:'October',content,demo:false,revision:row.revision})).data;
 r=await h.admin('horoscopes/2026-10/schedule','POST',{revision:row.revision,localTime:'2026-10-01T00:00'});assert.equal(r.status,200);row=r.data;assert.equal(new Date(row.scheduled_at).toISOString(),'2026-10-01T07:00:00.000Z');
 assert.equal((await h.call('/api/membership/reading?month=2026-10')).status,404);
 assert(!(await h.call('/api/membership/horoscopes')).data.some(x=>x.month==='2026-10'));
 assert.equal((await h.call('/api/admin/membership/horoscopes/2026-10/schedule','POST',{revision:row.revision,localTime:'2026-10-01T00:00'},{cookies:{}})).status,401);
 row=(await h.admin('horoscopes/2026-10/cancel-schedule','POST',{revision:row.revision})).data;assert.equal(row.scheduled_at,null);assert.equal(row.published,null);assert.equal(row.draft.Aries,content.Aries);
 row=(await h.admin('horoscopes/2026-10/schedule','POST',{revision:row.revision,localTime:'2026-10-01T00:00'})).data;
 row=(await h.admin('horoscopes/2026-10','PUT',{title:'October revised',content:{...content,Aries:'Revised Aries'},demo:false,revision:row.revision})).data;assert.equal(row.scheduled_at,null);
 row=(await h.admin('horoscopes/2026-10/schedule','POST',{revision:row.revision,localTime:'2026-10-01T00:00'})).data;
 assert.equal((await h.admin('horoscopes/2026-10/cancel-schedule','POST',{revision:row.revision-1})).status,409);
 h.advance(new Date('2026-10-01T06:59:59Z')-new Date('2026-09-20T20:00:00Z'));await h.service.tick();assert.equal((await h.db.query("SELECT published FROM luce_horoscopes WHERE month='2026-10'")).rows[0].published,null);
 h.advance(1000);h.service.start();for(let i=0;i<100;i++){if((await h.db.query("SELECT published FROM luce_horoscopes WHERE month='2026-10'")).rows[0].published)break;await new Promise(r=>setTimeout(r,10));}h.service.stop();
 const live=(await h.db.query("SELECT * FROM luce_horoscopes WHERE month='2026-10'")).rows[0];assert.equal(Object.keys(live.published).length,12);assert.equal(live.published.Aries,'Revised Aries');assert.equal(live.scheduled_at,null);
 await h.service.tick();assert.equal((await h.db.query("SELECT revision FROM luce_horoscopes WHERE month='2026-10'")).rows[0].revision,live.revision);
 await h.open();await h.call('/api/membership/login','POST',{email:'info@christinaworkman.com',member_password:'Private-test-password-123'});const id=(await h.call('/api/membership/me')).data.id;await h.admin('members/'+id+'/preview','POST',{status:'preview'});
 const reading=(await h.call('/api/membership/reading?month=2026-10')).data;assert.equal(reading.groups.find(x=>x.sign==='Capricorn').content,'Scheduled Capricorn');
 assert.equal((await h.call('/api/membership/horoscopes')).data.length,2);assert.equal(h.sent.length,1);
}finally{h.service.stop();await h.close();}});

test('Pacific scheduling handles winter, summer, nonexistent and repeated clock times',()=>{
 const {scheduleInstant}=require('../private-membership/service');
 assert.equal(scheduleInstant('2026-12-01T00:00').toISOString(),'2026-12-01T08:00:00.000Z');
 assert.equal(scheduleInstant('2026-10-01T00:00').toISOString(),'2026-10-01T07:00:00.000Z');
 assert.throws(()=>scheduleInstant('2027-03-14T02:30'),/does not occur/);
 assert.throws(()=>scheduleInstant('2026-11-01T01:30'),/occurs twice/);
 assert.equal(scheduleInstant('2026-11-01T01:30','earlier').toISOString(),'2026-11-01T08:30:00.000Z');
 assert.equal(scheduleInstant('2026-11-01T01:30','later').toISOString(),'2026-11-01T09:30:00.000Z');
 assert.throws(()=>scheduleInstant('2026-02-30T00:00'),/valid/);
});
