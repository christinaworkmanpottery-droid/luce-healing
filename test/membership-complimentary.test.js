const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {PGlite}=require('@electric-sql/pglite');const Stripe=require('stripe');
const {createMembership,signs}=require('../private-membership/service');
async function harness(overrides={}){const db=new PGlite(),sent=[];let date=new Date('2026-09-20T20:00:00Z'),sub;
const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
const real=new Stripe('sk_test_fake');const stripe={webhooks:real.webhooks,subscriptions:{retrieve:async()=>sub},billingPortal:{configurations:{retrieve:async()=>({id:'bpc_test',livemode:false,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}})},sessions:{create:async x=>{assert.equal(x.customer,'cus_test');return {url:'https://billing.stripe.com/p/session/test'};}}}};
const env={...overrides,NODE_ENV:'test',MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET:'whsec_private_test',MEMBERSHIP_PORTAL_TEST_CONFIGURATION:'bpc_test'};
const service=createMembership({pool,env,stripeClient:stripe,fetcher:async()=>({ok:true,json:async()=>({success:true,hostname:'lucehealing.com',action:'membership_signup'})}),clock:()=>date,getMailer:()=>({sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}})});await service.initialize();const app=express();app.use('/api/membership/stripe/webhook',express.raw({type:'application/json'}));app.use(express.json());service.register(app,(req,res,next)=>req.query.password==='admin-test'||req.body?.password==='admin-test'?next():res.status(401).json({error:'Unauthorized'}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let cookies={};
const call=async(p,method='GET',body,opts={})=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',Cookie:Object.entries(opts.cookies??cookies).map(([k,v])=>k+'='+v).join('; '),...opts.headers},body:body?JSON.stringify(body):undefined});for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');cookies[k]=v;}const text=await r.text();let data;try{data=JSON.parse(text);}catch(_){data=text;}return {status:r.status,data,headers:r.headers};};
const admin=(p,m='GET',b)=>call('/api/admin/membership/'+p+'?password=admin-test',m,b);
const open=()=>call('/api/membership/review-login','POST',{password:'admin-test'});
const signup=()=>call('/api/membership/signup','POST',{name:'Christina',email:'info@christinaworkman.com',member_password:'Private-test-password-123'});
const secret=()=>sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
const verify=async()=>{await open();await signup();return call('/api/membership/verify','POST',{token:secret()});};
const webhook=async(type,id='evt_'+Math.random())=>{const event={id,type,livemode:false,data:{object:type.startsWith('invoice.')?{subscription:'sub_test'}:sub}};const raw=JSON.stringify(event);return call('/api/membership/stripe/webhook','POST',event,{headers:{'stripe-signature':real.webhooks.generateTestHeaderString({payload:raw,secret:env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET})}});};
return {stripe,db,sent,call,admin,open,signup,secret,verify,webhook,service,env,cookies,setSub:x=>sub=x,advance:ms=>date=new Date(+date+ms),close:async()=>{await new Promise(r=>server.close(r));await db.close();}};}

