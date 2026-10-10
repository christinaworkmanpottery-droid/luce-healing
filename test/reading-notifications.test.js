const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createReadingNotifications}=require('../reading-notifications');
async function harness(){
 const db=new PGlite();await db.exec(`CREATE TABLE astrology_reading_orders(id SERIAL PRIMARY KEY,luce_customer_id INTEGER,client_name TEXT,email TEXT,birth_date TEXT,birth_time TEXT,birth_location TEXT,question TEXT,price INTEGER DEFAULT 3300,stripe_session_id TEXT,stripe_payment_status TEXT DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT NOW());`);
 await db.exec(`CREATE TABLE promo_codes(id SERIAL PRIMARY KEY,code TEXT UNIQUE,discount_percent INTEGER,active INTEGER DEFAULT 1,times_used INTEGER DEFAULT 0,max_uses INTEGER,expires_at TIMESTAMPTZ);`);
 const sent=[],logs=[];let failure=null,configured=true;
 const pool={query:(...args)=>db.query(...args)};
 const transporter={sendMail:async mail=>{if(failure)throw Object.assign(Error('PRIVATE SMTP PASSWORD CUSTOMER DATA'),{code:failure});sent.push(mail);return {accepted:[mail.to]};}};
 const deps={pool,getTransporter:()=>configured?transporter:null,logger:{info:(...x)=>logs.push(x),error:(...x)=>logs.push(x)}};
 const service=createReadingNotifications(deps);await service.initialize();
 const add=async(id='cs_one')=>(await db.query(`INSERT INTO astrology_reading_orders(client_name,email,birth_date,birth_location,question,stripe_session_id) VALUES('Test Customer','customer@example.com','1990-01-02','Test City','What should I focus on?', $1) RETURNING *`,[id])).rows[0];
 const jobs=async()=>(await db.query('SELECT * FROM reading_notifications ORDER BY id')).rows;
 const session=(status='paid',amount=3300,id='cs_one')=>({id,status:'complete',payment_status:status,currency:'usd',amount_total:amount,metadata:{type:'astrology_reading'}});
 return {db,pool,deps,service,sent,logs,add,jobs,session,fail:v=>failure=v,configured:v=>configured=v,close:()=>db.close()};
}
test('pending and abandoned submissions notify admin only and remain unfulfilled',async()=>{const h=await harness();try{
 const row=await h.add();assert.equal((await h.jobs()).length,1);await h.service.deliver();assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'lucehealing13@gmail.com');assert.match(h.sent[0].subject,/Order Received/);assert.match(h.sent[0].text,/Payment is NOT confirmed/);for(const value of [row.client_name,row.email,row.question,row.birth_date,row.birth_location,'$33.00','pending','Order #1'])assert(h.sent[0].text.includes(value));
 await h.service.handleSession({...h.session('unpaid'),status:'expired'});await h.service.deliver();assert.equal(h.sent.length,1);assert.equal((await h.db.query('SELECT stripe_payment_status FROM astrology_reading_orders')).rows[0].stripe_payment_status,'expired');
 assert.equal((await h.db.query("SELECT COALESCE(SUM(COALESCE(amount_paid,price)),0)::int AS revenue FROM astrology_reading_orders WHERE stripe_payment_status='paid'")).rows[0].revenue,0);
}finally{await h.close();}});
test('paid order, duplicate webhook and concurrent worker calls send each notification once',async()=>{const h=await harness();try{
 await h.add();await h.service.handleSession(h.session());await h.service.handleSession(h.session());await Promise.all([h.service.deliver(),h.service.deliver()]);assert.equal(h.sent.length,3);assert.equal(new Set(h.sent.map(x=>x.messageId)).size,3);assert.equal(h.sent.filter(x=>x.to==='customer@example.com').length,1);assert(h.sent.some(x=>x.subject.startsWith('Payment Confirmed')));assert.equal((await h.jobs()).filter(x=>x.status==='sent').length,3);
 await h.service.handleSession({...h.session('unpaid'),status:'expired'});assert.equal((await h.db.query('SELECT stripe_payment_status,amount_paid FROM astrology_reading_orders')).rows[0].amount_paid,3300);
}finally{await h.close();}});
test('verified zero-total checkout is complimentary with zero revenue and customer confirmation',async()=>{const h=await harness();try{
 await h.add();await h.service.handleSession(h.session('no_payment_required',0));await h.service.deliver();const row=(await h.db.query('SELECT * FROM astrology_reading_orders')).rows[0];assert.equal(row.stripe_payment_status,'complimentary');assert.equal(row.amount_paid,0);assert.match(row.complimentary_evidence,/Stripe completed zero-total/);assert(h.sent.some(x=>x.subject.startsWith('Complimentary Reading Confirmed')));assert(h.sent.some(x=>x.to==='customer@example.com'&&x.text.includes('complimentary reading is confirmed')));
 assert.equal((await h.db.query("SELECT COALESCE(SUM(COALESCE(amount_paid,price)),0)::int AS revenue FROM astrology_reading_orders WHERE stripe_payment_status='paid'")).rows[0].revenue,0);
}finally{await h.close();}});
test('discounted paid order records actual amount; unverified free and unpaid sessions never confirm',async()=>{const h=await harness();try{
 await h.add();for(const s of [h.session('unpaid',0),h.session('no_payment_required',3300),{...h.session(),status:'open'},{...h.session(),currency:'eur'}])await h.service.handleSession(s);
 assert.equal((await h.jobs()).length,1);await h.service.handleSession(h.session('paid',1650));assert.equal((await h.db.query('SELECT amount_paid FROM astrology_reading_orders')).rows[0].amount_paid,1650);
}finally{await h.close();}});
test('SMTP failure persists, safe logs, delayed retry and service restart recover without re-sending',async()=>{const h=await harness();try{
 await h.add();h.fail('ETIMEDOUT');await h.service.deliver();let job=(await h.jobs())[0];assert.equal(job.status,'retry');assert.equal(job.last_error,'ETIMEDOUT');assert(!JSON.stringify(h.logs).includes('PRIVATE'));assert(!JSON.stringify(h.logs).includes('customer@example.com'));
 h.fail(null);await h.service.deliver();assert.equal(h.sent.length,0);await h.db.query("UPDATE reading_notifications SET next_attempt_at=NOW()-INTERVAL '1 second'");const restart=createReadingNotifications(h.deps);await restart.initialize();await restart.deliver();assert.equal(h.sent.length,1);await restart.deliver();assert.equal(h.sent.length,1);assert.equal((await h.jobs())[0].attempts,2);
}finally{await h.close();}});
test('missing SMTP and rejected recipients remain visible and retryable; stale lease is recovered',async()=>{const h=await harness();try{
 await h.add();h.configured(false);await h.service.deliver();assert.equal((await h.jobs())[0].last_error,'SMTP_UNAVAILABLE');h.configured(true);
 await h.db.query("UPDATE reading_notifications SET status='sending',lease_until=NOW()-INTERVAL '1 minute'");await h.service.deliver();assert.equal((await h.jobs())[0].status,'sent');
 await h.add('cs_two');const rejected=createReadingNotifications({...h.deps,getTransporter:()=>({sendMail:async()=>({accepted:[]})})});await rejected.deliver();assert.equal((await h.jobs())[1].last_error,'SMTP_REJECTED');
}finally{await h.close();}});
test('migration recovers missed pending orders without duplicating historical paid confirmations',async()=>{const h=await harness();try{
 await h.db.exec('DROP TRIGGER reading_notification_outbox ON astrology_reading_orders');await h.add();await h.add('cs_old_paid');await h.db.query("UPDATE astrology_reading_orders SET stripe_payment_status='paid' WHERE stripe_session_id='cs_old_paid'");await h.service.initialize();await h.service.initialize();assert.equal((await h.jobs()).length,1);await h.service.deliver();assert.equal(h.sent.length,1);
}finally{await h.close();}});
test('Stripe reconciliation uses retrieved checkout evidence; missing order asks Stripe to retry',async()=>{const h=await harness();try{
 await assert.rejects(h.service.handleSession(h.session()),/not yet available/);await h.add();const service=createReadingNotifications({...h.deps,stripe:{checkout:{sessions:{retrieve:async id=>({...h.session('unpaid',3300,id),status:'expired'})}}}});await service.reconcile();await service.deliver();assert.equal((await h.db.query('SELECT stripe_payment_status FROM astrology_reading_orders')).rows[0].stripe_payment_status,'expired');assert.equal(h.sent.length,1);assert.match(h.sent[0].text,/expired/);
}finally{await h.close();}});

