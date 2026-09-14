const crypto = require('crypto');
const catalog = {
 question:{name:'One-question email reading',price:3300},
 '6month':{name:'6-month written forecast',price:7500},
 '12month':{name:'12-month written forecast',price:15000},
 'chart-written':{name:'Written birth-chart reading',price:7500},
 'chart-30min':{name:'Written reading + 30-minute consultation',price:12500,consultation:30},
 'chart-60min':{name:'Written reading + 60-minute consultation',price:17500,consultation:60}
};
module.exports = function({app,pool,stripe,checkAdminPassword,getMailer,domain}) {
 const query=(sql,args=[])=>pool.query(sql,args);
 const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('Gift request failed:',e.message);res.status(500).json({error:'Unable to process this gift right now. Please try again.'});}};
 const emailValid=s=>typeof s==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<255;
 const clean=s=>String(s||'').trim();
 async function initialize(){await query(`CREATE TABLE IF NOT EXISTS reading_gifts (
 id SERIAL PRIMARY KEY, product TEXT NOT NULL, price INTEGER NOT NULL, buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '', token TEXT NOT NULL UNIQUE, stripe_session_id TEXT UNIQUE,
 payment_status TEXT NOT NULL DEFAULT 'pending', redeemed_at TIMESTAMP, recipient JSONB,
 created_at TIMESTAMP NOT NULL DEFAULT NOW())`);await query('ALTER TABLE reading_gifts ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMP');}
 async function paid(session){
  if(session.payment_status!=='paid'||session.currency!=='usd')return null;
  const rows=(await query("UPDATE reading_gifts SET payment_status='paid' WHERE stripe_session_id=$1 AND price=$2 RETURNING *",[session.id,session.amount_total])).rows;
  return rows[0]||null;
 }
 async function handleWebhook(session){
  if(session.metadata?.type!=='reading_gift')return false;
  const before=(await query('SELECT receipt_sent_at FROM reading_gifts WHERE stripe_session_id=$1',[session.id])).rows[0];
  const gift=await paid(session);
  if(gift&&!before?.receipt_sent_at){
   const mailer=getMailer();
   if(mailer)try{await mailer.sendMail({from:'"Luce Healing" <lucehealing13@gmail.com>',to:gift.buyer_email,subject:'Your Luce Healing gift is ready',text:`Thank you, ${gift.buyer_name}. Your ${catalog[gift.product].name} gift is paid. Share this private link with your recipient so they can supply their own details:\n\n${domain}/gift?token=${gift.token}\n\nKeep this link private; it can be redeemed once.\n\nChristina\nLuce Healing`});await query('UPDATE reading_gifts SET receipt_sent_at=NOW() WHERE id=$1',[gift.id]);}catch(e){console.error('Gift receipt delivery failed:',e.message);}
  }
  return true;
 }
 app.get('/gift',(req,res)=>res.sendFile(require('path').join(__dirname,'gift.html')));
 app.post('/api/gifts/checkout',route(async(req,res)=>{
  if(!stripe)return res.status(503).json({error:'Payments are temporarily unavailable.'});
  const b=req.body,p=catalog[b.product];
  if(!p||!clean(b.buyer_name)||clean(b.buyer_name).length>120||!emailValid(b.buyer_email)||clean(b.message).length>500)return res.status(400).json({error:'Choose a reading and enter your name and valid email address.'});
  const gift=(await query('INSERT INTO reading_gifts(product,price,buyer_name,buyer_email,message,token) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[b.product,p.price,clean(b.buyer_name),clean(b.buyer_email),clean(b.message),crypto.randomBytes(32).toString('hex')])).rows[0];
  const session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],customer_email:clean(b.buyer_email),line_items:[{price_data:{currency:'usd',unit_amount:p.price,product_data:{name:'Gift: '+p.name}},quantity:1}],metadata:{type:'reading_gift',gift_id:String(gift.id)},success_url:domain+'/gift?session_id={CHECKOUT_SESSION_ID}',cancel_url:domain+'/gift'});
  await query('UPDATE reading_gifts SET stripe_session_id=$1 WHERE id=$2',[session.id,gift.id]);
  res.json({url:session.url});
 }));
 app.get('/api/gifts/purchase',route(async(req,res)=>{
  const id=String(req.query.session_id||'');if(!/^cs_[a-zA-Z0-9_]+$/.test(id))return res.status(400).json({error:'Invalid purchase link.'});
  const session=await stripe.checkout.sessions.retrieve(id);
  if(session.metadata?.type!=='reading_gift')return res.status(404).json({error:'Gift not found.'});
  const gift=await paid(session);
  if(!gift)return res.status(409).json({error:'Payment is not yet confirmed. Refresh this page shortly.'});
  res.set('Cache-Control','no-store').json({product:gift.product,token:gift.token});
 }));
 app.get('/api/gifts/redeem',route(async(req,res)=>{
  const gift=(await query("SELECT product,message,redeemed_at FROM reading_gifts WHERE token=$1 AND payment_status='paid'",[String(req.query.token||'')])).rows[0];
  if(!gift)return res.status(404).json({error:'This gift link is unavailable or payment is not complete.'});
  if(gift.redeemed_at)return res.status(409).json({error:'This gift has already been redeemed.'});
  res.set('Cache-Control','no-store').json({product:gift.product,message:gift.message});
 }));
 app.post('/api/gifts/redeem',route(async(req,res)=>{
  const b=req.body,gift=(await query("SELECT id,product FROM reading_gifts WHERE token=$1 AND payment_status='paid' AND redeemed_at IS NULL",[String(b.token||'')])).rows[0];
  if(!gift)return res.status(409).json({error:'This gift is unavailable or has already been redeemed.'});
  const p=catalog[gift.product];
  if(!clean(b.name)||!emailValid(b.email)||!/^\d{4}-\d{2}-\d{2}$/.test(b.birth_date||'')||!Number.isFinite(Date.parse(b.birth_date))||b.birth_date>new Date().toISOString().slice(0,10)||!clean(b.birth_location)||(gift.product==='question'?clean(b.question).length<10:!/^\d{2}:\d{2}$/.test(b.birth_time||'')))return res.status(400).json({error:'Please complete your name, email, valid birth details and required reading fields.'});
  if(p.consultation&&(!['phone','zoom'].includes(b.consultation_format)||!clean(b.timezone)||!clean(b.availability)||(b.consultation_format==='phone'&&!clean(b.phone))))return res.status(400).json({error:'Please complete your consultation preferences.'});
  const recipient={};for(const k of ['name','email','birth_date','birth_time','birth_location','question','consultation_format','phone','timezone','availability'])recipient[k]=clean(b[k]).slice(0,500);
  const result=await query("UPDATE reading_gifts SET redeemed_at=NOW(),recipient=$1 WHERE id=$2 AND redeemed_at IS NULL RETURNING id",[JSON.stringify(recipient),gift.id]);
  if(!result.rows.length)return res.status(409).json({error:'This gift has already been redeemed.'});
  const mailer=getMailer();if(mailer)try{await mailer.sendMail({from:'"Luce Healing" <lucehealing13@gmail.com>',to:'lucehealing13@gmail.com',subject:'Gift redeemed: '+p.name,text:'A paid gift has been redeemed. The complete reading details are saved in Business dashboard → Reading Orders.\n\n'+Object.entries(recipient).map(([k,v])=>k+': '+v).join('\n')});}catch(e){console.error('Gift notification failed:',e.message);}
  res.json({success:true});
 }));
 app.get('/api/admin/gifts',checkAdminPassword,route(async(req,res)=>res.json((await query('SELECT id,product,price,buyer_name,buyer_email,message,payment_status,redeemed_at,recipient,created_at FROM reading_gifts ORDER BY created_at DESC')).rows)));
 return {initialize,handleWebhook};
};
module.exports.catalog=catalog;
