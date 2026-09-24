const crypto=require('crypto'),path=require('path'),{promisify}=require('util');
const scrypt=promisify(crypto.scrypt);
const chart=require('./chart');
const moment=require('moment-timezone');
const scheduleZone='America/Los_Angeles';
function scheduleInstant(local,occurrence='unknown'){
 if(typeof local!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)||!moment.utc(local,'YYYY-MM-DDTHH:mm',true).isValid())throw fail('Enter a valid Pacific date and time.');
 const times=chart.localCandidates(local.slice(0,10),local.slice(11),scheduleZone);
 if(!times.length)throw fail('This Pacific time does not occur because clocks move forward. Choose another time.');
 if(times.length>1&&!['earlier','later'].includes(occurrence))throw fail('This Pacific time occurs twice. Choose the first or second occurrence.');
 return new Date(occurrence==='later'?times.at(-1):times[0]);
}
const signs=['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
const token=()=>crypto.randomBytes(32).toString('hex'),hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emailOK=v=>typeof v==='string'&&v.length<=254&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const cookie=(req,name)=>{const v=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return v?v.slice(name.length+1):'';};
function createMembership({pool,getMailer,env=process.env,clock=()=>new Date(),stripeClient,fetcher=fetch}){
 const q=(s,p=[])=>pool.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const origin='https://lucehealing.com',testEmail='info@christinaworkman.com';
 // Reuse the site's client. A same-account test credential may override it for private testing only.
 const testKey=env.MEMBERSHIP_STRIPE_TEST_KEY;
 const stripe=testKey?.startsWith('sk_test_')?require('stripe')(testKey):stripeClient;
 const sandboxKey=testKey?.startsWith('sk_test_')||env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
 const testCheckoutEnabled=()=>env.MEMBERSHIP_TEST_CHECKOUT_ENABLED==='true'&&!!sandboxKey&&!!stripe&&!!env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET&&!!env.MEMBERSHIP_PORTAL_TEST_CONFIGURATION;
 const plans={founding:{amount:295,interval:'month',key:'MEMBERSHIP_TEST_PRICE_FOUNDING'},monthly:{amount:395,interval:'month',key:'MEMBERSHIP_TEST_PRICE_MONTHLY'},annual:{amount:3792,interval:'year',key:'MEMBERSHIP_TEST_PRICE_ANNUAL'}};
 const liveStripe=env.STRIPE_SECRET_KEY?.startsWith('sk_live_')?stripeClient:null;
 const liveEnabled=()=>env.MEMBERSHIP_LIVE_ENABLED==='true'&&!!liveStripe&&!!env.STRIPE_WEBHOOK_SECRET&&!!env.MEMBERSHIP_PORTAL_LIVE_CONFIGURATION&&!!env.TURNSTILE_SITE_KEY&&!!env.TURNSTILE_SECRET_KEY&&['FOUNDING','MONTHLY','ANNUAL'].every(p=>env['MEMBERSHIP_LIVE_PRICE_'+p]);
 const priceKey=(spec,live)=>live?spec.key.replace('_TEST_','_LIVE_'):spec.key;
 const clientFor=m=>m.is_test?stripe:liveStripe;
 const portalFor=m=>m.is_test?env.MEMBERSHIP_PORTAL_TEST_CONFIGURATION:env.MEMBERSHIP_PORTAL_LIVE_CONFIGURATION;
 const offeredPlan=plan=>plan==='monthly'&&env.MEMBERSHIP_FOUNDING_OFFER_OPEN==='true'?'founding':plan;

 const clientIP=req=>{const hops=Math.max(0,Math.min(3,Number(env.NEWSLETTER_TRUST_PROXY_HOPS)||0)),forwarded=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim());return hops&&forwarded.length>=hops?forwarded[forwarded.length-hops]:req.socket?.remoteAddress||'unknown';};
 const now=()=>clock(),later=ms=>new Date(+now()+ms);
 const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(!e.status)console.error('[Luce membership]',e.code||e.name);res.status(e.status||500).json({error:e.status?e.message:'Unable to complete this request. Please try again.'});}};
 const tx=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const setCookie=(res,name,value,seconds)=>res.cookie(name,value,{httpOnly:true,secure:env.NODE_ENV!=='test',sameSite:'lax',path:'/',maxAge:seconds*1000});
 async function initialize(){
  const schema=`CREATE TABLE IF NOT EXISTS luce_members(id SERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,verified_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),tier TEXT NOT NULL DEFAULT 'shared_preview',status TEXT NOT NULL DEFAULT 'pending',access_until TIMESTAMPTZ,cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,stripe_customer_id TEXT UNIQUE,stripe_subscription_id TEXT UNIQUE,billing_period_start TIMESTAMPTZ,billing_period_end TIMESTAMPTZ,billing_synced_at TIMESTAMPTZ,is_test BOOLEAN NOT NULL DEFAULT true);
   CREATE TABLE IF NOT EXISTS luce_member_sessions(token_hash TEXT PRIMARY KEY,member_id INTEGER REFERENCES luce_members(id),kind TEXT NOT NULL,email TEXT,expires_at TIMESTAMPTZ NOT NULL);
   CREATE TABLE IF NOT EXISTS luce_member_tokens(token_hash TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES luce_members(id),kind TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
   CREATE TABLE IF NOT EXISTS luce_member_limits(key TEXT NOT NULL,bucket BIGINT NOT NULL,n INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(key,bucket));
   CREATE TABLE IF NOT EXISTS luce_horoscopes(month TEXT PRIMARY KEY,title TEXT NOT NULL,draft JSONB NOT NULL,demo BOOLEAN NOT NULL DEFAULT false,published JSONB,published_title TEXT,published_demo BOOLEAN,published_at TIMESTAMPTZ,revision INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   CREATE TABLE IF NOT EXISTS luce_member_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`;
  await tx(async c=>{for(const statement of schema.split(';').filter(x=>x.trim()))await c.query(statement);});
  await q('ALTER TABLE luce_members ADD COLUMN IF NOT EXISTS checkout_id TEXT, ADD COLUMN IF NOT EXISTS checkout_nonce TEXT, ADD COLUMN IF NOT EXISTS checkout_plan TEXT');
  await q('ALTER TABLE luce_members ADD COLUMN IF NOT EXISTS birth_profile JSONB, ADD COLUMN IF NOT EXISTS birth_chart JSONB');
  await q('ALTER TABLE luce_horoscopes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS scheduled_draft JSONB, ADD COLUMN IF NOT EXISTS scheduled_title TEXT, ADD COLUMN IF NOT EXISTS scheduled_demo BOOLEAN');
  await q("ALTER TABLE luce_horoscopes ADD COLUMN IF NOT EXISTS display_month TEXT, ADD COLUMN IF NOT EXISTS subtitle TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS collection_hidden BOOLEAN NOT NULL DEFAULT false");
  await q("ALTER TABLE luce_horoscopes ADD COLUMN IF NOT EXISTS collection_type TEXT NOT NULL DEFAULT 'monthly'");
  await q('CREATE TABLE IF NOT EXISTS luce_membership_migrations(name TEXT PRIMARY KEY)');
  await tx(async c=>{
   const applied=await c.query("INSERT INTO luce_membership_migrations(name) VALUES('special-guidance-and-october-feature-2026-09-24') ON CONFLICT DO NOTHING RETURNING name");
   if(!applied.rows.length)return;
   await c.query(`UPDATE luce_horoscopes SET collection_type='special',featured_at=NULL,revision=revision+1
    WHERE month='2026-09' AND title='For the September 26, 2026 Full Moon at 3°37′ Aries'`);
   await c.query(`UPDATE luce_horoscopes SET featured_at=$1,revision=revision+1
    WHERE month='2026-10' AND title='October 2026 Monthly Horoscopes' AND published IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM luce_horoscopes WHERE collection_type='monthly' AND featured_at IS NOT NULL)`,[now()]);
  });
  // Correct the existing Full Moon collection's accidental test label, never its text.
  // Exact content fingerprints prevent changing a replacement or subsequently edited collection.
  await q(`UPDATE luce_horoscopes SET demo=false,published_demo=false,revision=revision+1
   WHERE month='2026-09' AND demo=true
   AND title='For the September 26, 2026 Full Moon at 3°37′ Aries'
   AND md5(draft::text)='5f5221e14f957cb30b517cb3f8542e14'
   AND md5(published::text)='5f5221e14f957cb30b517cb3f8542e14'`);
  const demo=JSON.stringify(Object.fromEntries(signs.map(sign=>[sign,`Demonstration placeholder for ${sign}. Christina’s monthly horoscope will appear here. This sample is only for reviewing the member reading experience; it is not an actual forecast.`])));
  await q(`INSERT INTO luce_horoscopes(month,title,draft,demo,published,published_title,published_demo,published_at) VALUES('2099-01','Demonstration month',$1,true,$1,'Demonstration month',true,$2) ON CONFLICT(month) DO NOTHING`,[demo,now()]);
 }
 let timer=null;
 async function tick(){
  return q(`UPDATE luce_horoscopes SET collection_hidden=false,published=scheduled_draft,published_title=scheduled_title,published_demo=scheduled_demo,published_at=$1,scheduled_at=NULL,scheduled_draft=NULL,scheduled_title=NULL,scheduled_demo=NULL,revision=revision+1,updated_at=$1 WHERE scheduled_at<=$1 AND scheduled_draft IS NOT NULL RETURNING month`,[now()]);
 }
 function start(){if(timer)return;const run=()=>tick().catch(e=>console.error('[Luce horoscope scheduler]',e.code||e.name));timer=setInterval(run,30000);timer.unref();run();}
 function stop(){if(timer)clearInterval(timer);timer=null;}
 async function limit(key,max=10,period=3600000){const bucket=Math.floor(+now()/period);const r=await one(`INSERT INTO luce_member_limits(key,bucket) VALUES($1,$2) ON CONFLICT(key,bucket) DO UPDATE SET n=luce_member_limits.n+1 RETURNING n`,[hash(key),bucket]);if(r.n>max)throw fail('Too many attempts. Please try again later.',429);}
 async function passwordHash(p){if(typeof p!=='string'||p.length<8||p.length>200)throw fail('Use a password of 8–200 characters.');const salt=crypto.randomBytes(16).toString('hex');return salt+':'+(await scrypt(p,salt,64)).toString('hex');}
 async function passwordMatches(p,encoded){if(typeof p!=='string'||p.length>200)return false;const [salt,digest]=encoded.split(':');const actual=await scrypt(p,salt,64);return actual.length===Buffer.from(digest,'hex').length&&crypto.timingSafeEqual(actual,Buffer.from(digest,'hex'));}
 async function session(req){const t=cookie(req,'luce_member');if(!/^[a-f0-9]{64}$/.test(t))return null;return one(`SELECT m.* FROM luce_members m JOIN luce_member_sessions s ON s.member_id=m.id WHERE s.token_hash=$1 AND s.kind='member' AND s.expires_at>$2`,[hash(t),now()]);}
 async function preview(req){const m=await session(req);if(m?.is_test)return {email:m.email};const t=cookie(req,'luce_preview');if(!/^[a-f0-9]{64}$/.test(t))return null;return one("SELECT email FROM luce_member_sessions WHERE token_hash=$1 AND kind='preview' AND expires_at>$2",[hash(t),now()]);}
 async function needPreview(req,res,next){try{if(liveEnabled())return next();if(!await preview(req))return res.status(404).json({error:'This private preview requires Admin access.'});next();}catch(_){res.status(503).json({error:'Preview temporarily unavailable.'});}}
 async function needMember(req){const m=await session(req);if(!m)throw fail('Please sign in.',401);return m;}
 async function startSession(res,m){const t=token();await q("INSERT INTO luce_member_sessions(token_hash,member_id,kind,expires_at) VALUES($1,$2,'member',$3)",[hash(t),m.id,later(7*86400000)]);setCookie(res,'luce_member',t,7*86400);}
 function access(m){return !!m.verified_at&&(m.is_test?['preview','active','trialing']:['active']).includes(m.status)&&!!m.access_until&&new Date(m.access_until)>now();}
 function publicMember(m){return {id:m.id,email:m.email,name:m.name,verified:!!m.verified_at,tier:m.tier,status:access(m)?m.status:(['preview','active','trialing'].includes(m.status)?'expired':m.status),access:access(m),access_until:m.access_until,cancel_at_period_end:m.cancel_at_period_end,billing_period_start:m.billing_period_start,billing_period_end:m.billing_period_end,is_test:m.is_test,portal_available:!!clientFor(m)&&!!portalFor(m)&&!!m.stripe_customer_id};}
 async function accountMail(m,kind){
  if(m.is_test&&m.email!==testEmail)throw fail('Private account emails are restricted to the designated test inbox.',403);if(!m.is_test&&!liveEnabled())throw fail('Membership email is temporarily unavailable.',503);
  await limit('mail:'+m.id+':'+kind,3);
  const mailer=getMailer();if(!mailer)throw fail('Luce email sender is not configured.',503);
  const t=token(),url=origin+'/members/'+(kind==='verify'?'verify':'reset')+'?token='+t;
  await q('DELETE FROM luce_member_tokens WHERE member_id=$1 AND kind=$2',[m.id,kind]);
  await q('INSERT INTO luce_member_tokens(token_hash,member_id,kind,expires_at) VALUES($1,$2,$3,$4)',[hash(t),m.id,kind,later(kind==='verify'?86400000:3600000)]);
  const subject=kind==='verify'?'Confirm your Luce Healing member account':'Reset your Luce Healing password';
  try{const r=await mailer.sendMail({from:{name:'Christina at Luce Healing',address:'lucehealing13@gmail.com'},to:m.email,subject,text:`${subject}\n${url}\n${m.is_test?'This is your private membership preview account. No subscription or charge is created.':'Confirming your email does not start a subscription. Membership payment is a separate step.'} If you did not request this email, ignore it.`,html:`<div style="background:#f3eef6;padding:24px;font:17px/1.7 Georgia,serif;color:#392c44"><div style="max-width:600px;margin:auto;background:white;padding:24px;border-radius:12px"><h1>Luce Healing</h1><h2>${subject}</h2><p>Hello ${esc(m.name)},</p><p><a href="${url}" style="background:#624373;color:white;padding:14px;display:inline-block;border-radius:6px">${kind==='verify'?'Confirm my account':'Reset my password'}</a></p><p>${m.is_test?'This private preview creates no paid subscription.':'Membership payment is a separate step; this email does not authorize a charge.'} This link expires in ${kind==='verify'?'24 hours':'one hour'}. If you did not request it, ignore this email.</p></div></div>`});if(!r.accepted?.length)throw Error('Not accepted');}
  catch(_){await q('DELETE FROM luce_member_tokens WHERE token_hash=$1',[hash(t)]);throw fail('Email could not be sent. Please try again.',503);}
 }
 async function consume(t,kind,fn){if(!/^[a-f0-9]{64}$/.test(t||''))throw fail('Invalid or expired link. Request a new email.',410);return tx(async c=>{const r=(await c.query('DELETE FROM luce_member_tokens WHERE token_hash=$1 AND kind=$2 AND expires_at>$3 RETURNING member_id',[hash(t),kind,now()])).rows[0];if(!r)throw fail('Invalid or expired link. Request a new email.',410);return fn(c,r.member_id);});}
 async function syncSubscription(sub){
  const live=sub.livemode===true;if(live&&!liveStripe)throw fail('Live membership billing is not configured.',503);
  const id=Number(sub.metadata?.luce_member_id);if(!Number.isInteger(id)||sub.metadata?.luce_membership!==(live?'membership':'preview'))return;
  const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
  const end=sub.current_period_end||sub.items?.data?.[0]?.current_period_end;
  const start=sub.current_period_start||sub.items?.data?.[0]?.current_period_start;
  const endDate=end?new Date(end*1000):null;
  await tx(async c=>{const m=(await c.query('SELECT * FROM luce_members WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!m||m.is_test===live)return;
   if(m.stripe_customer_id&&m.stripe_customer_id!==customer)throw fail('Subscription identity mismatch.',409);
   const checkoutMatch=m.checkout_nonce&&sub.metadata?.luce_checkout_nonce===m.checkout_nonce;
   if(m.stripe_subscription_id&&m.stripe_subscription_id!==sub.id&&!checkoutMatch)return;
   if(live&&!sub.metadata?.luce_plan)throw fail('Missing membership price identity.',409);
   if(sub.metadata?.luce_plan){
    if(!checkoutMatch&&m.stripe_subscription_id!==sub.id)throw fail('Checkout identity mismatch.',409);
    const spec=plans[sub.metadata.luce_plan],items=sub.items?.data;
    if(!spec||items?.length!==1||items[0].quantity!==1||items[0].price?.id!==env[priceKey(spec,live)])throw fail('Subscription price mismatch.',409);
   }
   if(sub.metadata?.luce_plan)await c.query('UPDATE luce_members SET tier=$1,checkout_id=NULL WHERE id=$2',[sub.metadata.luce_plan,id]);
   await c.query(`UPDATE luce_members SET stripe_customer_id=$1,stripe_subscription_id=$2,status=$3,access_until=$4,cancel_at_period_end=$5,billing_period_start=$6,billing_period_end=$4,billing_synced_at=$7 WHERE id=$8`,[customer,sub.id,sub.status,endDate,!!sub.cancel_at_period_end,start?new Date(start*1000):null,now(),id]);
  });
 }
 async function checkout(req){
  if(!liveEnabled()&&!testCheckoutEnabled())throw fail('Membership purchasing is not currently available.',403);
  const member=await needMember(req);
  const live=!member.is_test,stripe=clientFor(member);if(!member.verified_at)throw fail('Confirm your email first.',403);if(live&&!liveEnabled()||!live&&(!testCheckoutEnabled()||member.email!==testEmail))throw fail('Checkout is unavailable for this account.',403);
  if(!['monthly','annual'].includes(req.body.plan))throw fail('Choose monthly or annual membership.');
  await limit('checkout:'+member.id,20);
  return tx(async c=>{
   const m=(await c.query('SELECT * FROM luce_members WHERE id=$1 FOR UPDATE',[member.id])).rows[0];
   if(m.stripe_subscription_id){const sub=await stripe.subscriptions.retrieve(m.stripe_subscription_id);if(sub.livemode!==live)throw fail('Stripe billing mode mismatch.',403);if(!['canceled','incomplete_expired'].includes(sub.status))throw fail('You already have a subscription. Use Manage billing.',409);}
   const plan=offeredPlan(req.body.plan),spec=plans[plan],priceId=env[priceKey(spec,live)];
   if(!priceId)throw fail('Membership price is not configured.',503);
   const price=await stripe.prices.retrieve(priceId);
   if(price.livemode!==live||!price.active||price.currency!=='usd'||price.unit_amount!==spec.amount||price.recurring?.interval!==spec.interval||price.recurring?.interval_count!==1||price.recurring?.usage_type!=='licensed'||price.billing_scheme!=='per_unit')throw fail('Stripe price does not match the approved membership price.',409);
   if(m.checkout_id){const old=await stripe.checkout.sessions.retrieve(m.checkout_id);if(old.livemode!==live)throw fail('Stripe billing mode mismatch.',403);if(old.status==='complete')throw fail('Payment is being confirmed. Refresh your account shortly.',409);if(old.status==='open'){if(m.checkout_plan===plan)return {url:old.url};await stripe.checkout.sessions.expire(old.id);}}
   // A deterministic attempt identity keeps API retries idempotent after a transaction rollback.
   const nonce=hash('checkout:'+m.id+':'+(m.checkout_id||m.stripe_subscription_id||'first')+':'+plan);
   const metadata={luce_member_id:String(m.id),luce_membership:live?'membership':'preview',luce_plan:plan,luce_checkout_nonce:nonce};
   const result=await stripe.checkout.sessions.create({mode:'subscription',payment_method_types:['card'],line_items:[{price:priceId,quantity:1}],...(m.stripe_customer_id?{customer:m.stripe_customer_id}:{customer_email:m.email}),client_reference_id:String(m.id),metadata,subscription_data:{metadata},success_url:origin+'/members/account?checkout=success',cancel_url:origin+'/members/account?checkout=canceled'}, {idempotencyKey:'luce-membership-'+(live?'live':'test')+':'+m.id+':'+nonce});
   if(result.livemode!==live)throw fail('Stripe billing mode mismatch.',403);
   await c.query('UPDATE luce_members SET checkout_id=$1,checkout_nonce=$2,checkout_plan=$3 WHERE id=$4',[result.id,nonce,plan,m.id]);
   return {url:result.url};
  });
 }
 async function reconcile(m){const stripe=clientFor(m);if(stripe&&m.stripe_subscription_id&&(!m.billing_synced_at||+now()-new Date(m.billing_synced_at)>60000)){try{await syncSubscription(await stripe.subscriptions.retrieve(m.stripe_subscription_id));}catch(_){throw fail('Unable to confirm membership billing. Please try again shortly.',503);}return one('SELECT * FROM luce_members WHERE id=$1',[m.id]);}return m;}
 async function handleLiveEvent(event){
  if(event.livemode!==true||!liveStripe)return false;
  const obj=event.data.object;let id,sub;
  if(event.type==='checkout.session.completed'&&obj.mode==='subscription'&&obj.metadata?.luce_membership==='membership')id=typeof obj.subscription==='string'?obj.subscription:obj.subscription?.id;
  else if(event.type.startsWith('customer.subscription.')&&obj.metadata?.luce_membership==='membership'){if(event.type==='customer.subscription.deleted')sub=obj;else id=obj.id;}
  else if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required'].includes(event.type)){const ref=obj.subscription||obj.parent?.subscription_details?.subscription;id=typeof ref==='string'?ref:ref?.id;}
  if(id)sub=await liveStripe.subscriptions.retrieve(id);
  if(sub?.metadata?.luce_membership!=='membership')return false;
  if(await one('SELECT id FROM luce_member_events WHERE id=$1',[event.id]))return true;
  await syncSubscription(sub);await q('INSERT INTO luce_member_events(id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING',[event.id,event.type]);return true;
 }
 function register(app,checkAdmin){
  app.use(['/members','/api/membership','/api/admin/membership'],(req,res,next)=>{res.set({'X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&!req.originalUrl.startsWith('/api/membership/stripe/webhook')&&(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin&&env.NODE_ENV!=='test')))return res.status(403).json({error:'Please use the Luce Healing site.'});next();});
  // These files are only served by gated routes, never by the site's static root.
  app.use('/private-membership',(req,res)=>res.sendStatus(404));
  app.get('/members/review',(req,res)=>res.sendFile(path.join(__dirname,'review.html')));
  app.post('/api/membership/review-login',async(req,res,next)=>{try{await limit('review:'+clientIP(req),15);next();}catch(e){res.status(e.status||500).json({error:e.message});}},checkAdmin,wrap(async(req,res)=>{const t=token();await q("INSERT INTO luce_member_sessions(token_hash,kind,email,expires_at) VALUES($1,'preview',$2,$3)",[hash(t),testEmail,later(7*86400000)]);setCookie(res,'luce_preview',t,7*86400);res.json({url:'/members'});}));
  app.get(['/members/verify','/members/reset'],(req,res)=>res.sendFile(path.join(__dirname,'member.html')));
  app.get('/members/assets/member.js',(req,res)=>res.type('js').sendFile(path.join(__dirname,'member.js')));
  app.get('/members/assets/style.css',(req,res)=>res.type('css').sendFile(path.join(__dirname,'style.css')));
  app.get(['/members','/members/account','/members/information','/members/chart','/members/reading'],needPreview,(req,res)=>res.sendFile(path.join(__dirname,'member.html')));
  app.get('/api/membership/config',wrap(async(req,res)=>{const m=await session(req),p=await preview(req);await tick();const next=await one('SELECT month,scheduled_at FROM luce_horoscopes WHERE scheduled_at IS NOT NULL AND collection_type=\'monthly\' AND scheduled_demo=false ORDER BY scheduled_at LIMIT 1');const latest=await one('SELECT month FROM luce_horoscopes WHERE published IS NOT NULL AND collection_hidden=false AND published_demo=false AND collection_type=\'monthly\' ORDER BY featured_at DESC NULLS LAST,published_at DESC NULLS LAST,month DESC LIMIT 1');res.json({private:!liveEnabled(),purchasingEnabled:!!liveEnabled(),testCheckoutEnabled:!!p&&testCheckoutEnabled(),foundingOfferOpen:env.MEMBERSHIP_FOUNDING_OFFER_OPEN==='true',testEmail:p?.email||'',turnstileSiteKey:liveEnabled()?env.TURNSTILE_SITE_KEY:null,signs,nextPublication:next||null,latestMonth:latest?.month||null});}));
  app.post('/api/membership/checkout',wrap(async(req,res)=>res.json(await checkout(req))));
  app.post('/api/membership/signup',needPreview,wrap(async(req,res)=>{
   await limit('signup:'+clientIP(req),10);if(req.body.website)return res.json({success:true,message:'Check your inbox to confirm your member account.'});
   const p=await preview(req),email=String(req.body.email||'').trim().toLowerCase(),isTest=!!p&&email===testEmail;
   if(!emailOK(email)||!isTest&&!liveEnabled())throw fail('Enter a valid email address.');
   if(!isTest){const response=req.body.turnstile_token;if(typeof response!=='string'||!response||response.length>2048)throw fail('Please complete the security check.');let check;try{const r=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();check=await r.json();}catch(_){throw fail('Security check unavailable. Please try again.',503);}if(!check.success||!['lucehealing.com','www.lucehealing.com'].includes(check.hostname)||check.action!=='membership_signup')throw fail('The security check expired. Please try again.');}
   const name=String(req.body.name||'').trim().slice(0,120);if(!name)throw fail('Enter your name.');const pw=await passwordHash(req.body.member_password);await limit('signup-email:'+email,3);
   const existing=await one('SELECT id FROM luce_members WHERE email=$1',[email]);if(existing)throw fail('This account already exists. Sign in or reset your password.',409);
   const m=await one("INSERT INTO luce_members(email,name,password_hash,is_test,tier) VALUES($1,$2,$3,$4,$5) RETURNING *",[email,name,pw,isTest,isTest?'shared_preview':'membership']);await startSession(res,m);
   try{await accountMail(m,'verify');res.json({success:true,message:'Check your inbox to confirm your member account.'});}catch(e){res.json({success:true,message:'Account saved. '+e.message+' Use Resend confirmation.'});}
  }));
  app.post('/api/membership/login',needPreview,wrap(async(req,res)=>{await limit('login:'+clientIP(req),30);const email=String(req.body.email||'').trim().toLowerCase();await limit('login-email:'+email,10);const m=await one('SELECT * FROM luce_members WHERE email=$1',[email]);if(!m||!await passwordMatches(req.body.member_password,m.password_hash))throw fail('Email or password is incorrect.',401);await startSession(res,m);res.json({success:true});}));
  app.post('/api/membership/logout',wrap(async(req,res)=>{await q('DELETE FROM luce_member_sessions WHERE token_hash=$1',[hash(cookie(req,'luce_member'))]);setCookie(res,'luce_member','',0);res.json({success:true});}));
  app.post('/api/membership/resend',needPreview,wrap(async(req,res)=>{const m=await needMember(req);if(!m.verified_at)await accountMail(m,'verify');res.json({success:true,message:'If confirmation is needed, check your inbox.'});}));
  app.post('/api/membership/forgot',needPreview,wrap(async(req,res)=>{await limit('forgot:'+clientIP(req),10);const email=String(req.body.email||'').trim().toLowerCase();const m=await one('SELECT * FROM luce_members WHERE email=$1',[email]);if(m&&(!m.is_test||email===testEmail))await accountMail(m,'reset');res.json({success:true,message:'If that account exists, a reset email has been sent.'});}));
  app.post('/api/membership/verify',wrap(async(req,res)=>{await limit('verify:'+clientIP(req),30);const m=await consume(req.body.token,'verify',async(c,id)=>(await c.query("UPDATE luce_members SET verified_at=COALESCE(verified_at,$1),status=CASE WHEN status='pending' AND is_test THEN 'preview' WHEN status='pending' THEN 'unpaid' ELSE status END,access_until=CASE WHEN is_test THEN COALESCE(access_until,$2) ELSE access_until END WHERE id=$3 RETURNING *",[now(),later(7*86400000),id])).rows[0]);await startSession(res,m);res.json({success:true,message:m.is_test?'Your account is confirmed. Your seven-day private preview is ready.':'Your email is confirmed. Choose your membership on the Account page.'});}));
  app.post('/api/membership/reset',wrap(async(req,res)=>{await limit('reset:'+clientIP(req),20);const pw=await passwordHash(req.body.member_password);await consume(req.body.token,'reset',async(c,id)=>{await c.query('UPDATE luce_members SET password_hash=$1 WHERE id=$2',[pw,id]);await c.query("DELETE FROM luce_member_sessions WHERE member_id=$1 AND kind='member'",[id]);});setCookie(res,'luce_member','',0);res.json({success:true,message:'Password updated. Please sign in again.'});}));
  app.get('/api/membership/me',needPreview,wrap(async(req,res)=>res.json(publicMember(await reconcile(await needMember(req))))));
  app.get('/api/membership/horoscopes',needPreview,wrap(async(req,res)=>{await tick();const m=await reconcile(await needMember(req));if(!access(m))throw fail('Confirm your account and check your membership access on the Account page.',403);res.json((await q('SELECT month,COALESCE(display_month,month) AS display_month,subtitle,featured_at,collection_type,published_title AS title,published AS content,published_demo AS demo,published_at FROM luce_horoscopes WHERE published IS NOT NULL AND collection_hidden=false AND ($1 OR published_demo=false) ORDER BY published_demo,published_at DESC NULLS LAST,month DESC',[m.is_test])).rows);}));
  app.get('/api/membership/places',needPreview,wrap(async(req,res)=>{await needMember(req);await limit('places:'+clientIP(req),300);res.json(chart.searchPlaces(String(req.query.q||'').slice(0,100)));}));
  app.get('/api/membership/chart',needPreview,wrap(async(req,res)=>{const m=await needMember(req);res.json({profile:m.birth_profile||null,chart:m.birth_chart||null});}));
  app.put('/api/membership/chart',needPreview,wrap(async(req,res)=>{const m=await needMember(req);await limit('chart:'+m.id,60);const result=chart.calculate(req.body);await q('UPDATE luce_members SET birth_profile=$1,birth_chart=$2 WHERE id=$3',[JSON.stringify(result.profile),JSON.stringify(result),m.id]);res.json({profile:result.profile,chart:result});}));
  app.delete('/api/membership/chart',needPreview,wrap(async(req,res)=>{const m=await needMember(req);await q('UPDATE luce_members SET birth_profile=NULL,birth_chart=NULL WHERE id=$1',[m.id]);res.json({success:true});}));
  app.get('/api/membership/reading',needPreview,wrap(async(req,res)=>{await tick();const m=await reconcile(await needMember(req));if(!access(m))throw fail('Your membership does not currently include content access.',403);if(!/^\d{4}-\d{2}$/.test(String(req.query.month||'')))throw fail('Choose a published month.');const month=await one('SELECT month,published_title AS title,published AS content,published_demo AS demo FROM luce_horoscopes WHERE month=$1 AND published IS NOT NULL AND collection_hidden=false',[req.query.month]);if(!month||month.demo&&!m.is_test)throw fail('No published horoscope is available for this month.',404);res.json({month:month.month,title:month.title,demo:month.demo,groups:chart.matchingReading(m.birth_chart,month)});}));
  app.post('/api/membership/portal',needPreview,wrap(async(req,res)=>{const m=await needMember(req),stripe=clientFor(m),portal=portalFor(m);if(!m.verified_at)throw fail('Confirm your email first.',403);if(!stripe||!m.stripe_customer_id||!portal)throw fail('Billing management is not available for this account.',409);const config=await stripe.billingPortal.configurations.retrieve(portal);if(config.livemode===m.is_test||config.active===false||!config.features?.subscription_cancel?.enabled||config.features.subscription_cancel.mode!=='at_period_end'||config.features?.subscription_update?.enabled)throw fail('Membership billing settings need attention.',409);const result=await stripe.billingPortal.sessions.create({customer:m.stripe_customer_id,configuration:config.id,return_url:origin+'/members/account'});res.json({url:result.url});}));
  app.post('/api/membership/stripe/webhook',wrap(async(req,res)=>{if(!stripe||!env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET)throw fail('Sandbox webhook is not configured.',503);let event;try{event=stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET);}catch(_){throw fail('Invalid webhook signature.',400);}if(event.livemode!==false)throw fail('Live membership events are disabled.',403);if(await one('SELECT id FROM luce_member_events WHERE id=$1',[event.id]))return res.json({received:true});const obj=event.data.object;let sub;if(event.type==='checkout.session.completed'&&obj.mode==='subscription'&&obj.subscription)sub=await stripe.subscriptions.retrieve(typeof obj.subscription==='string'?obj.subscription:obj.subscription.id);if(event.type.startsWith('customer.subscription.'))sub=event.type==='customer.subscription.deleted'?obj:await stripe.subscriptions.retrieve(obj.id);if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required'].includes(event.type)){const id=obj.subscription||obj.parent?.subscription_details?.subscription;if(id)sub=await stripe.subscriptions.retrieve(typeof id==='string'?id:id.id);}if(sub)await syncSubscription(sub);await q('INSERT INTO luce_member_events(id,event_type) VALUES($1,$2) ON CONFLICT DO NOTHING',[event.id,event.type]);res.json({received:true});}));
  const admin=(method,url,fn)=>app[method]('/api/admin/membership'+url,checkAdmin,wrap(fn));
  admin('get','/status',async(req,res)=>res.json({private:!liveEnabled(),purchasingEnabled:!!liveEnabled(),testCheckoutEnabled:testCheckoutEnabled(),existingStripeConfigured:!!stripeClient,sandboxConfigured:!!sandboxKey,missingTestSettings:['MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET','MEMBERSHIP_PORTAL_TEST_CONFIGURATION',...Object.values(plans).map(p=>p.key)].filter(k=>!env[k]),portalConfigured:!!env.MEMBERSHIP_PORTAL_TEST_CONFIGURATION,testEmail}));
  admin('get','/members',async(req,res)=>res.json((await q('SELECT * FROM luce_members ORDER BY created_at DESC')).rows.map(m=>({...publicMember(m),created_at:m.created_at}))));
  admin('post','/members/:id/preview',async(req,res)=>{const allowed=['preview','past_due','expired','canceled'];if(!allowed.includes(req.body.status))throw fail('Choose a preview state.');const m=await one('SELECT * FROM luce_members WHERE id=$1',[req.params.id]);if(!m?.is_test||m.stripe_subscription_id)throw fail('Only unbilled preview accounts can be simulated.',409);await q('UPDATE luce_members SET status=$1,access_until=$2 WHERE id=$3',[req.body.status,req.body.status==='preview'?later(7*86400000):now(),m.id]);res.json({success:true});});
  admin('get','/horoscopes',async(req,res)=>{await tick();res.json((await q('SELECT * FROM luce_horoscopes ORDER BY demo,published_at DESC NULLS LAST,updated_at DESC,month DESC')).rows);});
  admin('put','/horoscopes/:month',async(req,res)=>{const month=req.params.month;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw fail('Choose a valid month.');const title=String(req.body.title||'').trim().slice(0,180);if(!title)throw fail('Enter a title.');const draft={};for(const sign of signs){if(typeof req.body.content?.[sign]!=='string'||req.body.content[sign].length>20000)throw fail('Each sign needs text of up to 20,000 characters.');draft[sign]=req.body.content[sign];}const old=await one('SELECT revision,draft FROM luce_horoscopes WHERE month=$1',[month]);for(const [key,value] of Object.entries(old?.draft||{})){if(!(key in draft))draft[key]=value;}const general=req.body.content?.General;if(general!==undefined&&(typeof general!=='string'||general.length>20000))throw fail('The general reading must be text of up to 20,000 characters.');draft.General=general===undefined?(old?.draft?.General||''):general;let saved;if(old){saved=await one('UPDATE luce_horoscopes SET title=$1,draft=$2,demo=$3,scheduled_at=NULL,scheduled_draft=NULL,scheduled_title=NULL,scheduled_demo=NULL,revision=revision+1,updated_at=$4 WHERE month=$5 AND revision=$6 RETURNING *',[title,JSON.stringify(draft),!!req.body.demo,now(),month,req.body.revision]);}else{saved=await one('INSERT INTO luce_horoscopes(month,title,draft,demo) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',[month,title,JSON.stringify(draft),!!req.body.demo]);}if(!saved)throw fail('This month changed. Reload before saving.',409);res.json(saved);});
  // Collection metadata is independent of reading snapshots and the stable internal key.
  admin('patch','/horoscopes/:month/details',async(req,res)=>{
   const row=await one('SELECT * FROM luce_horoscopes WHERE month=$1',[req.params.month]);
   if(!row)throw fail('Collection not found.',404);
   if(row.revision!==req.body.revision)throw fail('This collection changed. Reload before saving.',409);
   const title=typeof req.body.title==='string'?req.body.title.trim():'';
   const month=req.body.display_month,subtitle=req.body.subtitle??'';
   if(!title||title.length>180)throw fail('Enter a display title of up to 180 characters.');
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw fail('Choose a valid month and year.');
   if(typeof subtitle!=='string'||subtitle.length>500)throw fail('Use a subtitle of up to 500 characters.');
   if(typeof req.body.featured!=='boolean')throw fail('Choose whether to feature this collection.');
   const kind=req.body.collection_type??row.collection_type;
   if(!['monthly','special'].includes(kind))throw fail('Choose Monthly Horoscopes or Special Astrology Guidance.');
   const featured=req.body.featured&&kind==='monthly';
   const status=req.body.status;if(!['draft','published','scheduled'].includes(status))throw fail('Choose Draft, Published, or Scheduled.');
   let scheduledAt=null,publishedAt=row.published_at;
   if(status==='scheduled'){
    scheduledAt=scheduleInstant(req.body.localTime,req.body.occurrence);
    if(scheduledAt<=now())throw fail('Choose a future Pacific time, or choose Published.');
    const content=row.scheduled_draft||row.draft;
    if(signs.some(sign=>!content[sign]?.trim()))throw fail('Complete all 12 signs before scheduling.');
   }else if(status==='published'){
    if(!row.published&&signs.some(sign=>!row.draft[sign]?.trim()))throw fail('Complete all 12 signs before publishing.');
    publishedAt=req.body.localTime?scheduleInstant(req.body.localTime,req.body.occurrence):(row.published_at||now());
    if(publishedAt>now())throw fail('Choose Scheduled for a future publication time.');
   }
   const result=await tx(async c=>{
   // Serialize feature selection so two admins cannot leave competing featured flags.
   await c.query("LOCK TABLE luce_horoscopes IN SHARE ROW EXCLUSIVE MODE");
   const saved=(await c.query(`UPDATE luce_horoscopes SET title=$1,published_title=CASE WHEN published IS NOT NULL OR $4='published' THEN $1 ELSE published_title END,
    display_month=$2,subtitle=$3,collection_type=$11,collection_hidden=CASE WHEN $4='draft' THEN true WHEN $4='published' THEN false ELSE collection_hidden END,
    featured_at=CASE WHEN $5 THEN $6::timestamptz ELSE NULL END,
    published=CASE WHEN $4='published' THEN COALESCE(published,draft) ELSE published END,
    published_demo=CASE WHEN $4='published' AND published IS NULL THEN demo ELSE published_demo END,
    published_at=$7,scheduled_at=$8,
    scheduled_draft=CASE WHEN $4='scheduled' THEN COALESCE(scheduled_draft,draft) ELSE scheduled_draft END,
    scheduled_title=CASE WHEN $4='scheduled' THEN $1 ELSE scheduled_title END,
    scheduled_demo=CASE WHEN $4='scheduled' THEN COALESCE(scheduled_demo,demo) ELSE scheduled_demo END,
    revision=revision+1,updated_at=$6 WHERE month=$9 AND revision=$10 RETURNING *`,
    [title,month,subtitle,status,featured,now(),publishedAt,scheduledAt,row.month,row.revision,kind])).rows[0];
   if(!saved)throw fail('This collection changed. Reload before saving.',409);
   if(featured)await c.query('UPDATE luce_horoscopes SET featured_at=NULL,revision=revision+1 WHERE month<>$1 AND featured_at IS NOT NULL',[row.month]);
   return saved;
   });
   if(!result)throw fail('This collection changed. Reload before saving.',409);
   res.json(result);
  });
  admin('post','/horoscopes/:month/schedule',async(req,res)=>{
   const at=scheduleInstant(req.body.localTime,req.body.occurrence);if(at<=now())throw fail('Choose a future Pacific date and time, or use Publish now.');
   const row=await one('SELECT * FROM luce_horoscopes WHERE month=$1',[req.params.month]);const missing=signs.filter(s=>!row?.draft?.[s]?.trim());if(!row||missing.length)throw fail('Complete all 12 signs before scheduling. Missing: '+missing.join(', '));
   const result=await one('UPDATE luce_horoscopes SET scheduled_at=$1,scheduled_draft=draft,scheduled_title=title,scheduled_demo=demo,revision=revision+1,updated_at=$2 WHERE month=$3 AND revision=$4 RETURNING *',[at,now(),req.params.month,req.body.revision]);
   if(!result)throw fail('This month changed. Reload before scheduling.',409);res.json(result);
  });
  admin('post','/horoscopes/:month/cancel-schedule',async(req,res)=>{
   const result=await one('UPDATE luce_horoscopes SET scheduled_at=NULL,scheduled_draft=NULL,scheduled_title=NULL,scheduled_demo=NULL,revision=revision+1,updated_at=$1 WHERE month=$2 AND revision=$3 AND scheduled_at IS NOT NULL RETURNING *',[now(),req.params.month,req.body.revision]);
   if(!result)throw fail('This schedule changed or has already published. Refresh its status.',409);res.json(result);
  });
  admin('post','/horoscopes/:month/publish',async(req,res)=>{const row=await one('SELECT * FROM luce_horoscopes WHERE month=$1',[req.params.month]);if(!row||signs.some(s=>!row.draft[s]?.trim()))throw fail('Add content for all 12 signs before publishing.');const result=await one('UPDATE luce_horoscopes SET collection_hidden=false,published=draft,published_title=title,published_demo=demo,published_at=$1,scheduled_at=NULL,scheduled_draft=NULL,scheduled_title=NULL,scheduled_demo=NULL,revision=revision+1 WHERE month=$2 AND revision=$3 RETURNING *',[now(),req.params.month,req.body.revision]);if(!result)throw fail('This month changed. Reload before publishing.',409);res.json(result);});
  admin('post','/horoscopes/:month/unpublish',async(req,res)=>{const result=await one('UPDATE luce_horoscopes SET collection_hidden=true,scheduled_at=NULL,scheduled_draft=NULL,scheduled_title=NULL,scheduled_demo=NULL,revision=revision+1 WHERE month=$1 AND revision=$2 RETURNING *',[req.params.month,req.body.revision]);if(!result)throw fail('This month changed. Reload first.',409);res.json(result);});
 }
 return {initialize,register,handleLiveEvent,access,syncSubscription,signs,tick,start,stop};
}
module.exports={createMembership,signs,scheduleInstant};

