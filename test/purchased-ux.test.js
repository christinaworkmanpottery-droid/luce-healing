const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const profile={date:'1980-05-10',time:'09:30',place:{id:'example',label:'Example City',zone:'America/Chicago'},occurrence:'later'};
async function page(saved=profile,path='/personalized-monthly-reading'){
 const dom=new JSDOM(fs.readFileSync('private-membership/purchased.html','utf8'),{url:'https://lucehealing.com'+path,runScripts:'outside-only'}),requests=[];
 dom.window.fetch=async(url,opts)=>{requests.push({url,...opts});let data;
 if(url.endsWith('/account'))data={name:'Purchaser',verified:true};
 else if(url.endsWith('/catalog'))data={enabled:true,months:[{month:'2026-10',label:'October 2026'}]};
 else if(url.endsWith('/chart'))data={profile:saved};
 else if(opts.method==='POST'&&url==='/api/purchased-readings')data={id:'example'};
 else if(url.includes('/shared/')||url.endsWith('/example'))data={id:'example',recipient:'Recipient',label:'October 2026',birth:{date:'1980-05-10'},placements:[],paid:true,state:'complete',text:'Saved reading.'};
 else throw Error('Unexpected request: '+url);
 return {ok:true,json:async()=>data};};
 dom.window.eval(fs.readFileSync('private-membership/purchased.js','utf8'));await new Promise(r=>setTimeout(r,20));return {dom,doc:dom.window.document,requests};
}
async function click(doc,id){const b=doc.getElementById(id);await b.onclick({currentTarget:b,preventDefault(){}});}
test('saved details show confirmation and summary, submit unchanged, and never write member chart',async()=>{
 const {dom,doc,requests}=await page();try{
 assert.equal(doc.querySelector('.attribution'),null);assert.equal(doc.getElementById('chart-help').open,false);
 await click(doc,'own-birth');assert.match(doc.getElementById('birth-status').textContent,/Saved birth details loaded ✓/);
 assert.equal(doc.getElementById('birth-fields').hidden,true);assert.equal(doc.getElementById('birth-summary').hidden,false);
 assert.match(doc.getElementById('birth-summary').textContent,/1980-05-10.*09:30.*Example City/);assert.equal(doc.getElementById('place-query').value,'Example City');
 const form=doc.getElementById('new-reading');await form.onsubmit({currentTarget:form,preventDefault(){}});
 const payload=JSON.parse(requests.find(r=>r.url==='/api/purchased-readings'&&r.method==='POST').body);
 assert.deepEqual(payload,{recipient:'Purchaser',month:'2026-10',birth:{date:profile.date,time:profile.time,unknownTime:false,unknownLocation:false,occurrence:'later',placeId:'example'}});
 assert.ok(requests.filter(r=>r.url.includes('/membership/')).every(r=>r.method==='GET'));
 assert.ok(doc.querySelector('article .attribution'));assert.equal(doc.querySelector('.reading').textContent,'Saved reading.');
 }finally{dom.window.close();}
});
test('editing and changing recipients preserve independent birth information',async()=>{
 const {dom,doc}=await page();try{await click(doc,'own-birth');doc.getElementById('edit-birth').click();assert.equal(doc.getElementById('birth-fields').hidden,false);assert.equal(doc.getElementById('birth-time').value,'09:30');assert.equal(doc.getElementById('birth-summary').hidden,true);
 doc.getElementById('different-birth').click();for(const id of ['recipient','birth-date','birth-time','place-query'])assert.equal(doc.getElementById(id).value,'');assert.equal(doc.getElementById('occurrence').value,'unknown');assert.equal(doc.getElementById('places').value,'');assert.equal(doc.getElementById('birth-fields').hidden,false);
 }finally{dom.window.close();}
});
test('unknown time and location remain unknown when saved details are reused',async()=>{
 const {dom,doc,requests}=await page({...profile,time:null,place:null});try{await click(doc,'own-birth');assert.match(doc.getElementById('birth-summary').textContent,/Unknown/);assert.equal(doc.getElementById('birth-time').required,false);const form=doc.getElementById('new-reading');await form.onsubmit({currentTarget:form,preventDefault(){}});const birth=JSON.parse(requests.find(r=>r.url==='/api/purchased-readings'&&r.method==='POST').body).birth;assert.equal(birth.unknownTime,true);assert.equal(birth.unknownLocation,true);assert.equal(birth.placeId,undefined);}finally{dom.window.close();}
});
test('missing saved profile leaves editable form with a clear error',async()=>{
 const {dom,doc}=await page(null);try{await click(doc,'own-birth');assert.match(doc.getElementById('feedback').textContent,/No saved birth details/);assert.equal(doc.getElementById('birth-fields').hidden,false);assert.equal(doc.getElementById('birth-status').textContent,'');assert.equal(doc.getElementById('own-birth').disabled,false);}finally{dom.window.close();}
});
test('shared finished reading retains attribution without exposing private birth details',async()=>{
 const {dom,doc}=await page(profile,'/shared-reading/example');try{assert.ok(doc.querySelector('article .attribution'));assert.match(doc.querySelector('article').textContent,/Birth date, time and location are kept private/);assert.doesNotMatch(doc.querySelector('article').textContent,/1980-05-10/);assert.equal(doc.getElementById('reading-sample').hidden,true);}finally{dom.window.close();}
});
