const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),crypto=require('crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createMembership}=require('../private-membership/service');
const {signs}=require('../private-membership/chart');
const source='Make room to review your commitments and consider which relationships support a balanced life. Give yourself time to reflect before making a choice.';
const generated=()=>({paragraphs:Array.from({length:5},(_,i)=>({text:`Reflection ${i+1}. Your priorities can become clearer when you pause and ask what feels sustainable for you. You can use this month as an invitation to listen closely to your needs, notice where you feel supported, and give your decisions enough space to develop. Consider a small adjustment in how you approach a commitment, allowing your relationships and your own wellbeing to inform the next step.`,evidence:[{source_id:'s1'}]})),provider:'fake'});
async function harness(){
 const db=new PGlite();let calls=0,checkouts=0,hook=null,time=new Date('2026-09-29T05:00:00Z');const sessions=new Map(),contexts=[];
 const stripe={checkout:{sessions:{create:async(body,options)=>{checkouts++;assert.equal(body.mode,'payment');assert.equal(body.line_items[0].price_data.unit_amount,1295);assert.ok(options.idempotencyKey);const s={id:'cs_'+checkouts,url:'https://checkout.stripe.com/test-'+checkouts,livemode:true,status:'open',payment_status:'unpaid',mode:'payment',amount_total:1295,currency:'usd',client_reference_id:body.client_reference_id,metadata:body.metadata};sessions.set(s.id,s);return s;},retrieve:async id=>sessions.get(id)}}};
 const env={NODE_ENV:'test',STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_WEBHOOK_SECRET:'fake',MEMBERSHIP_LIVE_ENABLED:'true',MEMBERSHIP_PORTAL_LIVE_CONFIGURATION:'fake',TURNSTILE_SITE_KEY:'fake',TURNSTILE_SECRET_KEY:'fake',MEMBERSHIP_LIVE_PRICE_FOUNDING:'fake',MEMBERSHIP_LIVE_PRICE_MONTHLY:'fake',MEMBERSHIP_LIVE_PRICE_ANNUAL:'fake'};
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const service=createMembership({pool,env,clock:()=>new Date(time),stripeClient:stripe,readingProvider:{enabled:()=>true,generate:async c=>{calls++;contexts.push(c);if(hook)await hook();return generated();}}});await service.initialize();
 for(let id=1;id<=3;id++){await db.query("INSERT INTO luce_members(id,email,name,password_hash,verified_at,status,tier,is_test) VALUES($1,$2,'Account Holder','unused',$3,$4,$5,false)",[id,`owner${id}@example.com`,id===3?null:time,id===1?'active':'unpaid',id===1?'membership':'customer']);await db.query("INSERT INTO luce_member_sessions(token_hash,member_id,kind,expires_at) VALUES($1,$2,'member','2026-12-01')",[crypto.createHash('sha256').update(String(id).repeat(64)).digest('hex'),id]);}
 const content=Object.fromEntries(['General',...signs].map(s=>[s,source]));await db.query("INSERT INTO luce_horoscopes(month,title,draft,published,published_title,published_demo,published_at,display_month,collection_type) VALUES('2026-10','October','{}',$1,'October',false,'2026-09-21','2026-10','monthly')",[JSON.stringify(content)]);
 const app=express();app.use(express.json());service.register(app,(_req,res)=>res.sendStatus(401));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path='',method='GET',body,id=1,headers={})=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/purchased-readings'+path,{method,headers:{'Content-Type':'application/json',Cookie:id?'luce_member='+String(id).repeat(64):'',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers};};
 const body={recipient:'Test Recipient',month:'2026-10',birth:{date:'1980-04-10',unknownTime:true,unknownLocation:true}};
 const until=async(id,state)=>{for(let i=0;i<100;i++){const r=await call('/'+id);if(r.data.state===state)return r.data;await new Promise(r=>setTimeout(r,10));}throw Error('State did not become '+state);};
 return {call,db,service,body,until,sessions,contexts,calls:()=>calls,checkouts:()=>checkouts,setHook:h=>hook=h,advance:ms=>time=new Date(+time+ms),close:async()=>{service.stop();await new Promise(r=>server.close(r));await db.close();}};
}
test('one-time purchase: verified ownership, one checkout, payment recovery, saved results, privacy and membership isolation',async()=>{
 const h=await harness();try{
 assert.equal((await h.call('','GET',null,0)).status,401);assert.equal((await h.call('','POST',h.body,3)).status,403);
 assert.equal((await h.call('','POST',h.body,1,{Origin:'https://evil.example'})).status,403);
 const cat=await h.call('/catalog');assert.equal(cat.data.price,1295);assert.equal(cat.data.months[0].month,'2026-10');
 const created=await h.call('','POST',h.body);assert.equal(created.status,200);const id=created.data.id;
 assert.equal((await h.call('','POST',h.body)).data.id,id);assert.equal((await h.call('/'+id,'GET',null,2)).status,404);
 assert.equal((await h.call('/'+id+'/retry','POST',{})).status,402);assert.equal((await h.call('/'+id+'/share','POST',{})).status,409);
 await h.call('/'+id+'/checkout','POST',{});await h.call('/'+id+'/checkout','POST',{});assert.equal(h.checkouts(),1);assert.equal(h.calls(),0);
 const s=h.sessions.get('cs_1');s.status='complete';s.payment_status='paid';s.payment_intent='pi_test';
 await assert.rejects(h.service.handleLiveEvent({livemode:true,type:'checkout.session.completed',data:{object:{...s,amount_total:1}}}),/match/);
 await h.call('/'+id+'/confirm','POST',{});const saved=await h.until(id,'complete');assert.ok(saved.text);assert.equal(h.calls(),1);
 await h.service.handleLiveEvent({livemode:true,type:'checkout.session.completed',data:{object:s}});await h.call('/'+id+'/retry','POST',{});await h.call('/'+id+'/checkout','POST',{});assert.equal(h.calls(),1);assert.equal(h.checkouts(),1);
 assert.equal((await h.call('/'+id)).data.text,saved.text);assert.equal((await h.db.query('SELECT status FROM luce_members WHERE id=1')).rows[0].status,'active');assert.equal((await h.db.query('SELECT COUNT(*) FROM luce_personal_readings')).rows[0].count,0);
 assert.ok(!JSON.stringify(h.contexts).includes('Test Recipient'));assert.ok(!JSON.stringify(h.contexts).includes('1980-04-10'));
 const share1=(await h.call('/'+id+'/share','POST',{})).data.url,share2=(await h.call('/'+id+'/share','POST',{})).data.url;
 const token=share1.split('/').pop();const shared=await h.call('/shared/'+token,'GET',null,0);assert.equal(shared.data.text,saved.text);assert.equal(shared.data.recipient,'Test Recipient');for(const key of ['birth','id','purchaser_id','context','payment_id'])assert.equal(shared.data[key],undefined);assert.match(shared.headers.get('x-robots-tag'),/noindex/);assert.equal(shared.headers.get('cache-control'),'no-store');
 await h.call('/'+id+'/share','DELETE');assert.equal((await h.call('/shared/'+token,'GET',null,0)).status,404);assert.equal((await h.call('/shared/'+share2.split('/').pop(),'GET',null,0)).status,404);
 }finally{await h.close();}
});
test('failed generation retries same paid purchase; expired checkout and interrupted worker recover',async()=>{
 const h=await harness();try{
 const id=(await h.call('','POST',h.body,2)).data.id;
 await h.call('/'+id+'/checkout','POST',{},2);h.sessions.get('cs_1').status='expired';await h.call('/'+id+'/checkout','POST',{},2);assert.equal(h.checkouts(),2);
 h.setHook(()=>{throw Error('Provider offline');});const s=h.sessions.get('cs_2');s.status='complete';s.payment_status='paid';await h.call('/'+id+'/confirm','POST',{},2);
 const wait=async state=>{for(let i=0;i<100;i++){const r=(await h.call('/'+id,'GET',null,2)).data;if(r.state===state)return r;await new Promise(r=>setTimeout(r,10));}throw Error(state);};
 const failed=await wait('failed');assert.equal(failed.paid,true);assert.match(failed.error,/won’t be charged/);
 h.setHook(null);await Promise.all([h.call('/'+id+'/retry','POST',{},2),h.call('/'+id+'/retry','POST',{},2)]);await wait('complete');assert.equal(h.calls(),2);assert.equal(h.checkouts(),2);assert.equal((await h.db.query('SELECT status FROM luce_members WHERE id=2')).rows[0].status,'unpaid');
 const id2=(await h.call('','POST',{...h.body,recipient:'Another person'},2)).data.id;await h.db.query("UPDATE luce_purchased_readings SET paid_at=$1,state='generating',started_at='2026-09-28',claim='old' WHERE id=$2",[new Date(),id2]);h.service.start();for(let i=0;i<100;i++){if((await h.call('/'+id2,'GET',null,2)).data.state==='complete')break;await new Promise(r=>setTimeout(r,10));}assert.equal((await h.call('/'+id2,'GET',null,2)).data.state,'complete');
 }finally{await h.close();}
});