const live={STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_WEBHOOK_SECRET:'whsec_live_fake',MEMBERSHIP_LIVE_ENABLED:'true',MEMBERSHIP_FOUNDING_OFFER_OPEN:'true',MEMBERSHIP_LIVE_PRICE_FOUNDING:'price_live_f',MEMBERSHIP_LIVE_PRICE_MONTHLY:'price_live_m',MEMBERSHIP_LIVE_PRICE_ANNUAL:'price_live_a',MEMBERSHIP_PORTAL_LIVE_CONFIGURATION:'bpc_live',TURNSTILE_SITE_KEY:'test-site',TURNSTILE_SECRET_KEY:'test-secret'};
const join=(h,email,code)=>h.call('/api/membership/signup','POST',{name:'Recipient',email,member_password:'Complimentary-test-123',turnstile_token:'test',complimentary_code:code});
const make=(h,code,opts={})=>h.admin('complimentary-codes','POST',{code,usage:'once',expiration:'never',...opts});
test('complimentary signup gives immediate normal content without billing; code limits, retries and deactivation',async()=>{
 const h=await harness(live);try{
  assert.equal((await h.call('/api/admin/membership/complimentary-codes')).status,401);
  const p=await make(h,'ONE');assert.equal(p.status,200);
  assert.equal((await make(h,'one')).status,409);
  assert.equal((await join(h,'first@example.com',' one ')).status,200);
  let m=(await h.call('/api/membership/me')).data;assert.equal(m.access,true);assert.equal(m.verified,false);assert.equal(m.complimentary,true);assert.equal(m.access_until,null);assert.equal(m.portal_available,false);assert.equal(h.sent.length,0);
  const content=Object.fromEntries(signs.map(s=>[s,'Published reading']));
  await h.db.query("INSERT INTO luce_horoscopes(month,title,draft,published,published_title,published_demo,published_at,collection_type) VALUES('2026-10','October',$1,$1,'October',false,NOW(),'monthly'),('2026-09','Special',$1,$1,'Special',false,NOW(),'special')",[JSON.stringify(content)]);
  assert.equal((await h.call('/api/membership/horoscopes')).data.length,2);
  assert.equal((await h.call('/api/membership/reading?month=2026-10')).status,200);
  assert.equal((await h.call('/api/membership/chart','PUT',{date:'1990-01-01',unknownTime:true,unknownLocation:true})).status,200);
  assert.equal((await h.call('/api/membership/reading?month=2099-01')).status,404);
  assert.equal((await h.call('/api/membership/complimentary/redeem','POST',{code:'ONE'})).status,200);
  assert.equal((await h.admin('complimentary-codes')).data[0].redemption_count,1);
  assert.equal((await join(h,'second@example.com','ONE')).status,400);
  assert.equal((await h.db.query("SELECT id FROM luce_members WHERE email='second@example.com'")).rows.length,0);
  await h.admin('complimentary-codes/'+p.data.id,'PATCH',{active:false});
  assert.equal((await h.call('/api/membership/me')).data.access,true);
  h.advance(1000*86400000);
  const row=(await h.db.query('SELECT * FROM luce_members WHERE id=$1',[m.id])).rows[0];assert.equal(h.service.access(row),true);assert.equal(row.stripe_customer_id,null);assert.equal(row.stripe_subscription_id,null);assert.equal(row.checkout_id,null);assert.equal(row.tier,'membership');
 }finally{await h.close();}
});
test('duration and fixed Pacific expiration end access without charges; new account rollback and redemption log',async()=>{
 const h=await harness(live);try{
  assert.equal((await make(h,'BAD',{expiration:'duration',duration_days:-1})).status,400);
  const p=(await make(h,'DAYS',{usage:'multiple',max_redemptions:2,expiration:'duration',duration_days:2})).data;
  await join(h,'one@example.com','DAYS');const one=(await h.call('/api/membership/me')).data;
  await join(h,'two@example.com','DAYS');const two=(await h.call('/api/membership/me')).data;
  assert.equal((await join(h,'three@example.com','DAYS')).status,400);
  const log=(await h.admin('complimentary-codes')).data[0];assert.equal(log.redemption_count,2);assert.equal(log.redemptions.length,2);assert(log.redemptions.some(r=>r.email==='one@example.com'));
  await h.db.query('UPDATE luce_members SET verified_at=NOW() WHERE id=$1',[two.id]);
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,409);
  h.advance(2*86400000);let m=(await h.call('/api/membership/me')).data;assert.equal(m.access,false);assert.equal(m.status,'expired');assert.equal((await h.call('/api/membership/horoscopes')).status,403);assert.equal((await h.call('/api/membership/reading?month=2026-10')).status,403);
  await h.call('/api/membership/complimentary/redeem','POST',{code:'DAYS'});assert.equal((await h.call('/api/membership/me')).data.access,false);
  const fixed=await make(h,'FIXED',{usage:'multiple',expiration:'date',localTime:'2026-09-23T12:00'});assert.equal(fixed.status,200);assert.equal(fixed.data.expires_at,'2026-09-23T19:00:00.000Z');
  assert.equal((await h.call('/api/membership/complimentary/redeem','POST',{code:'FIXED'})).status,200);
  h.advance(86400000);assert.equal((await h.call('/api/membership/me')).data.access,false);
  assert.equal((await join(h,'last@example.com','FIXED')).status,400);
  assert.equal(h.sent.length,0);
 }finally{await h.close();}
});
test('existing account redemption, inactive and unlimited codes; paid and pending checkout records are preserved',async()=>{
 const h=await harness(live);try{
  const p=(await make(h,'MANY',{usage:'multiple'})).data;
  await join(h,'existing@example.com');const m=(await h.call('/api/membership/me')).data;
  await h.db.query("UPDATE luce_members SET verified_at=NOW(),tier='founding',status='active',stripe_customer_id='cus_paid',stripe_subscription_id='sub_paid',access_until='2026-10-20' WHERE id=$1",[m.id]);
  const before=(await h.db.query('SELECT * FROM luce_members WHERE id=$1',[m.id])).rows[0];
  assert.equal((await h.call('/api/membership/complimentary/redeem','POST',{code:'MANY'})).status,409);
  assert.deepEqual((await h.db.query('SELECT * FROM luce_members WHERE id=$1',[m.id])).rows[0],before);
  await h.db.query("UPDATE luce_members SET stripe_customer_id=NULL,stripe_subscription_id=NULL,status='unpaid',checkout_id='cs_pending' WHERE id=$1",[m.id]);
  assert.equal((await h.call('/api/membership/complimentary/redeem','POST',{code:'MANY'})).status,409);
  await h.db.query('UPDATE luce_members SET checkout_id=NULL WHERE id=$1',[m.id]);
  await h.admin('complimentary-codes/'+p.id,'PATCH',{active:false});assert.equal((await h.call('/api/membership/complimentary/redeem','POST',{code:'MANY'})).status,400);
  await h.admin('complimentary-codes/'+p.id,'PATCH',{active:true});assert.equal((await h.call('/api/membership/complimentary/redeem','POST',{code:'MANY'})).status,200);
  assert.equal((await h.call('/api/membership/me')).data.complimentary,true);
  assert.equal((await join(h,'another@example.com','MANY')).status,200);
  assert.equal((await h.admin('complimentary-codes')).data[0].redemption_count,2);
  // Restart migrations preserve grants and redemptions.
  await h.service.initialize();assert.equal((await h.admin('complimentary-codes')).data[0].redemption_count,2);
 }finally{await h.close();}
});
