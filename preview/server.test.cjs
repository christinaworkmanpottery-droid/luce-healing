const test=require('node:test'),assert=require('node:assert/strict');
process.env.PREVIEW_TOKEN='isolated-test-token-not-a-real-credential';
const {server}=require('./server.cjs');
test('private preview isolates data, permits sample ordering and rejects all other mutations',async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try {
 assert.equal((await fetch(base+'/api/admin/blog')).status,401);
 assert.equal((await fetch(base+'/admin-mobile.js')).status,401);
 assert.equal((await fetch(base+'/preview/access',{method:'POST',body:'{"token":"wrong"}'})).status,401);
 const access=await fetch(base+'/preview/access',{method:'POST',body:JSON.stringify({token:process.env.PREVIEW_TOKEN})});assert.equal(access.status,200);
 const cookie=access.headers.get('set-cookie').split(';')[0];assert.match(access.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
 const get=p=>fetch(base+p,{headers:{cookie}});
 const html=await(await get('/admin')).text();assert.match(html,/PRIVATE TEST PREVIEW/);assert.match(html,/window.doLogin/);
 for(const p of ['blog','newsletter/subscribers','membership/members','traffic','newsletter/campaigns','membership/horoscopes'])assert.equal((await get('/api/admin/'+p)).status,200);
 let order=await(await get('/api/admin/blog')).json();const previous=order.map(p=>p.id),ids=[...previous].reverse();
 assert.equal((await fetch(base+'/api/admin/blog-order',{method:'PUT',headers:{cookie},body:JSON.stringify({ids,previous})})).status,200);
 assert.deepEqual((await(await get('/api/admin/blog')).json()).map(p=>p.id),ids);
 for(const p of ['newsletter/campaigns/1/queue','membership/checkout','blog/1'])assert.equal((await fetch(base+'/api/admin/'+p,{method:'POST',headers:{cookie},body:'{}'})).status,403);
 assert.equal((await get('/server.js')).status,404);
 assert.equal((await get('/.env')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
