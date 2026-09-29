const crypto=require('crypto'),path=require('path');
const chart=require('./chart');
const {contextFor,validate}=require('./personal-reading');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const validId=s=>/^[a-f0-9-]{36}$/.test(s||'');
const label=m=>new Date(m+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const amount=1295,lease=10*60*1000;
function createPurchasedReadings({q,tx,now,provider,stripe,liveEnabled,needMember,session,limit,wrap,tick,origin}){
 const one=async(s,p)=>(await q(s,p)).rows[0];
 let stopped=false;
 async function initialize(){await q(`CREATE TABLE IF NOT EXISTS luce_purchased_readings(
 id TEXT PRIMARY KEY, purchaser_id INTEGER NOT NULL REFERENCES luce_members(id), fingerprint TEXT NOT NULL,
 recipient TEXT NOT NULL, month TEXT NOT NULL, birth_profile JSONB NOT NULL, birth_chart JSONB NOT NULL, context JSONB NOT NULL,
 amount INTEGER NOT NULL DEFAULT 1295, currency TEXT NOT NULL DEFAULT 'usd',
 checkout_id TEXT UNIQUE, checkout_version INTEGER NOT NULL DEFAULT 0, payment_id TEXT, paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL,
 state TEXT NOT NULL DEFAULT 'unpaid' CHECK(state IN ('unpaid','queued','generating','failed','complete')),
 claim TEXT, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, reading JSONB, last_error TEXT,
 UNIQUE(purchaser_id,fingerprint))`);
 await q(`CREATE TABLE IF NOT EXISTS luce_reading_shares(token_hash TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES luce_purchased_readings(id),created_at TIMESTAMPTZ NOT NULL)`);
 await q('ALTER TABLE luce_purchased_readings ADD COLUMN IF NOT EXISTS checkout_version INTEGER NOT NULL DEFAULT 0');}
 const enabled=()=>liveEnabled()&&provider.enabled()&&!!stripe;
 async function sources(){await tick();return (await q(`SELECT * FROM luce_horoscopes WHERE published IS NOT NULL AND published_at<=$1
 AND published_demo=false AND collection_hidden=false ORDER BY featured_at DESC NULLS LAST,published_at DESC,month DESC`,[now()])).rows;}
 const monthOf=r=>r.display_month||r.month;
 const monthly=r=>r.collection_type==='monthly'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(monthOf(r));
 async function catalog(){const rows=await sources();return {price:amount,currency:'usd',enabled:!!enabled(),months:[...new Set(rows.filter(r=>monthly(r)&&r.published.General?.trim()&&chart.signs.every(s=>r.published[s]?.trim())).map(monthOf))].map(month=>({month,label:label(month)}))};}
 async function owned(m,id){if(!validId(id))throw fail('Reading not found.',404);const r=await one('SELECT * FROM luce_purchased_readings WHERE id=$1 AND purchaser_id=$2',[id,m.id]);if(!r)throw fail('Reading not found.',404);return r;}
 // Explicit allowlist: never expose account IDs, payment IDs, source content, city coordinates, or provider metadata.
 function view(r,shared=false){const p=r.birth_profile;return {...(!shared?{id:r.id,state:r.state,paid:!!r.paid_at,purchasedAt:r.paid_at,error:r.last_error}:{}),recipient:r.recipient,month:r.month,label:label(r.month),
 ...(!shared?{birth:{date:p.date,time:p.time||null,place:p.place?.label||null,timezone:p.place?.zone||null}}:{}),
 placements:r.birth_chart.placements.map(p=>({placement:p.placement,sign:p.reliable?p.sign:null,reliable:p.reliable})),
 text:r.state==='complete'?r.reading.text:null,completedAt:r.completed_at};}
 async function create(m,b){
  if(!enabled())throw fail('Personalized reading purchases are temporarily unavailable.',503);
  if(m.is_test)throw fail('Use a normal Luce account to purchase a reading.',403);
  if(!m.verified_at)throw fail('Confirm your email before continuing to payment.',403);
  await limit('purchase-create:'+m.id,30);
  const recipient=String(b.recipient||'').trim();if(!recipient||recipient.length>120)throw fail('Enter the recipient’s name (up to 120 characters).');
  const calculated=chart.calculate(b.birth||{}),rows=await sources(),month=String(b.month||'');
  const selected=rows.find(r=>monthly(r)&&monthOf(r)===month);if(!selected)throw fail('Choose an available published month.');
  const context=contextFor(calculated,selected,rows.filter(r=>r.collection_type==='special'&&monthOf(r)===month));
  const fingerprint=hash(JSON.stringify({month,recipient:recipient.toLowerCase(),profile:calculated.profile}));
  const r=await one(`INSERT INTO luce_purchased_readings(id,purchaser_id,fingerprint,recipient,month,birth_profile,birth_chart,context,created_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(purchaser_id,fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING *`,
 [crypto.randomUUID(),m.id,fingerprint,recipient,month,JSON.stringify(calculated.profile),JSON.stringify(calculated),JSON.stringify(context),now()]);
  return view(r);
 }
 async function checkout(m,id){
  if(!enabled())throw fail('Payment is temporarily unavailable. Please try again later.',503);
  if(!m.verified_at||m.is_test)throw fail('Confirm your Luce account before payment.',403);
  await limit('purchase-checkout:'+m.id,40);
  // A row lock plus Stripe idempotency covers simultaneous taps, lost responses, and retries.
  return tx(async c=>{
   const r=(await c.query('SELECT * FROM luce_purchased_readings WHERE id=$1 AND purchaser_id=$2 FOR UPDATE',[id,m.id])).rows[0];
   if(!r)throw fail('Reading not found.',404);if(r.paid_at)return {paid:true,id:r.id};
   let checkoutVersion=r.checkout_version||0;
   if(r.checkout_id){const old=await stripe.checkout.sessions.retrieve(r.checkout_id);if(old.status==='complete')return {confirm:true,id:r.id};if(old.status==='open')return {url:old.url};if(old.status!=='expired')throw fail('Please check your payment status before trying again.',409);checkoutVersion++;}
   const s=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],customer_email:m.email,
    client_reference_id:r.id,metadata:{luce_product:'personalized_monthly',purchase_id:r.id},
    line_items:[{price_data:{currency:'usd',unit_amount:amount,product_data:{name:'Luce Healing Personalized Monthly Reading',description:label(r.month)+' · One-time purchase'}},quantity:1}],
    success_url:origin+'/my-purchased-readings?reading='+r.id,cancel_url:origin+'/my-purchased-readings?reading='+r.id},
    {idempotencyKey:'luce-personalized:'+r.id+':'+checkoutVersion});
   if(!s.id||!s.url||s.livemode!==true)throw fail('Payment configuration needs attention.',503);
   await c.query('UPDATE luce_purchased_readings SET checkout_id=$1,checkout_version=$3 WHERE id=$2',[s.id,r.id,checkoutVersion]);return {url:s.url};
  });
 }
 async function recordPayment(s){
  if(s.metadata?.luce_product!=='personalized_monthly')return false;
  const r=await one('SELECT * FROM luce_purchased_readings WHERE id=$1',[s.metadata.purchase_id]);
  if(!r)throw fail('Purchase is not yet available. Retry payment notification.',409);
  if(s.livemode!==true||s.mode!=='payment'||s.client_reference_id!==r.id||s.amount_total!==r.amount||s.currency!==r.currency)throw fail('Payment does not match this purchase.',409);
  if(s.payment_status!=='paid'||s.status!=='complete')return true;
  if(r.checkout_id&&r.checkout_id!==s.id)throw fail('Checkout does not match this purchase.',409);
  await q(`UPDATE luce_purchased_readings SET checkout_id=$1,payment_id=$2,paid_at=$3,state='queued',last_error=NULL WHERE id=$4 AND paid_at IS NULL`,[s.id,typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id||null,now(),r.id]);
  kick(r.id);return true;
 }
 async function handleEvent(event){if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return false;return recordPayment(event.data.object);}
 async function confirm(m,id){const r=await owned(m,id);if(!r.paid_at&&r.checkout_id)await recordPayment(await stripe.checkout.sessions.retrieve(r.checkout_id));const fresh=await owned(m,id);if(fresh.state==='queued')kick(id);return view(fresh);}
 async function generate(id){
  const claim=crypto.randomUUID();const r=await one(`UPDATE luce_purchased_readings SET state='generating',claim=$1,started_at=$2,last_error=NULL WHERE id=$3 AND paid_at IS NOT NULL
 AND (state='queued' OR (state='generating' AND started_at<$4)) RETURNING *`,[claim,now(),id,new Date(+now()-lease)]);if(!r)return;
  try{
   await limit('purchase-retry:'+r.id,3,15*60*1000);await limit('personal-global',100,86400000);
   const result=await provider.generate(JSON.parse(JSON.stringify(r.context))),text=validate(result,r.context);
   await q(`UPDATE luce_purchased_readings SET state='complete',reading=$1,completed_at=$2,claim=NULL,last_error=NULL WHERE id=$3 AND claim=$4`,[JSON.stringify({...result,text}),now(),id,claim]);
  }catch(e){const message=e.status===429?'The reading service is busy. Please retry in 15 minutes. Your payment is saved.':'We couldn’t finish your reading this time. Your payment is saved. Please retry; you won’t be charged again.';
   await q("UPDATE luce_purchased_readings SET state='failed',claim=NULL,last_error=$1 WHERE id=$2 AND claim=$3",[message,id,claim]);}
 }
 const running=new Set();
 function kick(id){if(stopped||running.has(id)||running.size>=3)return;running.add(id);generate(id).catch(e=>console.error('[Purchased reading worker]',e.code||e.name)).finally(()=>running.delete(id));}
 async function resume(){if(stopped)return;const rows=(await q("SELECT id FROM luce_purchased_readings WHERE paid_at IS NOT NULL AND (state='queued' OR (state='generating' AND started_at<$1)) ORDER BY paid_at LIMIT 3",[new Date(+now()-lease)])).rows;rows.forEach(r=>kick(r.id));}
 async function retry(m,id){const r=await owned(m,id);if(!r.paid_at)throw fail('Complete payment first.',402);if(r.state==='complete')return view(r);await q("UPDATE luce_purchased_readings SET state='queued',last_error=NULL WHERE id=$1 AND state='failed'",[id]);kick(id);return view(await owned(m,id));}
 function register(app){
  app.use(['/api/purchased-readings','/my-purchased-readings','/shared-reading'],(req,res,next)=>{
   res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
   if(['POST','DELETE','PUT','PATCH'].includes(req.method)&&(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==origin)))return res.status(403).json({error:'Please use the Luce Healing site.'});next();
  });
  app.get(['/personalized-monthly-reading','/my-purchased-readings','/shared-reading/:token'],(req,res)=>res.sendFile(path.join(__dirname,'purchased.html')));
  app.get('/reading-assets/purchased.js',(req,res)=>res.type('js').sendFile(path.join(__dirname,'purchased.js')));
  app.get('/reading-assets/purchased.css',(req,res)=>res.type('css').sendFile(path.join(__dirname,'purchased.css')));
  app.get('/api/purchased-readings/catalog',wrap(async(req,res)=>res.json(await catalog())));
  app.get('/api/purchased-readings/account',wrap(async(req,res)=>{const m=await session(req);res.json(m?{name:m.name,verified:!!m.verified_at,member:!!(m.stripe_subscription_id||m.complimentary_until&&new Date(m.complimentary_until)>now())}:null);}));
  app.get('/api/purchased-readings/shared/:token',wrap(async(req,res)=>{
   if(!/^[a-f0-9]{64}$/.test(req.params.token))throw fail('This shared reading is unavailable.',404);
   const r=await one("SELECT r.* FROM luce_purchased_readings r JOIN luce_reading_shares s ON s.purchase_id=r.id WHERE s.token_hash=$1 AND r.state='complete'",[hash(req.params.token)]);if(!r)throw fail('This shared reading is unavailable.',404);res.json(view(r,true));
  }));
  app.get('/api/purchased-readings',wrap(async(req,res)=>{const m=await needMember(req);res.json((await q('SELECT * FROM luce_purchased_readings WHERE purchaser_id=$1 ORDER BY created_at DESC',[m.id])).rows.map(r=>view(r)));}));
  app.post('/api/purchased-readings',wrap(async(req,res)=>res.json(await create(await needMember(req),req.body))));
  app.get('/api/purchased-readings/:id',wrap(async(req,res)=>res.json(view(await owned(await needMember(req),req.params.id)))));
  app.post('/api/purchased-readings/:id/checkout',wrap(async(req,res)=>res.json(await checkout(await needMember(req),req.params.id))));
  app.post('/api/purchased-readings/:id/confirm',wrap(async(req,res)=>res.json(await confirm(await needMember(req),req.params.id))));
  app.post('/api/purchased-readings/:id/retry',wrap(async(req,res)=>res.json(await retry(await needMember(req),req.params.id))));
  app.post('/api/purchased-readings/:id/share',wrap(async(req,res)=>{const m=await needMember(req),r=await owned(m,req.params.id);if(r.state!=='complete')throw fail('Your finished reading will be shareable once it is ready.',409);await limit('purchase-share:'+m.id,60);const token=crypto.randomBytes(32).toString('hex');await q('INSERT INTO luce_reading_shares(token_hash,purchase_id,created_at) VALUES($1,$2,$3)',[hash(token),r.id,now()]);res.json({url:origin+'/shared-reading/'+token});}));
  app.delete('/api/purchased-readings/:id/share',wrap(async(req,res)=>{const r=await owned(await needMember(req),req.params.id);await q('DELETE FROM luce_reading_shares WHERE purchase_id=$1',[r.id]);res.json({success:true});}));
 }
 return {initialize,register,handleEvent,resume,stop:()=>{stopped=true;},recordPayment};
}
module.exports={createPurchasedReadings};
