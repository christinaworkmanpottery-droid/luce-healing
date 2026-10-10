const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),{PGlite}=require('@electric-sql/pglite');
const {createCustomerLibrary}=require('../customer-library');
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE luce_members(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO luce_members VALUES(1,'buyer@example.com'),(2,'other@example.com'),(3,'buyer@example.com');
 CREATE TABLE astrology_reading_orders(id SERIAL PRIMARY KEY,email TEXT,client_name TEXT,price INTEGER,created_at TIMESTAMPTZ DEFAULT NOW(),stripe_payment_status TEXT);
 CREATE TABLE forecast_orders(id SERIAL PRIMARY KEY,email TEXT,client_name TEXT,price INTEGER,forecast_type TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),stripe_payment_status TEXT);
 CREATE TABLE bookings(id SERIAL PRIMARY KEY,email TEXT,client_name TEXT,amount_paid INTEGER,session_type TEXT,date TEXT,time TEXT,status TEXT,cancelled INTEGER,session_format TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),stripe_payment_status TEXT);`);
 const users={1:{id:1,email:'buyer@example.com',verified_at:new Date(),is_test:false,status:'expired'},2:{id:2,email:'other@example.com',verified_at:new Date(),is_test:false,status:'active'},3:{id:3,email:'buyer@example.com',verified_at:null,is_test:false}};
 const mail={sent:[],fail:false};
 const service=createCustomerLibrary({pool:db,getMailer:()=>({sendMail:async message=>{if(mail.fail)throw Error('SMTP failure');mail.sent.push(message);return {accepted:[message.to]};}}),session:async req=>users[req.get('x-test-user')]||null});await service.initialize();
 await db.exec(`INSERT INTO astrology_reading_orders(email,client_name,price,stripe_payment_status) VALUES(' Buyer@Example.com ','Buyer',3300,'paid'),('buyer@example.com','Pending',3300,'pending');
 INSERT INTO forecast_orders(email,client_name,price,forecast_type,stripe_payment_status,luce_customer_id) VALUES('recipient@example.com','Gift recipient',7500,'6month','paid',1),('buyer@example.com','Other buyer owns this',15000,'12month','paid',2);
 INSERT INTO bookings(email,client_name,amount_paid,session_type,date,time,status,stripe_payment_status) VALUES('buyer@example.com','Buyer',10000,'reiki','2026-10-01','10:00 AM','confirmed','paid'),('buyer@example.com','Buyer',12000,'chart-written',NULL,NULL,'awaiting-reading','paid');`);
 const app=express();app.use(express.json({limit:'12mb'}));service.register(app,(req,res,next)=>req.get('x-test-admin')==='yes'?next():res.sendStatus(401));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const call=async(path='',method='GET',body,user=1,admin=false)=>{
  const r=await fetch(base+(path.startsWith('/api/')?path:'/api/customer-library'+path),{method,headers:{'Content-Type':'application/json','x-test-user':String(user),...(admin?{'x-test-admin':'yes'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const pdf=r.headers.get('content-type')?.includes('application/pdf');let data;if(pdf)data=Buffer.from(await r.arrayBuffer());else{const text=await r.text();try{data=JSON.parse(text);}catch{data=text;}}return {status:r.status,data,headers:r.headers};
 };
 return {db,users,call,mail,close:async()=>{await new Promise(r=>server.close(r));await db.close();}};
}
test('verified nonmembers and expired members see all paid purchases; recipient email cannot override ownership',async()=>{
 const h=await setup();try{
  const list=await h.call();assert.equal(list.status,200);assert.equal(list.data.length,4);assert.ok(list.data.some(x=>x.kind==='question'));assert.ok(list.data.some(x=>x.kind==='forecast'&&x.recipient==='Gift recipient'));assert.ok(list.data.some(x=>x.kind==='booking'&&!x.isReading));
  assert.equal((await h.call('/question/2')).status,404);assert.equal((await h.call('/forecast/2')).status,404);
  assert.equal((await h.call('/question/1','GET',null,2)).status,404);assert.equal((await h.call('/forecast/1','GET',null,2)).status,404);
  assert.equal((await h.call('','GET',null,3)).status,403);assert.equal((await h.call('','GET',null,0)).status,401);
  h.users[1].status='unpaid';assert.equal((await h.call()).data.length,4);
 }finally{await h.close();}
});
test('admin saves text/PDF to the correct purchase; data survives edits and cannot leak to other buyers',async()=>{
 const h=await setup();try{
  const url='/api/admin/customer-readings/question/1',pdf=Buffer.from('%PDF-1.4\n test fixture\n%%EOF');
  assert.equal((await h.call(url,'PUT',{text:'Private reading',revision:0},1)).status,401);
  const saved=await h.call(url,'PUT',{text:'Private reading <script>literal text</script>',revision:0,pdfBase64:pdf.toString('base64'),pdfName:'Reading.pdf'},1,true);assert.equal(saved.status,200);
  let result=await h.call('/question/1');assert.equal(result.data.ready,true);assert.equal(result.data.hasPdf,true);assert.match(result.data.text,/Private reading/);
  assert.equal(result.headers.get('cache-control'),'private, no-store');
  const download=await h.call('/question/1/pdf');assert.deepEqual(download.data,pdf);assert.equal(download.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await h.call('/question/1/pdf','GET',null,2)).status,404);
  assert.equal((await h.call(url,'PUT',{text:'Edited reading',revision:1},1,true)).status,200);
  assert.equal((await h.call('/question/1')).data.hasPdf,true);
  assert.equal((await h.call(url,'PUT',{text:'Stale edit',revision:1},1,true)).status,409);
  assert.equal((await h.call('/question/1')).data.text,'Edited reading');
  assert.equal((await h.call(url,'PUT',{text:'Edited reading',revision:2,removePdf:true},1,true)).status,200);
  assert.equal((await h.call('/question/1/pdf')).status,404);
  assert.equal((await h.call(url,'PUT',{text:'',revision:3,removePdf:true},1,true)).status,400);
  assert.equal((await h.call(url,'PUT',{text:'text',revision:3,pdfBase64:Buffer.from('not PDF').toString('base64')},1,true)).status,400);
 }finally{await h.close();}
});
test('customer library UI safely opens written readings without requiring membership',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');
 const dom=new JSDOM(fs.readFileSync('private-membership/purchased.html','utf8'),{url:'https://lucehealing.com/my-purchased-readings?order=question:1',runScripts:'outside-only'}),w=dom.window;
 const requests=[];w.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>url.endsWith('/account')?{name:'Buyer',verified:true,member:false}:{kind:'question',id:1,title:'Ask One Question',recipient:'Buyer <script>unsafe</script>',purchasedAt:'2026-09-29',ready:true,isReading:true,text:'A saved reading <script>literal</script>',hasPdf:true}}};
 w.eval(fs.readFileSync('private-membership/purchased.js','utf8'));await new Promise(r=>setTimeout(r,30));
 assert.match(w.document.querySelector('.reading').textContent,/A saved reading/);assert.equal(w.document.querySelector('article script'),null);assert.ok(w.document.querySelector('a[href="/api/customer-library/question/1/pdf"]'));assert.ok(!requests.some(x=>x.includes('/checkout')));w.close();
});
test('purchase library combines personalized purchases and older readings; account prompt requires no membership',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');
 const html=fs.readFileSync('private-membership/purchased.html','utf8'),script=fs.readFileSync('private-membership/purchased.js','utf8');
 const dom=new JSDOM(html,{url:'https://lucehealing.com/my-purchased-readings',runScripts:'outside-only'}),w=dom.window;
 w.fetch=async url=>({ok:true,json:async()=>url.endsWith('/account')?{name:'Buyer',verified:true,member:false}:url==='/api/customer-library'?[{kind:'forecast',id:1,title:'6-Month Forecast',recipient:'Other person',purchasedAt:'2026-09-29',ready:true,isReading:true}]:[{id:'test-id',recipient:'Buyer',label:'October',paid:true,purchasedAt:'2026-09-29',state:'complete'}]});
 w.eval(script);await new Promise(r=>setTimeout(r,30));assert.ok(w.document.querySelector('a[href="/my-purchased-readings?order=forecast:1"]'));assert.ok(w.document.querySelector('a[href="/my-purchased-readings?reading=test-id"]'));assert.match(w.document.getElementById('app').textContent,/regardless of membership status/);w.close();
 const guest=new JSDOM(html,{url:'https://lucehealing.com/my-purchased-readings',runScripts:'outside-only'});guest.window.fetch=async()=>({ok:true,json:async()=>null});guest.window.eval(script);await new Promise(r=>setTimeout(r,20));assert.match(guest.window.document.getElementById('app').textContent,/Use the email you used at checkout/);assert.match(guest.window.document.getElementById('app').textContent,/Create a free account/);guest.window.close();
});
test('admin editor preserves edits after a failed save and confirms successful account delivery',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');const dom=new JSDOM('<body></body>',{url:'https://lucehealing.com',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
 let failSave=true,posted;
 w.fetch=async(_url,init)=>{if(init.method==='GET')return {ok:true,json:async()=>({title:'Ask One Question',recipient:'Buyer',text:'Original reading',revision:2,pdfName:'Existing.pdf'})};posted=JSON.parse(init.body);return {ok:!failSave,json:async()=>failSave?{error:'Try again'}:{success:true,revision:3,message:'Saved to the customer’s purchase. No email was sent.'}};};
 w.eval(fs.readFileSync('admin-customer-readings.js','utf8'));await w.openCustomerReadingEditor('question',1);const text=w.document.getElementById('customer-reading-text');text.value='Revised reading';const form=w.document.querySelector('form');form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));assert.equal(text.value,'Revised reading');assert.match(w.document.getElementById('customer-reading-status').textContent,/edits are still here/);failSave=false;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,20));assert.equal(posted.revision,2);assert.equal(posted.pdfBase64,undefined);assert.match(w.document.getElementById('customer-reading-status').textContent,/Saved to/);w.close();
});

test('notification goes to purchaser once per saved version and can retry without losing reading',async()=>{
 const h=await setup();try{
  const url='/api/admin/customer-readings/forecast/1';
  await h.call(url,'PUT',{text:'Private gift reading',revision:0},1,true);
  assert.equal((await h.call(url+'/notify','POST',{revision:1},1,false)).status,401);
  h.mail.fail=true;
  assert.equal((await h.call(url+'/notify','POST',{revision:1},1,true)).status,503);
  assert.equal((await h.call('/forecast/1')).data.text,'Private gift reading');
  h.mail.fail=false;
  assert.equal((await h.call(url+'/notify','POST',{revision:1},1,true)).status,200);
  assert.equal(h.mail.sent.length,1);assert.equal(h.mail.sent[0].to,'buyer@example.com');
  assert.match(h.mail.sent[0].text,/order=forecast:1/);assert.ok(!h.mail.sent[0].text.includes('Private gift reading'));
  assert.equal((await h.call(url+'/notify','POST',{revision:1},1,true)).status,200);
  assert.equal(h.mail.sent.length,1);
  assert.equal((await h.call(url,'GET',null,1,true)).data.notifiedRevision,1);
  await h.call(url,'PUT',{text:'Updated',revision:1},1,true);
  assert.equal((await h.call(url+'/notify','POST',{revision:1},1,true)).status,409);
  const results=await Promise.all([h.call(url+'/notify','POST',{revision:2},1,true),h.call(url+'/notify','POST',{revision:2},1,true)]);
  assert.ok(results.some(r=>r.status===200));assert.equal(h.mail.sent.length,2);
 }finally{await h.close();}
});
test('Save & Notify saves once and retry notification does not resave',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');const dom=new JSDOM('<body></body>',{url:'https://lucehealing.com',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
 let puts=0,notifications=0;
 w.fetch=async(url,init)=>{
  if(init.method==='GET')return {ok:true,json:async()=>({title:'Reading',recipient:'Buyer',text:'',revision:0,notificationEmail:'buyer@example.com',notifiedRevision:0})};
  if(init.method==='PUT'){puts++;return {ok:true,json:async()=>({revision:1,message:'Saved'})};}
  notifications++;return {ok:notifications>1,json:async()=>notifications===1?{error:'Reading saved, retry notification'}:{message:'Notification sent'}};
 };
 w.eval(fs.readFileSync('admin-customer-readings.js','utf8'));await w.openCustomerReadingEditor('question',1);
 w.document.getElementById('customer-reading-text').value='Finished reading';
 w.document.querySelector('form').dispatchEvent(new w.SubmitEvent('submit',{cancelable:true,submitter:w.document.querySelector('button[value=notify]')}));
 await new Promise(r=>setTimeout(r,20));assert.equal(puts,1);assert.equal(notifications,1);assert.equal(w.document.getElementById('customer-reading-notify').hidden,false);
 w.document.getElementById('customer-reading-notify').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(puts,1);assert.equal(notifications,2);assert.match(w.document.getElementById('customer-reading-status').textContent,/Notification sent/);w.close();
});

test('complimentary question is fulfillable with zero amount while pending remains blocked',async()=>{
 const h=await setup();try{
 await h.db.query("UPDATE astrology_reading_orders SET stripe_payment_status='complimentary' WHERE id=2");
 const item=await h.call('/question/2');assert.equal(item.status,200);assert.equal(item.data.amount,0);
 const edit=await h.call('/api/admin/customer-readings/question/2','PUT',{text:'Complimentary reading',revision:0},1,true);assert.equal(edit.status,200);
 assert.equal((await h.call('/question/2','GET',null,2)).status,404);
 }finally{await h.close();}
});
