'use strict';
// Access to paid content must be based on a confirmed entitlement, not a login session.
function paidAccess(member, now = new Date()) {
  return Boolean(member && !member.is_test && member.verified_at &&
    member.status === 'active' && member.stripe_subscription_id &&
    member.access_until && new Date(member.access_until).getTime() > now.getTime());
}
function complimentaryAccess(member, now = new Date()) {
  return Boolean(member && !member.is_test && member.complimentary_granted_at &&
    (!member.complimentary_until || new Date(member.complimentary_until).getTime() > now.getTime()));
}
function hasMemberAccess(member, now = new Date()) {
  return paidAccess(member, now) || complimentaryAccess(member, now);
}
module.exports = {paidAccess, complimentaryAccess, hasMemberAccess};