test('local complimentary promotion is atomic, needs no Stripe payment, enforces limits and preserves listed price',async()=>{const h=await harness();try{
 await h.db.exec("INSERT INTO promo_codes(code,discount_percent,max_uses) VALUES('FAMILY',100,1),('HALF',50,2),('EXPIRED',100,2); UPDATE promo_codes SET expires_at=NOW()-INTERVAL '1 day' WHERE code='EXPIRED'");
 const data={name:'Customer',email:'customer@example.com',birthDate:'1990-01-01',birthLocation:'City',question:'My full question',purchaserId:null};
 const outcomes=await Promise.allSettled([h.service.submitOrder({...data,promoCode:'family'}),h.service.submitOrder({...data,promoCode:'FAMILY'})]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);const order=outcomes.find(x=>x.status==='fulfilled').value;assert.equal(order.stripe_payment_status,'complimentary');assert.equal(order.price,3300);assert.equal(order.amount_paid,0);assert.equal(order.stripe_session_id,null);assert.match(order.complimentary_evidence,/Authorized promotion/);assert.equal((await h.jobs()).length,3);
 await h.service.deliver();assert.equal(h.sent.length,3);assert.equal((await h.db.query("SELECT times_used FROM promo_codes WHERE code='FAMILY'")).rows[0].times_used,1);
 for(const code of ['EXPIRED','UNKNOWN'])await assert.rejects(h.service.submitOrder({...data,promoCode:code}),/invalid, expired/);
 const half=await h.service.submitOrder({...data,promoCode:'HALF'});assert.equal(half.checkout_amount,1650);assert.equal(half.stripe_payment_status,'pending');
 const normal=await h.service.submitOrder(data);assert.equal(normal.checkout_amount,3300);assert.equal(normal.stripe_payment_status,'pending');
}finally{await h.close();}});

