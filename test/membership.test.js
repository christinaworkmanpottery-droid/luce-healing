const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {PGlite}=require('@electric-sql/pglite');const Stripe=require('stripe');
const {createMembership,signs}=require('../private-membership/service');
async function harness(overrides={}){const db=new PGlite(),sent=[];let date=new Date('2026-09-20T20:00:00Z'),sub;
const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
const real=new Stripe('sk_test_fake');const stripe={webhooks:real.webhooks,subscriptions:{retrieve:async()=>sub},billingPortal:{configurations:{retrieve:async()=>({id:'bpc_test',livemode:false,features:{subscription_cancel:{enabled:true,mode:'at_period_end'},subscription_update:{enabled:false}}})},sessions:{create:async x=>{assert.equal(x.customer,'cus_test');return {url:'https://billing.stripe.com/p/session/test'};}}}};
const env={...overrides,NODE_ENV:'test',MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET:'whsec_private_test',MEMBERSHIP_PORTAL_TEST_CONFIGURATION:'bpc_test'};
const service=createMembership({pool,env,stripeClient:stripe,clock:()=>date,getMailer:()=>({sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}})});await service.initialize();const app=express();app.use('/api/membership/stripe/webhook',express.raw({type:'application/json'}));app.use(express.json());service.register(app,(req,res,next)=>req.query.password==='admin-test'||req.body?.password==='admin-test'?next():res.status(401).json({error:'Unauthorized'}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let cookies={};
const call=async(p,method='GET',body,opts={})=>{const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',Cookie:Object.entries(opts.cookies??cookies).map(([k,v])=>k+'='+v).join('; '),...opts.headers},body:body?JSON.stringify(body):undefined});for(const c of r.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');cookies[k]=v;}const text=await r.text();let data;try{data=JSON.parse(text);}catch(_){data=text;}return {status:r.status,data,headers:r.headers};};
const admin=(p,m='GET',b)=>call('/api/admin/membership/'+p+'?password=admin-test',m,b);
const open=()=>call('/api/membership/review-login','POST',{password:'admin-test'});
const signup=()=>call('/api/membership/signup','POST',{name:'Christina',email:'info@christinaworkman.com',member_password:'Private-test-password-123'});
const secret=()=>sent.at(-1).text.match(/token=([a-f0-9]{64})/)[1];
const verify=async()=>{await open();await signup();return call('/api/membership/verify','POST',{token:secret()});};
const webhook=async(type,id='evt_'+Math.random())=>{const event={id,type,livemode:false,data:{object:type.startsWith('invoice.')?{subscription:'sub_test'}:sub}};const raw=JSON.stringify(event);return call('/api/membership/stripe/webhook','POST',event,{headers:{'stripe-signature':real.webhooks.generateTestHeaderString({payload:raw,secret:env.MEMBERSHIP_STRIPE_TEST_WEBHOOK_SECRET})}});};
return {stripe,db,sent,call,admin,open,signup,secret,verify,webhook,service,env,cookies,setSub:x=>sub=x,advance:ms=>date=new Date(+date+ms),close:async()=>{await new Promise(r=>server.close(r));await db.close();}};}

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

test('Chicago lookup auto-selects and Save details & calculate persists a chart; ambiguous and empty searches clear selection',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');const h=await harness();let dom;
 try{await h.verify();dom=new JSDOM(fs.readFileSync('private-membership/member.html','utf8'),{url:'https://lucehealing.com/members/chart',runScripts:'outside-only'});
 dom.window.fetch=async(url,opts={})=>{const r=await h.call(url,opts.method||'GET',opts.body?JSON.parse(opts.body):undefined);return {ok:r.status<400,status:r.status,json:async()=>r.data};};
 dom.window.eval(fs.readFileSync('private-membership/member.js','utf8'));const d=dom.window.document;
 for(let i=0;i<100&&!d.getElementById('birth-form');i++)await new Promise(r=>setTimeout(r,10));
 const el=id=>d.getElementById(id);el('unknown-time').checked=false;el('unknown-time').onchange();el('unknown-place').checked=false;el('unknown-place').onchange();el('birth-date').value='1977-09-02';el('birth-time').value='09:28';
 const search=async q=>{el('place-search').value=q;el('place-search').oninput();await el('place-find').onclick();};
 await search('Chicago, Illinois, USA');assert.equal(el('place-results').value,'4887398');assert.match(el('selected-place').textContent,/Chicago, Illinois, United States/);
 await el('birth-form').onsubmit();assert.match(el('feedback').textContent,/saved and placements calculated/);assert.equal(el('placements').querySelectorAll('article').length,7);assert.match(el('placements').textContent,/Rising in Libra/);
 const saved=await h.call('/api/membership/chart');assert.equal(saved.data.profile.place.id,'4887398');assert.equal(saved.data.chart.placements.length,7);
 for(const q of ['Chicago, Illinois, US','Chicago, Illinois, United States','Chicago']){await search(q);assert.equal(el('place-results').value,'4887398');}
 await search('Springfield, USA');assert.equal(el('place-results').value,'');assert(el('place-results').options.length>2);el('place-results').value='4250542';el('place-results').onchange();assert.match(el('selected-place').textContent,/Springfield, Illinois, United States/);
 await search('zzzznonexistentcity');assert.equal(el('place-results').value,'');assert.equal(el('selected-place').textContent,'');await el('birth-form').onsubmit();assert.match(el('feedback').textContent,/Choose your birthplace/);
 assert.equal((await h.call('/api/membership/chart','GET',null,{cookies:{}})).status,404);assert.equal((await h.call('/api/membership/checkout','POST',{})).status,403);
 }finally{dom?.window.close();await h.close();}
});


