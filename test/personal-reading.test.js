const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),crypto=require('crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createMembership}=require('../private-membership/service');
const {contextFor,createOpenAIProvider}=require('../private-membership/personal-reading');
const source='Make room to review your commitments and consider which relationships support a balanced life. Give yourself time to reflect before making a choice.';
const savedChart={method:'deterministic-test',placements:[{placement:'Sun',sign:'Aries',reliable:true},{placement:'Moon',sign:'Taurus',reliable:true},{placement:'Rising',sign:null,reliable:false}]};
const generated=()=>({paragraphs:Array.from({length:5},(_,i)=>({text:`Reflection ${i+1}. Your priorities can become clearer when you pause and ask what feels sustainable for you. You can use this month as an invitation to listen closely to your needs, notice where you feel supported, and give your decisions enough space to develop. Consider a small adjustment in how you approach a commitment, allowing your relationships and your own wellbeing to inform the next step.`,evidence:[{source_id:'s1',excerpt:source.slice(0,80)}]})),provider:'fake',model:'fake'});
async function harness(){
 const db=new PGlite(); let calls=0,hook=null,contexts=[],time=new Date('2026-09-28T03:00:00Z');
 const env={NODE_ENV:'test',STRIPE_SECRET_KEY:'sk_live_fake',STRIPE_WEBHOOK_SECRET:'fake',MEMBERSHIP_LIVE_ENABLED:'true',MEMBERSHIP_PORTAL_LIVE_CONFIGURATION:'fake',TURNSTILE_SITE_KEY:'fake',TURNSTILE_SECRET_KEY:'fake',MEMBERSHIP_LIVE_PRICE_FOUNDING:'fake',MEMBERSHIP_LIVE_PRICE_MONTHLY:'fake',MEMBERSHIP_LIVE_PRICE_ANNUAL:'fake'};
 const provider={enabled:()=>true,generate:async c=>{calls++;contexts.push(c);if(hook){const result=await hook();if(result)return result;}return generated();}};
 const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};
 const service=createMembership({pool,env,clock:()=>new Date(time),stripeClient:{},readingProvider:provider});await service.initialize();
 for(let id=1;id<=3;id++){
  await db.query("INSERT INTO luce_members(id,email,name,password_hash,verified_at,status,access_until,is_test,birth_chart) VALUES($1,$2,'Private Name','unused',NOW(),$3,'2026-12-01',false,$4)",[id,`private${id}@example.com`,id===3?'unpaid':'active',JSON.stringify(savedChart)]);
  await db.query("INSERT INTO luce_member_sessions(token_hash,member_id,kind,expires_at) VALUES($1,$2,'member','2026-12-01')",[crypto.createHash('sha256').update(String(id).repeat(64)).digest('hex'),id]);
 }
 const publish=async(id,month,type='monthly',opts={})=>db.query(`INSERT INTO luce_horoscopes(month,title,draft,display_month,collection_type,published,published_title,published_demo,published_at,featured_at,collection_hidden) VALUES($1,'Title',$2,$3,$4,$5,'Title',$6,$7,$8,$9)`,[id,JSON.stringify({General:'SECRET DRAFT'}),month,type,opts.draft?null:JSON.stringify({General:source,Aries:source,Taurus:source}),!!opts.demo,opts.future?'2026-11-01':'2026-09-21',opts.featured?'2026-09-21':null,!!opts.hidden]);
 await publish('2026-10','2026-10','monthly',{featured:true});await publish('special','2026-10','special');await publish('hidden','2026-10','special',{hidden:true});await publish('draft','2026-10','special',{draft:true});await publish('future','2026-10','special',{future:true});await publish('demo','2026-10','special',{demo:true});await publish('september','2026-09','special');await publish('2026-11','2026-11');
 const app=express();app.use(express.json());service.register(app,(_req,res)=>res.sendStatus(401));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path='',method='GET',id=1)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/membership/personal-readings'+path,{method,headers:{Cookie:id?'luce_member='+String(id).repeat(64):''}});return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')}};
 return {db,call,contexts,calls:()=>calls,setHook:h=>hook=h,advance:ms=>time=new Date(+time+ms),close:async()=>{await new Promise(r=>server.close(r));await db.close()}};
}
test('legacy daily lockout no longer blocks recovery; failed attempts have a bounded short cooldown',async()=>{
 const h=await harness();try{
  const key=crypto.createHash('sha256').update('personal-member:1').digest('hex');
  await h.db.query('INSERT INTO luce_member_limits(key,bucket,n) VALUES($1,$2,7)',[key,Math.floor(+new Date('2026-09-28T03:00:00Z')/86400000)]);
  h.setHook(()=>{throw Object.assign(Error('Provider unavailable'),{status:503})});
  for(let i=0;i<3;i++)assert.equal((await h.call('/2026-10','POST')).status,503);
  const blocked=await h.call('/2026-10','POST');assert.equal(blocked.status,429);assert.match(blocked.data.error,/15 minutes/);assert.equal(h.calls(),3);
  assert.equal((await h.db.query('SELECT state FROM luce_personal_readings WHERE member_id=1')).rows[0].state,'failed');
  h.advance(15*60*1000);h.setHook(null);
  assert.equal((await h.call('/2026-10','POST')).status,200);assert.equal(h.calls(),4);
  for(let i=0;i<5;i++)assert.equal((await h.call('/2026-10','POST')).status,200);
  assert.equal(h.calls(),4);
 }finally{await h.close()}
});
test('site-wide generation cap remains enforced with a specific message',async()=>{
 const h=await harness();try{
  const key=crypto.createHash('sha256').update('personal-global').digest('hex');
  await h.db.query('INSERT INTO luce_member_limits(key,bucket,n) VALUES($1,$2,100)',[key,Math.floor(+new Date('2026-09-28T03:00:00Z')/86400000)]);
  const blocked=await h.call('/2026-10','POST');assert.equal(blocked.status,429);assert.match(blocked.data.error,/daily capacity/);assert.equal(h.calls(),0);
 }finally{await h.close()}
});
test('published-only grounded input, account isolation, persistent cache and entitlement enforcement',async()=>{
 const h=await harness();try{
  assert.equal((await h.call('','GET',0)).status,401);assert.equal((await h.call('','GET',3)).status,403);
  const catalog=await h.call();assert.deepEqual(catalog.data.available,[{month:'2026-10',label:'October 2026'}]);assert.equal(catalog.cache,'no-store');
  const created=await h.call('/2026-10','POST');assert.equal(created.status,200);assert.ok(created.data.reading.text);assert.equal(h.calls(),1);
  const c=h.contexts[0];assert.equal(c.sources.length,6);assert.deepEqual([...new Set(c.sources.map(s=>s.collection))],['2026-10','special']);assert.ok(c.omitted.includes('Rising'));assert.ok(!JSON.stringify(c).includes('SECRET'));assert.ok(!JSON.stringify(c).includes('private1'));assert.ok(!JSON.stringify(c).includes('Private Name'));
  assert.deepEqual((await h.call('/2026-10')).data,created.data);assert.deepEqual((await h.call('/2026-10','POST')).data,created.data);assert.equal(h.calls(),1);
  assert.equal((await h.call('/2026-10','GET',2)).data.reading,null);assert.equal((await h.call('/2026-11','POST',2)).status,404);
  await h.db.query("UPDATE luce_members SET status='canceled' WHERE id=1");assert.equal((await h.call('/2026-10')).status,403);assert.equal((await h.call('/2026-10','POST')).status,403);
 }finally{await h.close()}
});
test('concurrent generation makes one call; failures release claims for retry',async()=>{
 const h=await harness();try{
  let release,entered;const ready=new Promise(r=>entered=r);h.setHook(()=>{entered();return new Promise(r=>release=r)});
  const first=h.call('/2026-10','POST');await ready;assert.equal((await h.call('/2026-10','POST')).status,409);assert.equal(h.calls(),1);release();assert.equal((await first).status,200);
  h.setHook(()=>{throw Object.assign(Error('Provider unavailable'),{status:503})});assert.equal((await h.call('/2026-10','POST',2)).status,503);
  assert.equal((await h.db.query('SELECT state FROM luce_personal_readings WHERE member_id=2')).rows[0].state,'failed');h.setHook(null);assert.equal((await h.call('/2026-10','POST',2)).status,200);
 }finally{await h.close()}
});
test('missing published General or reliable placements prevents generation',()=>{
 assert.throws(()=>contextFor(savedChart,{month:'2026-10',published:{Aries:source,Taurus:source}},[]),/General/);
 assert.throws(()=>contextFor({placements:[]},{},[]),/birth details/);
});
test('OpenAI adapter uses strict schema, no storage and rejects unsupported prose or refusal',async()=>{
 const context=contextFor(savedChart,{month:'2026-10',published:{General:source,Aries:source,Taurus:source}},[]);let requests=[];
 const fetcher=async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(requests.length%2?generated():{grounded:true,cohesive:true,accurate_placements:true,source_boundaries:true,timing_preserved:true})}}]})}};
 const provider=createOpenAIProvider({env:{OPENAI_API_KEY:'fake'},fetcher});const result=await provider.generate(context);assert.ok(result.text);assert.equal(requests.length,2);assert.equal(requests[0].store,false);assert.equal(requests[0].response_format.json_schema.strict,true);
 const refuses=createOpenAIProvider({env:{OPENAI_API_KEY:'fake'},fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{refusal:'no'}}]})})});await assert.rejects(refuses.generate(context),/could not be completed/);
});
test('published guidance is scoped separately and source/timing audit failures block a reading',async()=>{
 const context=contextFor(savedChart,{month:'2026-10',published:{General:source,Aries:source,Taurus:source}},[]);
 assert.equal(context.sources[0].publishedForMonth,'2026-10');
 assert.match(context.sources[0].interpretationScope,/Collective/);assert.match(context.sources[1].interpretationScope,/not the member/);
 for(const failed of ['grounded','accurate_placements','source_boundaries','timing_preserved']){
  let calls=0;
  const provider=createOpenAIProvider({env:{OPENAI_API_KEY:'fake'},fetcher:async(_url,options)=>{
   const body=JSON.parse(options.body);calls++;
   if(calls===1){assert.match(body.messages[0].content,/ongoing does not mean newly entering this week/);assert.match(body.messages[0].content,/Never infer a member's natal houses/);}
   const review={grounded:true,cohesive:true,accurate_placements:true,source_boundaries:true,timing_preserved:true,[failed]:false};
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls%2?generated():review)}}]})};
  }});
  await assert.rejects(provider.generate(context),/another attempt/);assert.equal(calls,6);
 }
});
test('member page generates once, displays escaped cohesive text, and reopens saved reading',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');let stored=null,posts=0;
 const dom=new JSDOM(fs.readFileSync('private-membership/member.html','utf8'),{url:'https://lucehealing.com/members/reading',runScripts:'outside-only'});
 dom.window.fetch=async(url,opts={})=>{
  let data;if(url.endsWith('/config'))data={private:false};else if(url.endsWith('/me'))data={access:true};else if(url.endsWith('/personal-readings'))data={available:[{month:'2026-10'}],saved:stored?[{month:'2026-10'}]:[],enabled:true,hasChart:true};else if(url.endsWith('/personal-readings/2026-10')){if(opts.method==='POST'){posts++;stored={month:'2026-10',label:'October 2026',text:'Your cohesive reading <script>bad()</script>',placements:[{placement:'Sun',sign:'Aries'}],omitted:['Rising']}}data={reading:stored};}else throw Error('Unexpected URL '+url);return {ok:true,json:async()=>data};
 };
 const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5))}throw Error('UI did not settle')};
 try{
  dom.window.eval(fs.readFileSync('private-membership/member.js','utf8'));await until(()=>dom.window.document.querySelector('#generate-reading'));
  await dom.window.document.querySelector('#generate-reading').onclick({preventDefault(){},target:dom.window.document.querySelector('#generate-reading')});
  assert.equal(posts,1);assert.match(dom.window.document.querySelector('#personal-result').textContent,/Your saved personal reading/);assert.equal(dom.window.document.querySelector('#personal-result script'),null);assert.match(dom.window.document.querySelector('#personal-result').textContent,/Rising/);
  dom.window.eval(fs.readFileSync('private-membership/member.js','utf8'));await until(()=>dom.window.document.querySelector('#personal-result')?.textContent.includes('Your saved personal reading'));assert.equal(posts,1);
 }finally{dom.window.close()}
});
test('contradictory draft is rejected and retried before saving; valid cache makes no additional calls',async()=>{
 const h=await harness();try{
  h.setHook(()=>{const r=generated();r.paragraphs[0].text+=' '+(h.calls()===1?'Your natal Sun in Leo.':'Your natal Sun in Aries.');return r;});
  const result=await h.call('/2026-10','POST');assert.equal(result.status,200);assert.equal(h.calls(),2);assert.match(result.data.reading.text,/natal Sun in Aries/);assert.doesNotMatch(result.data.reading.text,/Sun in Leo/);
  assert.deepEqual(h.contexts[0].lockedNatalPlacements,{Sun:'Aries',Moon:'Taurus'});
  assert.deepEqual((await h.call('/2026-10')).data,result.data);assert.deepEqual((await h.call('/2026-10','POST')).data,result.data);assert.equal(h.calls(),2);
 }finally{await h.close()}
});
test('repeated invalid generation is never displayed or marked complete',async()=>{
 const h=await harness();try{
  h.setHook(()=>{const r=generated();r.paragraphs[0].text+=' Your natal Rising in Libra.';return r;});
  assert.equal((await h.call('/2026-10','POST')).status,502);assert.equal(h.calls(),2);assert.equal((await h.call('/2026-10')).data.reading,null);
  assert.equal((await h.db.query('SELECT state FROM luce_personal_readings WHERE member_id=1')).rows[0].state,'failed');
 }finally{await h.close()}
});
test('deployment audit preserves valid legacy cache and invalidates contradictory text while retaining the record',async()=>{
 const h=await harness();try{
  await h.call('/2026-10','POST');await h.call('/2026-10','POST',2);
  await h.db.query(`UPDATE luce_personal_readings SET provenance=jsonb_set(provenance,'{version}','"luce-monthly-v1"')`);
  await h.db.query(`UPDATE luce_personal_readings SET reading=jsonb_set(reading,'{text}',to_jsonb((reading->>'text')||' Your Sun and Moon in Leo.')) WHERE member_id=1`);
  const {createPersonalReadings}=require('../private-membership/personal-reading');
  const service=createPersonalReadings({q:(...a)=>h.db.query(...a),now:()=>new Date('2026-09-28T03:00:00Z'),provider:{enabled:()=>true},limit:async()=>{}});
  await service.auditSaved();
  const rows=(await h.db.query('SELECT member_id,state,reading,provenance FROM luce_personal_readings ORDER BY member_id')).rows;
  assert.equal(rows[0].state,'failed');assert.match(rows[0].reading.text,/Sun and Moon in Leo/);assert.equal(rows[0].provenance.invalidationReason,'natal-placement-consistency');assert.equal(rows[1].state,'complete');
  assert.equal((await h.call('/2026-10')).data.reading,null);assert.ok((await h.call('/2026-10','GET',2)).data.reading);assert.equal(h.calls(),2);
  assert.equal((await h.call('/2026-10','POST')).status,200);assert.equal(h.calls(),3);
 }finally{await h.close()}
});
test('chart changes invalidate a cached reading and block a stale in-flight generation',async()=>{
 const h=await harness();try{
  await h.call('/2026-10','POST');
  await h.db.query('UPDATE luce_members SET birth_chart=NULL WHERE id=1');
  assert.equal((await h.call('/2026-10')).data.reading,null);assert.equal(h.calls(),1);
  h.setHook(async()=>{await h.db.query('UPDATE luce_members SET birth_chart=NULL WHERE id=2');});
  assert.equal((await h.call('/2026-10','POST',2)).status,409);assert.equal((await h.call('/2026-10','GET',2)).data.reading,null);
 }finally{await h.close()}
});
test('server renders natal tokens from calculated facts before validation and review',async()=>{
 const {renderNatalReferences}=require('../private-membership/personal-reading');
 const placements=[['Sun','Virgo'],['Moon','Taurus'],['Rising','Libra'],['Mercury','Virgo'],['Venus','Leo'],['Mars','Cancer'],['Jupiter','Cancer']].map(([placement,sign])=>({placement,sign,reliable:true}));
 const content=Object.fromEntries(['General','Virgo','Taurus','Libra','Leo','Cancer'].map(k=>[k,source]));
 const context=contextFor({placements},{month:'2026-10',published:content},[]);
 const draft=generated();draft.paragraphs[0].text+=' Together, {{natal:Mars}} and {{natal:Jupiter}} can inform your choices.';
 draft.paragraphs[1].text+=' Consider {{natal:Sun}}, {{natal:Moon}} and {{natal:Rising}} as distinct lenses.';
 draft.paragraphs[2].text+=' Weave {{natal:Mercury}} and {{natal:Venus}} into this reflection.';
 let calls=0;
 const provider=createOpenAIProvider({env:{OPENAI_API_KEY:'fake'},fetcher:async(_url,options)=>{
  const body=JSON.parse(options.body);calls++;
  if(calls===1)assert.match(body.messages[0].content,/exact token/);
  else{const review=JSON.parse(body.messages[1].content);assert.match(review.reading[0].text,/your natal Mars in Cancer and your natal Jupiter in Cancer/);assert.doesNotMatch(JSON.stringify(review.reading),/\{\{/);}
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?draft:{grounded:true,cohesive:true,accurate_placements:true,source_boundaries:true,timing_preserved:true})}}]})};
 }});
 const result=await provider.generate(context);assert.match(result.text,/your natal Mars in Cancer/);assert.equal(calls,2);
 assert.throws(()=>renderNatalReferences({paragraphs:[{text:'{{natal:Neptune}}'}]},context),/unavailable/);
 const unknown=contextFor(savedChart,{month:'2026-10',published:{General:source,Aries:source,Taurus:source}},[]);
 assert.throws(()=>renderNatalReferences({paragraphs:[{text:'{{natal:Rising}}'}]},unknown),/unavailable/);
});
test('generation error and retry stay beside the button; extra explanation is collapsed',async()=>{
 const {JSDOM}=require('jsdom'),fs=require('fs');let posts=0;
 const dom=new JSDOM(fs.readFileSync('private-membership/member.html','utf8'),{url:'https://lucehealing.com/members/reading',runScripts:'outside-only'});
 dom.window.fetch=async(url,opts={})=>{
  let data;if(url.endsWith('/config'))data={private:false};else if(url.endsWith('/me'))data={access:true};else if(url.endsWith('/personal-readings'))data={available:[{month:'2026-10'}],saved:[],enabled:true,hasChart:true};else if(url.endsWith('/personal-readings/2026-10')){if(opts.method==='POST'){posts++;return {ok:false,status:502,json:async()=>({error:'Technical validation failure'})};}data={reading:null};}else throw Error(url);return {ok:true,json:async()=>data};
 };
 try{
  dom.window.eval(fs.readFileSync('private-membership/member.js','utf8'));
  for(let i=0;i<100&&!dom.window.document.querySelector('#generate-reading');i++)await new Promise(r=>setTimeout(r,5));
  const d=dom.window.document,b=d.querySelector('#generate-reading');assert.equal(b.textContent,'Create my reading');assert(d.querySelector('#personal-month').parentElement.hidden);assert(!d.querySelector('.reading-about').open);
  await b.onclick({preventDefault(){}});assert.equal(posts,1);assert.equal(b.disabled,false);assert.equal(b.textContent,'Try again');assert.match(d.querySelector('#personal-result #reading-status').textContent,/couldn’t finish/);assert.equal(d.querySelector('#feedback').textContent,'');
 }finally{dom.window.close();}
});

test('provider revises rejected drafts using concrete feedback and rechecks them',async()=>{
 const context=contextFor(savedChart,{month:'2026-10',published:{General:source,Aries:source,Taurus:source}},[]);
 const requests=[];const issue='Remove the guaranteed event next Tuesday.';
 const provider=createOpenAIProvider({env:{OPENAI_API_KEY:'fake'},fetcher:async(_url,options)=>{
  const b=JSON.parse(options.body);requests.push(b);const draft=b.response_format.json_schema.name==='personal_monthly_reading';
  const value=draft?generated():{grounded:true,cohesive:true,accurate_placements:true,source_boundaries:true,timing_preserved:requests.length>2,issues:requests.length>2?[]:[issue]};
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})};
 }});
 const result=await provider.generate(context);assert.ok(result.text);assert.equal(requests.length,4);
 const revision=JSON.parse(requests[2].messages[1].content);assert.ok(revision.corrections.includes(issue));assert.ok(revision.previousDraft.paragraphs.length);
 assert.equal(requests[0].reasoning_effort,'low');assert.equal(requests[0].temperature,undefined);
});
