'use strict';
// Pure scheduling helpers. No database writes, AI calls, or timers occur here.
const moment = require('moment-timezone');
const ZONE = 'America/Los_Angeles';
function publicationMonth(now = new Date()) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('Invalid date');
  return moment(now).tz(ZONE).format('YYYY-MM');
}
function monthKey(memberId, month) {
  if (!Number.isSafeInteger(memberId) || memberId <= 0) throw new TypeError('Invalid member');
  if (typeof month !== 'string' || !/^\\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new TypeError('Invalid month');
  return memberId + ':' + month;
}
function eligibleForMonthlyGeneration({verified, active, hasReliablePlacements, publishedMonth, now = new Date()}) {
  return verified === true && active === true && hasReliablePlacements === true &&
    publishedMonth === publicationMonth(now);
}
module.exports = {ZONE, publicationMonth, monthKey, eligibleForMonthlyGeneration};
