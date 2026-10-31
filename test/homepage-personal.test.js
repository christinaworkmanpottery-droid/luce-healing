const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const {render}=require('../public-navigation');
const html=fs.readFileSync('index.html','utf8');
test('personal homepage places trust and editorial content before a single set of offers',()=>{
 const d=new JSDOM(render(html)).window.document;
 assert.deepEqual([...d.querySelectorAll('body > section')].map(s=>s.id),['home','about','blog','offerings','newsletter']);
 assert.equal(d.querySelectorAll('#offerings a[href="/reading"]').length,1);
 assert.equal(d.querySelectorAll('body > section a[href="/reading"]').length,1);
 assert.match(d.querySelector('#special-offer').textContent,/\$33/);
 assert.match(d.querySelector('#personalized-reading').textContent,/\$12\.95/);
 assert.equal(d.querySelector('#about img').getAttribute('src'),'images/christina-new.jpeg');
 assert(d.querySelector('#offerings a[href="/astrology-membership"]'));
 assert.equal(d.querySelectorAll('#newsletter-form input[type="email"]').length,1);
});
test('home features the saved first post even when its publication date is older',async()=>{
 const w=new JSDOM(html,{url:'https://lucehealing.com/',runScripts:'outside-only'}).window;
 w.fetch=async url=>{assert.equal(url,'/api/blog/latest');return {json:async()=>[{title:'Chosen older post',slug:'chosen',excerpt:'Guidance',created_at:'2025-01-01'},{title:'New post',slug:'new',created_at:'2026-10-31'}]};};
 const fn=html.match(/async function loadBlogPosts\(\) \{[\s\S]*?\n        function openBlogEditor/)[0].replace(/\n        function openBlogEditor$/,'');
 w.eval(fn);await w.loadBlogPosts();assert.equal(w.document.querySelectorAll('#blog-container article').length,1);assert.match(w.document.querySelector('#blog-container').textContent,/Chosen older post/);assert(!w.document.querySelector('#blog-container').textContent.includes('New post'));w.close();
});
