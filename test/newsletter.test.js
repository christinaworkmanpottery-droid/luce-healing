const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsletterHandlers } = require('../newsletter');
const response = () => ({ code:200, status(code){this.code=code;return this;}, json(body){this.body=body;return this;} });
function harness(overrides={}) {
 const writes=[]; const sent=[];
 const dependencies={dbGet:async sql => sql.includes('smtp_user')?{value:'sender@example.com'}:sql.includes('blog_posts')?{title:'A new post',content:'<p>Complete article body</p>',slug:'new-post'}:null,dbAll:async()=>[],dbRun:async(sql,args)=>writes.push({sql,args}),getTransporter:()=>({verify:async()=>true,sendMail:async mail=>{sent.push(mail);return {accepted:[mail.to]};}}),...overrides};
 return {handlers:createNewsletterHandlers(dependencies),writes,sent};
}
test('normalizes signup and rejects malformed addresses without writing',async()=>{
 const h=harness(); let res=response(); await h.handlers.subscribe({body:{email:'bad'}},res);assert.equal(res.code,400);assert.equal(h.writes.length,0);
 res=response();await h.handlers.subscribe({body:{email:' Person@Example.COM ',name:' Pat '}},res);assert.equal(res.body.success,true);assert.equal(h.writes[0].args[0],'person@example.com');assert.match(h.writes[0].args[3],/^[a-f0-9]{64}$/);
});
test('explicit re-subscription reactivates an inactive subscriber',async()=>{
 const h=harness({dbGet:async()=>({id:7,active:0})});const res=response();await h.handlers.subscribe({body:{email:'person@example.com'}},res);assert.match(h.writes[0].sql,/active = 1/);assert.equal(h.writes[0].args[2],7);
});
test('missing SMTP reports failure and never records a sent campaign',async()=>{
 const h=harness({getTransporter:()=>null});const res=response();await h.handlers.send({body:{blogPostId:1}},res);assert.equal(res.code,503);assert.equal(h.writes.length,0);
});
test('awaits deliveries, reports partial failure, includes full article and unsubscribe',async()=>{
 const h=harness({dbAll:async()=>[{id:1,email:'one@example.com'},{id:2,email:'two@example.com'}],getTransporter:()=>({verify:async()=>true,sendMail:async mail=>{h.sent.push(mail);if(mail.to.startsWith('two'))throw Error('rejected');return {accepted:[mail.to]};}})});
 const res=response();await h.handlers.send({body:{blogPostId:1}},res);assert.equal(res.code,502);assert.equal(res.body.recipientCount,1);assert.equal(res.body.failedCount,1);assert.match(h.sent[0].html,/Complete article body/);assert.match(h.sent[0].html,/unsubscribe\?token=[a-f0-9]{64}/);assert.equal(h.writes.at(-1).args[0],1);
});
test('SMTP verification failure reports no success',async()=>{const h=harness({getTransporter:()=>({verify:async()=>{throw Error('offline');}})});const res=response();await h.handlers.send({body:{blogPostId:1}},res);assert.equal(res.code,500);assert.equal(h.writes.length,0);});
test('unpublished blog is never sent',async()=>{const h=harness({dbGet:async()=>null});const res=response();await h.handlers.send({body:{blogPostId:1}},res);assert.equal(res.code,404);assert.equal(h.sent.length,0);});
test('unsubscribe validates opaque token and changes only matched subscriber',async()=>{const h=harness({dbGet:async()=>({id:9})});let res=response();await h.handlers.unsubscribe({body:{token:'email@example.com'}},res);assert.equal(res.code,400);assert.equal(h.writes.length,0);res=response();await h.handlers.unsubscribe({body:{token:'a'.repeat(64)}},res);assert.equal(res.body.success,true);assert.deepEqual(h.writes[0].args,[9]);});
