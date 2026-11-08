'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {publicationMonth, monthKey, eligibleForMonthlyGeneration} = require('../private-membership/monthly-reading-schedule');
test('month follows Pacific calendar at UTC boundary', () => {
  assert.equal(publicationMonth(new Date('2026-12-01T07:59:59Z')), '2026-11');
  assert.equal(publicationMonth(new Date('2026-12-01T08:00:00Z')), '2026-12');
  assert.equal(publicationMonth(new Date('2026-07-01T06:59:59Z')), '2026-06');
  assert.equal(publicationMonth(new Date('2026-07-01T07:00:00Z')), '2026-07');
});
test('stable per-member month key', () => {
  assert.equal(monthKey(42, '2026-12'), '42:2026-12');
  assert.throws(() => monthKey(0, '2026-12'));
  assert.throws(() => monthKey(42, '2026-13'));
});
test('requires verified active member, chart and published current month', () => {
  const base = {verified:true,active:true,hasReliablePlacements:true,publishedMonth:'2026-11',now:new Date('2026-11-08T20:00:00Z')};
  assert.equal(eligibleForMonthlyGeneration(base), true);
  for (const field of ['verified','active','hasReliablePlacements']) assert.equal(eligibleForMonthlyGeneration({...base,[field]:false}), false);
  assert.equal(eligibleForMonthlyGeneration({...base,publishedMonth:'2026-10'}), false);
});