test('real Stripe signature verification rejects forged events and handles verified retries without duplicate mail',async()=>{const h=await harness();try{
 const fs=require('node:fs'),vm=require('node:vm'),Stripe=require('stripe'),stripe=new Stripe('sk_test_fixture');
 const source=fs.readFileSync(require.resolve('../server'),'utf8');const start=source.indexOf("app.post('/api/stripe/webhook'");const end=source.indexOf('// ADMIN ENDPOINTS',start);let route;
 const secret='whsec_isolated_fixture';vm.runInNewContext(source.slice(start,end),{app:{post:(p,fn)=>route=fn},stripe,process:{env:{STRIPE_WEBHOOK_SECRET:secret}},console:{error(){}},membershipService:{handleLiveEvent:async()=>false},readingNotifications:h.service});
 await h.add();const body=JSON.stringify({id:'evt_test',type:'checkout.session.completed',data:{object:h.session()}});
 const invoke=async signature=>{const res={code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}};await route({body:Buffer.from(body),headers:{'stripe-signature':signature}},res);return res;};
 assert.equal((await invoke('forged')).code,400);assert.equal((await h.jobs()).length,1);
 const sig=stripe.webhooks.generateTestHeaderString({payload:body,secret});assert.equal((await invoke(sig)).code,200);assert.equal((await invoke(sig)).code,200);await h.service.deliver();assert.equal(h.sent.length,3);
}finally{await h.close();}});

