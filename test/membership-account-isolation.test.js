const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {PGlite}=require('@electric-sql/pglite');const Stripe=require('stripe');
const {createMembership,signs}=require('../private-membership/service');
async function harness(overrides={}){const db=new PGlite(),sent=[];let date=new Date('2026-09-20T20:00:00Z'),sub;
const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
const real=new Stripe('sk_test_fake');const stripe={webhooks:real.webhooks,subscriptions:{retrieve:async()=>sub},billingPortal:{configurations:{retrieve:async()=>({id:'bpc_test',livemode:false,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}})},sessions:{create:async x=>{assert.equal(x.customer,'cus_test');return {url:'https://billing.stripe.com/p/session/test'};}}}};
const membershipStripe={...stripe,accounts:{retrieve:async()=>({id:'acct_1TD7xKLZJAbDgWCX'})}};
await db.query('CREATE TABLE promo_codes(code TEXT,description TEXT,active INTEGER,discount_percent INTEGER,max_uses INTEGER,expires_at TIMESTAMPTZ)');
const env={...overrides,NODE_ENV:'test',MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET:'whsec_private_test',MEMBERSHIP_PORTAL_TEST_CONFIGURATION:'bpc_test'};
const service=createMembership({pool,env,stripeClient:stripe,membershipStripeClient:membershipStripe,fetcher:async()=>({ok:true,json:async()=>({success:true,hostname:'lucehealing.com',action:'membership_signup'})}),clock:()=>date,getMailer:()=>({sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}})});await service.initialize();const app=express();app.use('/api/membership/stripe/webhook',express.raw({type:'application/json'}));app.use(express.json());service.register(app,(req,res,next)=>req.query.password==='admin-test'||req.body?.password==='admin-test'?next():res.status(401).json({error:'Unauthorized'}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let cookies={};
const call=async(p,method='GET',body,opts={})=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',Cookie:Object.entries(opts.cookies??cookies).map(([k,v])=>k+'='+v).join('; '),...opts.headers},body:body?JSON.stringify(body):undefined});for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');cookies[k]=v;}const text=await r.text();let data;try{data=JSON.parse(text);}catch(_){data=text;}return {status:r.status,data,headers:r.headers};};
const admin=(p,m='GET',b)=>call('/api/admin/membership/'+p+'?password=admin-test',m,b);
const open=()=>call('/api/membership/review-login','POST',{password:'admin-test'});
const signup=()=>call('/api/membership/signup','POST',{name:'Christina',email:'info@christinaworkman.com',member_password:'Private-test-password-123'});
const secret=()=>sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
const verify=async()=>{await open();await signup();return call('/api/membership/verify','POST',{token:secret()});};
const webhook=async(type,id='evt_'+Math.random())=>{const event={id,type,livemode:false,data:{object:type.startsWith('invoice.')?{subscription:'sub_test'}:sub}};const raw=JSON.stringify(event);return call('/api/membership/stripe/webhook','POST',event,{headers:{'stripe-signature':real.webhooks.generateTestHeaderString({payload:raw,secret:env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET})}});};
return {stripe:membershipStripe,legacyStripe:stripe,db,sent,call,admin,open,signup,secret,verify,webhook,service,env,cookies,setSub:x=>sub=x,advance:ms=>date=new Date(+date+ms),close:async()=>{await new Promise(r=>server.close(r));await db.close();}};}

