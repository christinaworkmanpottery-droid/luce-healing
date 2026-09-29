const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const {render}=require('../public-navigation');
const read=file=>fs.readFileSync(file,'utf8');
const settle=()=>new Promise(r=>setTimeout(r,20));
test('Home is an overview, detailed content and unobtrusive admin access remain reachable',()=>{
 const d=new JSDOM(render(read('index.html'))).window.document;
 assert.equal(d.querySelectorAll('#about').length,1);assert.equal(d.querySelectorAll('#newsletter-form').length,1);
 assert.equal(d.querySelectorAll('#contact-form,#review-form,.faq-answer,.trust-bar').length,0);
 assert(d.querySelector('a[href="/about.html#reviews"]'));assert(d.querySelector('.admin-access a'));
 assert(!d.querySelector('.luce-site-header').textContent.includes('Admin'));
 for(const file of ['index.html','about.html','sessions.html','readings.html','contact.html','faq.html','blog.html'])assert(!read(file).includes('christinaworkmanpottery.com'));
 assert(!read('contact.html').includes('contact-phone'));
 const pricing=new JSDOM(read('pricing.html')).window.document;
 for(const type of ['chart-written','chart-30min','chart-60min'])assert(pricing.querySelector(`a[href="/#${type}"]`));
});
test('one homepage review, complete About reviews and working submission after moving the form',async()=>{
 for(const file of ['index.html','about.html']){
 const dom=new JSDOM(render(read(file)),{url:'https://lucehealing.com/',runScripts:'outside-only'}),w=dom.window,d=w.document,requests=[];
 w.fetch=async(url,options)=>{requests.push({url,...options});return {ok:true,json:async()=>options?{message:'Review received'}:[{name:'Reader',rating:5,review_text:'Helpful guidance.',session_type:'Reading'},{name:'Another reader',rating:5,review_text:'Thoughtful support.',session_type:'Reiki'}]};};
 w.eval(read('public-reviews.js'));await settle();
 assert.equal(d.querySelectorAll('#reviews-container .review-card').length,file==='index.html'?1:2);
 if(file==='about.html'){
 d.querySelector('#review-name').value='Local test';d.querySelector('#review-text').value='Local test only';d.querySelector('.star[data-rating="5"]').click();
 d.querySelector('#review-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
 assert.equal(requests.at(-1).url,'/api/reviews/submit');assert.equal(JSON.parse(requests.at(-1).body).rating,5);assert.equal(d.querySelector('#review-feedback').textContent,'Review received');
 }w.close();
 }
});
test('email-only contact form submits with success and retryable error states',async()=>{
 const dom=new JSDOM(read('contact.html'),{url:'https://lucehealing.com/contact.html',runScripts:'outside-only'}),w=dom.window,d=w.document;let body,ok=true;
 w.fetch=async(url,options)=>{assert.equal(url,'/api/contact');body=JSON.parse(options.body);return {ok,json:async()=>ok?{message:'Received'}:{error:'Try again'}};};
 for(const script of d.querySelectorAll('script:not([src])'))w.eval(script.textContent);
 for(const [id,value] of Object.entries({'contact-name':'Local test','contact-email':'qa@example.com','contact-subject':'General Inquiry','contact-message':'Test message'}))d.getElementById(id).value=value;
 await w.submitContactForm({preventDefault(){}});assert.equal(body.email,'qa@example.com');assert(!('phone' in body));assert.match(d.querySelector('#contact-form-feedback').textContent,/Received/);
 ok=false;await w.submitContactForm({preventDefault(){}});assert.match(d.querySelector('#contact-form-feedback').textContent,/Try again/);assert.equal(d.querySelector('#contact-submit-btn').disabled,false);w.close();
});