test('private test checkout: exact prices, duplicate prevention, founding renewal, cancellation and regular-price rejoin',async()=>{
 const h=await harness({STRIPE_SECRET_KEY:'sk_test_fake',MEMBERSHIP_TEST_CHECKOUT_ENABLED:'true',MEMBERSHIP_FOUNDING_OFFER_OPEN:'true',MEMBERSHIP_TEST_PRICE_FOUNDING:'price_f',MEMBERSHIP_TEST_PRICE_MONTHLY:'price_m',MEMBERSHIP_TEST_PRICE_ANNUAL:'price_a'});
 const requests=[];let currentSession,priceLive=false;
 h.stripe.prices={retrieve:async id=>({id,livemode:priceLive,active:true,currency:'usd',unit_amount:{price_f:295,price_m:395,price_a:3792}[id],billing_scheme:'per_unit',recurring:{interval:id==='price_a'?'year':'month',interval_count:1,usage_type:'licensed'}})};
 h.stripe.checkout={sessions:{create:async(params,options)=>{requests.push({params,options});currentSession={id:'cs_'+requests.length,url:'https://checkout.stripe.com/test',status:'open',livemode:false};return currentSession;},retrieve:async()=>currentSession,expire:async()=>{currentSession.status='expired';}}};
 try{
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,401);
  await h.verify();const id=(await h.call('/api/membership/me')).data.id;
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'founding'})).status,400);
  priceLive=true;assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,409);assert.equal(requests.length,0);priceLive=false;
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly',amount:1})).status,200);
  assert.equal(requests[0].params.line_items[0].price,'price_f');
  await h.call('/api/membership/checkout','POST',{plan:'monthly'});assert.equal(requests.length,1);
  let sub={id:'sub_first',customer:'cus_test',livemode:false,status:'active',metadata:requests[0].params.subscription_data.metadata,current_period_start:1790000000,current_period_end:1792000000,items:{data:[{quantity:1,price:{id:'price_f'}}]}};h.setSub(sub);
  await h.webhook('customer.subscription.created');let me=(await h.call('/api/membership/me')).data;assert(me.access);assert.equal(me.tier,'founding');
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'annual'})).status,409);
  h.env.MEMBERSHIP_FOUNDING_OFFER_OPEN='false';await h.webhook('invoice.paid');assert.equal((await h.call('/api/membership/me')).data.tier,'founding');
  sub={...sub,cancel_at_period_end:true};h.setSub(sub);await h.webhook('customer.subscription.updated');assert((await h.call('/api/membership/me')).data.access);
  assert.equal((await h.call('/api/membership/portal','POST',{})).status,200);
  h.advance(40*86400000);assert.equal((await h.call('/api/membership/login','POST',{email:'info@christinaworkman.com',member_password:'Private-test-password-123'})).status,404);await h.open();await h.call('/api/membership/login','POST',{email:'info@christinaworkman.com',member_password:'Private-test-password-123'});
  assert(!(await h.call('/api/membership/me')).data.access);
  sub={...sub,status:'canceled'};h.setSub(sub);await h.webhook('customer.subscription.deleted');
  assert.equal((await h.call('/api/membership/checkout','POST',{plan:'monthly'})).status,200);assert.equal(requests.at(-1).params.line_items[0].price,'price_m');assert.notEqual(requests[0].options.idempotencyKey,requests.at(-1).options.idempotencyKey);
  const old=sub;sub={...sub,id:'sub_second',status:'active',cancel_at_period_end:false,metadata:requests.at(-1).params.subscription_data.metadata,items:{data:[{quantity:1,price:{id:'price_m'}}]}};h.setSub(sub);await h.webhook('customer.subscription.created');
  await h.service.syncSubscription(old);assert.equal((await h.db.query('SELECT stripe_subscription_id FROM luce_members WHERE id=$1',[id])).rows[0].stripe_subscription_id,'sub_second');
  sub={...sub,status:'canceled'};h.setSub(sub);await h.webhook('customer.subscription.deleted');await h.call('/api/membership/checkout','POST',{plan:'annual'});assert.equal(requests.at(-1).params.line_items[0].price,'price_a');
 }finally{await h.close();}
});