test('actual checkout route records pending request on Stripe failure and confirms validated free order without Stripe',async()=>{const h=await harness();try{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../server'),'utf8');let route,calls=0;
 const start=source.indexOf("app.post('/api/astrology-reading/checkout'");const end=source.indexOf('// Admin: get astrology reading orders',start);
 const stripe={checkout:{sessions:{create:async()=>{calls++;throw Error('offline');}}}};
 vm.runInNewContext(source.slice(start,end),{app:{post:(p,fn)=>route=fn},stripe,process:{env:{}},console:{error(){}},purchaseAccountId:async()=>null,readingNotifications:h.service,dbRun:(...a)=>h.db.query(...a)});
 const body={name:'Customer',email:'customer@example.com',birthDate:'1990-01-01',birthLocation:'City',question:'My full question'};
 const invoke=async more=>{const res={code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}};await route({body:{...body,...more}},res);return res;};
 assert.equal((await invoke({})).code,500);assert.equal((await h.jobs()).length,1);await h.service.deliver();assert.equal(h.sent.length,1);assert.match(h.sent[0].text,/NOT confirmed/);
 await h.db.exec("INSERT INTO promo_codes(code,discount_percent,max_uses) VALUES('FREE',100,1)");const free=await invoke({promoCode:'FREE'});assert.equal(free.code,200);assert.equal(free.data.complimentary,true);assert.equal(calls,1);
 assert.equal((await invoke({promoCode:'BAD'})).code,400);assert.equal((await invoke({name:{}})).code,400);
}finally{await h.close();}});

test('admin displays failed notification state and free fulfillment controls without HTML injection',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');const dom=new JSDOM('<div id="reading-orders-list"></div>',{runScripts:'outside-only'}),w=dom.window;
 const source=fs.readFileSync(require.resolve('../business-functions'),'utf8');const start=source.indexOf('async function businessGet('),end=source.indexOf('async function loadClientSummary',start);
 w.adminPassword='fixture';w.fetch=async url=>({ok:true,json:async()=>url.includes('astrology-reading-orders')?[{id:7,client_name:'<script>unsafe</script>',stripe_payment_status:'complimentary',price:3300,amount_paid:0,notifications:{received:{status:'retry',attempts:2,last_error:'ETIMEDOUT'}}}]:[]});
 w.eval(source.slice(start,end));await w.loadReadingOrders();const content=w.document.body.textContent;assert.match(content,/FAILED — automatic retry scheduled/);assert.match(content,/amount paid: \$0.00/);assert.match(content,/Save \/ edit customer reading/);assert.equal(w.document.querySelectorAll('script').length,0);dom.window.close();
});
test('success page never confirms pending or abandoned checkout and labels Stripe free checkout honestly',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs'),html=fs.readFileSync(require.resolve('../reading-success.html'),'utf8');
 for(const [payment,status,amount,expected] of [['unpaid','open',3300,'Payment Not Confirmed'],['unpaid','expired',3300,'Payment Not Confirmed'],['paid','complete',3300,'Your Question is Confirmed!'],['no_payment_required','complete',0,'Complimentary Reading Confirmed']]){
 const dom=new JSDOM(html,{url:'https://lucehealing.com/reading-success.html?session_id=cs_fixture',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async()=>({json:async()=>({metadata:{type:'astrology_reading',question:'Question'},payment_status:payment,status,amount_total:amount,currency:'usd',customer_email:'test@example.com'})});w.eval(w.document.querySelector('script').textContent);await new Promise(r=>setImmediate(r));assert.equal(w.document.querySelector('h1').textContent,expected);if(payment==='unpaid')assert.equal(w.document.querySelector('.next-steps').style.display,'none');dom.window.close();
 }
});