test('public verified signup has no free access; live checkout, billing isolation, cancellation and rejoin',async()=>{
 const h=await harness({MEMBERSHIP_STRIPE_LIVE_KEY:'sk_live_dedicated',MEMBERSHIP_STRIPE_LIVE_WEBHOOK_SECRET:'whsec_dedicated',MEMBERSHIP_ACCOUNT_PORTAL_CONFIGURATION:'bpc_new',STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_WEBHOOK_SECRET:'whsec_live_fake',MEMBERSHIP_LIVE_ENABLED:'true',MEMBERSHIP_FOUNDING_OFFER_OPEN:'true',MEMBERSHIP_LIVE_PRICE_FOUNDING:'price_live_m',MEMBERSHIP_LIVE_PRICE_MONTHLY:'price_live_m',MEMBERSHIP_LIVE_PRICE_ANNUAL:'price_live_a',MEMBERSHIP_PORTAL_LIVE_CONFIGURATION:'bpc_live',TURNSTILE_SITE_KEY:'test-site',TURNSTILE_SECRET_KEY:'test-secret'});
 const requests=[];let session,sub,mode=true;
 h.stripe.prices={retrieve:async id=>({id,livemode:mode,active:true,currency:'usd',unit_amount:{price_live_f:295,price_live_m:495,price_live_a:4950}[id],recurring:{interval:id==='price_live_a'?'year':'month',interval_count:1,usage_type:'licensed'},billing_scheme:'per_unit'})};
 h.stripe.checkout={sessions:{create:async(params,options)=>{requests.push({params,options});return session={id:'cs_live_'+requests.length,url:'https://checkout.stripe.com/live-example',status:'open',livemode:true}},retrieve:async()=>session,expire:async()=>{session.status='expired'}}};
 h.stripe.billingPortal.configurations.retrieve=async()=>({id:'bpc_live',livemode:true,active:true,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}});
 const sync=async status=>{sub={...sub,status};h.stripe.subscriptions={retrieve:async()=>sub};return h.service.handleLiveEvent({id:'evt_live_'+Math.random(),livemode:true,type:'customer.subscription.updated',data:{object:sub}},'acct_1TD7xKLZJAbDgWCX')};
 try{
  assert.equal((await h.call('/api/membership/config')).data.purchasingEnabled,true);
  const signup={name:'New member',email:'member@example.com',member_password:'Safe-test-password'};
  assert.equal((await h.call('/api/membership/signup','POST',signup)).status,400);
  assert.equal((await h.call('/api/membership/signup','POST',{...signup,turnstile_token:'approved'})).status,200);
  let m=(await h.call('/api/membership/me')).data;assert.equal(m.is_test,false);assert.equal(m.access,false);
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,403);
  assert.equal((await h.call('/api/membership/verify','POST',{token:h.secret()})).status,200);
  m=(await h.call('/api/membership/me')).data;assert.equal(m.status,'unpaid');assert.equal(m.access,false);assert.equal(m.access_until,null);
  assert.equal((await h.call('/api/membership/horoscopes')).status,403);
  h.stripe.accounts.retrieve=async()=>({id:'acct_wrong'});
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,503);assert.equal(requests.length,0);
  h.stripe.accounts.retrieve=async()=>({id:'acct_1TD7xKLZJAbDgWCX'});
  mode=false;assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,409);mode=true;
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly',amount:1})).status,200);
  assert.equal(requests[0].params.line_items[0].price,'price_live_m');assert.equal(requests[0].params.subscription_data.metadata.luce_membership,'membership');
  await h.call('/api/membership/checkout','POST',{plan:'monthly'});assert.equal(requests.length,1);
  sub={id:'sub_live_first',customer:'cus_test',livemode:true,status:'active',metadata:requests[0].params.subscription_data.metadata,items:{data:[{quantity:1,price:{id:'price_live_m'},current_period_start:1790000000,current_period_end:1792000000}]}};h.stripe.subscriptions={retrieve:async()=>sub};
  const event={id:'evt_signed_membership',livemode:true,type:'customer.subscription.updated',data:{object:sub}};
  const sig=new Stripe('sk_test_fake').webhooks.generateTestHeaderString({payload:JSON.stringify(event),secret:'whsec_dedicated'});
  assert.equal((await h.call('/api/membership/stripe/webhook/live','POST',event,{headers:{'stripe-signature':'invalid'}})).status,400);
  for(let i=0;i<2;i++)assert.equal((await h.call('/api/membership/stripe/webhook/live','POST',event,{headers:{'stripe-signature':sig}})).status,200);
  assert.equal((await h.db.query("SELECT COUNT(*) AS n FROM luce_member_events WHERE id='evt_signed_membership'")).rows[0].n,1);
  m=(await h.call('/api/membership/me')).data;assert.equal(m.access,true);assert.equal(m.tier,'monthly');
  const months=await h.call('/api/membership/horoscopes');assert.equal(months.status,200);assert.equal(months.data.length,0);
  assert.equal((await h.call('/api/membership/reading?month=2099-01')).status,404);
  const before=(await h.db.query('SELECT * FROM luce_members WHERE id=$1',[m.id])).rows[0];await h.service.syncSubscription({...sub,livemode:false,metadata:{...sub.metadata,luce_membership:'preview'},status:'canceled'});assert.equal((await h.db.query('SELECT status FROM luce_members WHERE id=$1',[m.id])).rows[0].status,before.status);
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'annual'})).status,409);
  sub={...sub,cancel_at_period_end:true};await sync('active');assert.equal((await h.call('/api/membership/me')).data.access,true);
  assert.equal((await h.call('/api/membership/portal','POST',{})).status,200);
  await sync('past_due');assert.equal((await h.call('/api/membership/horoscopes')).status,403);await sync('active');
  await sync('canceled');assert.equal((await h.call('/api/membership/me')).data.access,false);h.env.MEMBERSHIP_FOUNDING_OFFER_OPEN='false';
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,200);assert.equal(requests.at(-1).params.line_items[0].price,'price_live_m');
  const old=sub;sub={...sub,id:'sub_live_second',metadata:requests.at(-1).params.subscription_data.metadata,items:{data:[{quantity:1,price:{id:'price_live_m'},current_period_start:1790000000,current_period_end:1792000000}]}};await sync('active');await h.service.syncSubscription(old,'acct_1TD7xKLZJAbDgWCX');assert.equal((await h.db.query('SELECT stripe_subscription_id FROM luce_members WHERE id=$1',[m.id])).rows[0].stripe_subscription_id,'sub_live_second');
  await sync('canceled');assert.equal((await h.call('/api/membership/checkout','POST',{plan:'annual'})).status,200);assert.equal(requests.at(-1).params.line_items[0].price,'price_live_a');const record=(await h.db.query('SELECT * FROM luce_members WHERE id=$1',[m.id])).rows[0];record.status='active';h.advance(40*86400000);assert.equal(h.service.access(record),false);assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'member@example.com');


  h.advance(-40*86400000);
  // A completed checkout is reconciled on return even before its webhook arrives.
  session={...session,status:'complete',mode:'subscription',client_reference_id:String(m.id),metadata:requests.at(-1).params.metadata,subscription:'sub_annual'};
  sub={...sub,id:'sub_annual',status:'active',metadata:requests.at(-1).params.subscription_data.metadata,items:{data:[{quantity:1,price:{id:'price_live_a'},current_period_start:1790000000,current_period_end:1821536000}]}};
  const returned=(await h.call('/api/membership/me')).data;assert.equal(returned.access,true);assert.equal(returned.tier,'annual');

  // Existing members with untagged Stripe IDs must retain legacy account and portal.
  await h.db.query("UPDATE luce_members SET checkout_id=NULL,stripe_billing_account=NULL,stripe_customer_id='cus_test',stripe_subscription_id='sub_legacy',status='active',billing_synced_at=$1,access_until=$2 WHERE id=$3",[new Date('2026-10-30'),new Date('2026-12-30'),m.id]);
  let legacyPortal=0;
  h.legacyStripe.billingPortal={configurations:{retrieve:async id=>{assert.equal(id,'bpc_live');return {id,active:true,livemode:true,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}}}},sessions:{create:async params=>{legacyPortal++;assert.equal(params.customer,'cus_test');return {url:'https://billing.stripe.com/legacy'};}}};
  assert.equal((await h.call('/api/membership/portal','POST',{})).status,200);assert.equal(legacyPortal,1);
  await assert.rejects(()=>h.service.syncSubscription(sub,'acct_1TD7xKLZJAbDgWCX'),/account mismatch/);
  await h.db.query("INSERT INTO promo_codes VALUES('MEMBER1000','Existing promo',1,100,NULL,NULL)");
  await h.service.initialize();
  const requestCount=requests.length;
  assert.equal((await h.call('/api/membership/signup','POST',{name:'Complimentary test',email:'comp@example.com',member_password:'Safe-test-password',turnstile_token:'approved',complimentary_code:'MEMBER1000'})).status,200);
  const comp=(await h.call('/api/membership/me')).data;assert.equal(comp.access,true);assert.equal(comp.complimentary,true);assert.equal(requests.length,requestCount);
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,403);

 }finally{await h.close()}
});
