const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const gifts=require('../gifts');
const promo=require('../promotion-deadline');
test('gift checkout stores and charges matching amounts, only question discounted inside window',async()=>{
 const original=Date.now;
 try {
 for(const [date,product,amount] of [
 ['2026-11-25T07:59:59Z','question',3300],
 ['2026-11-25T08:00:00Z','question',2640],
 ['2026-11-30T12:00:00Z','6month',7500],
 ['2026-12-01T07:59:59Z','question',2640],
 ['2026-12-01T08:00:00Z','question',3300]]) {
 Date.now=()=>Date.parse(date);
 const routes={};let stored,checkout,paidAmount;
 const app={get(){},post(path,fn){routes[path]=fn}};
 const pool={async query(sql,args){if(sql.startsWith('INSERT INTO reading_gifts')){stored=args[1];return {rows:[{id:1}]}}if(sql.startsWith('UPDATE reading_gifts SET payment_status')){paidAmount=args[1];return {rows:[]}}return {rows:[]}}};
 const stripe={checkout:{sessions:{async create(params){checkout=params;return {id:'cs_test_gift',url:'https://example.invalid',metadata:params.metadata,expires_at:Date.parse('2026-12-01T08:00:00Z')/1000}}}}};
 const service=gifts({app,pool,stripe,getMailer:()=>null,domain:'https://example.invalid'});
 const res={status(code){throw Error('Unexpected status '+code)},json(value){this.value=value}};
 await routes['/api/gifts/checkout']({body:{product,buyer_name:'Test',buyer_email:'test@example.invalid'}},res);
 assert.equal(stored,amount);assert.equal(checkout.line_items[0].price_data.unit_amount,amount);
 assert.equal(checkout.metadata.promotion,amount===2640?promo.marker:undefined);
 assert.equal(res.value.url,'https://example.invalid');
 await service.handleWebhook({id:'cs_test_gift',currency:'usd',payment_status:'paid',amount_total:amount,metadata:checkout.metadata});
 assert.equal(paidAmount,amount);
 }
 } finally {Date.now=original}
});
test('gift form displays matching sale price and regular price outside sale',()=>{
 const source=fs.readFileSync(require.resolve('../gift.js'),'utf8');
 const catalogSource=fs.readFileSync(require.resolve('../gift-catalog.js'),'utf8');
 for(const [date,expected] of [['2026-11-25T12:00:00Z','26.40'],['2026-12-01T08:00:00Z','33']]){
 const elements={};const element=id=>elements[id]??={value:'question',options:[],append(option){this.options.push(option)},addEventListener(){}};
 const context={window:{},document:{getElementById:element,createElement:()=>({})},location:{search:''},URLSearchParams,Date:class extends Date{static now(){return Date.parse(date)}}};
 vm.runInNewContext(catalogSource,context);vm.runInNewContext(source,context);
 assert.equal(elements['gift-product'].options[0].textContent,'One-question email reading — $'+expected);
 assert.equal(elements['gift-buy'].textContent,'Buy Gift — $'+expected);
 assert.match(elements['gift-description'].textContent,new RegExp(expected.replace('.','\\.')));
 assert.equal(elements['gift-product'].options[1].textContent,'6-month written forecast — $75');
 }
});
