// Isolated middleware regression: synthetic data, no database or external calls.
// This does not substitute for full-application authorization/billing tests.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const express=require('express');
const Stripe=require('stripe');
const stripe=new Stripe('sk_test_fixture_only');
const secret='whsec_fixture_only';
const payload='{"id":"evt_fixture", "type":"fixture.noop", "data":{"object":{}}}\n';
test('patched transitive parser and application raw-body ordering',()=>{
  const expressRequire=require('node:module').createRequire(require.resolve('express'));
  assert.equal(expressRequire('body-parser/package.json').version,'1.20.9');
  const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
  assert.ok(source.indexOf('express.raw({')<source.indexOf('app.use(express.json('));
  assert.match(source,/constructEvent\(req.body,/);
});
test('compressed requests, limits and Stripe raw bytes',async t=>{
  const app=express(); let mutations=0;
  app.post('/api/stripe/webhook',express.raw({type:'application/json'}),(req,res)=>{
    try {assert.ok(Buffer.isBuffer(req.body));stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],secret);res.sendStatus(200);}
    catch {res.sendStatus(400);}
  });
  app.use(express.json()); app.use(express.urlencoded({extended:true}));
  app.post('/echo',(req,res)=>res.json(req.body));
  app.post('/protected',(req,res)=>{
    if(req.headers.authorization!=='Bearer synthetic-owner')return res.sendStatus(401);
    if(req.body.owner!=='synthetic-owner')return res.sendStatus(403);
    mutations++;res.json({ok:true});
  });
  app.use((err,req,res,next)=>res.sendStatus(err.status||500));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url='http://127.0.0.1:'+server.address().port;
  const post=(route,body,headers={})=>fetch(url+route,{method:'POST',headers:{'content-type':'application/json',...headers},body});
  try {
    for(const [encoding,compress] of [['gzip',zlib.gzipSync],['deflate',zlib.deflateSync]]){
      await t.test(encoding+' valid compressed JSON',async()=>{const r=await post('/echo',compress(Buffer.from('{"ok":true}')),{'content-encoding':encoding});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});});
      await t.test(encoding+' trailing bytes cannot terminate server',async()=>{
        const body=Buffer.concat([compress(Buffer.from('{"ok":true}')),Buffer.from('invalid trailing bytes')]);
        const r=await post('/echo',body,{'content-encoding':encoding});assert.ok([200,400].includes(r.status));await r.text();
        await new Promise(resolve=>setTimeout(resolve,100));assert.equal((await post('/echo','{}')).status,200);
      });
      await t.test(encoding+' decompressed size limit',async()=>{assert.equal((await post('/echo',compress(Buffer.from(JSON.stringify({text:'x'.repeat(110000)}))),{'content-encoding':encoding})).status,413);});
    }
    await t.test('malformed JSON and malformed compressed body rejected',async()=>{assert.equal((await post('/echo','{')).status,400);assert.equal((await post('/echo',Buffer.from('bad gzip'),{'content-encoding':'gzip'})).status,400);});
    await t.test('unsupported encoding rejected',async()=>assert.equal((await post('/echo','{}',{'content-encoding':'unsupported'})).status,415));
    await t.test('plain JSON size limit',async()=>assert.equal((await post('/echo',JSON.stringify({text:'x'.repeat(110000)}))).status,413));
    await t.test('URL-encoded parameter limit',async()=>assert.equal((await post('/echo',Array.from({length:1001},(_,i)=>'p'+i+'=x').join('&'),{'content-type':'application/x-www-form-urlencoded'})).status,413));
    await t.test('synthetic authentication and ownership deny mutation',async()=>{
      assert.equal((await post('/protected','{"owner":"synthetic-owner"}')).status,401);
      assert.equal((await post('/protected','{"owner":"other"}',{authorization:'Bearer synthetic-owner'})).status,403);assert.equal(mutations,0);
      assert.equal((await post('/protected','{"owner":"synthetic-owner"}',{authorization:'Bearer synthetic-owner'})).status,200);assert.equal(mutations,1);
    });
    await t.test('Stripe signature validates exact whitespace-preserving bytes',async()=>{
      const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
      assert.equal((await post('/api/stripe/webhook',payload,{'stripe-signature':signature})).status,200);
      assert.equal((await post('/api/stripe/webhook',JSON.stringify(JSON.parse(payload)),{'stripe-signature':signature})).status,400);
      assert.equal((await post('/api/stripe/webhook',payload)).status,400);
    });
    await t.test('server stays healthy after rejected requests',async()=>assert.equal((await post('/echo','{}')).status,200));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
