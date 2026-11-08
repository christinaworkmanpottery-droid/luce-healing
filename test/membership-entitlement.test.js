'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {paidAccess, complimentaryAccess, hasMemberAccess} = require('../private-membership/entitlement');
const now = new Date('2026-11-08T12:00:00Z');
const paid = {is_test:false,verified_at:'2026-11-01',status:'active',stripe_subscription_id:'sub_example',access_until:'2026-12-01'};
test('registered or verified free account is denied',()=>{
 assert.equal(hasMemberAccess({is_test:false,status:'unpaid',verified_at:'2026-11-01'},now),false);
 assert.equal(hasMemberAccess({is_test:false,status:'pending'},now),false);
});
test('active Stripe subscription is accepted only when verified and not expired',()=>{
 assert.equal(paidAccess(paid,now),true);
 for(const patch of [{stripe_subscription_id:null},{status:'trialing'},{verified_at:null},{access_until:'2026-11-07'},{is_test:true}])
   assert.equal(paidAccess({...paid,...patch},now),false);
});
test('complimentary redemption is accepted without Stripe billing',()=>{
 const m={is_test:false,complimentary_granted_at:'2026-11-01',complimentary_until:'2026-12-01'};
 assert.equal(complimentaryAccess(m,now),true);
 assert.equal(complimentaryAccess({...m,complimentary_until:'2026-11-07'},now),false);
 assert.equal(complimentaryAccess({...m,is_test:true},now),false);
 assert.equal(complimentaryAccess({is_test:false},now),false);
});
test('private preview and unverified test subscription never grant paid content',()=>{
 assert.equal(hasMemberAccess({...paid,is_test:true,status:'preview'},now),false);
});
