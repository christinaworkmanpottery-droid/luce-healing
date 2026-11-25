'use strict';

const start = Date.parse('2026-11-25T08:00:00Z');
const end = Date.parse('2026-12-01T08:00:00Z');

function isBlackFriday(now) {
  return +now >= start && +now < end;
}

function nativeCheckoutDeadline(now) {
  const remaining = end - Number(now);
  // Earlier sessions already expire within 24 hours. Allow for network
  // transit against Stripe's minimum 30-minute expiration interval.
  if (remaining >= 31 * 60000 && remaining < 86400000) {
    return { expires_at: end / 1000 };
  }
  return {};
}

module.exports = { isBlackFriday, nativeCheckoutDeadline };
