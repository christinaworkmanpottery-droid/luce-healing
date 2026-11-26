'use strict';

const end = Date.parse('2026-12-01T08:00:00Z');
const start = Date.parse('2026-11-25T08:00:00Z');
const marker = 'luce-bf2026';
const day = 86400000;
const armed = new WeakSet();

function isBlackFriday(now) {
  return +now >= start && +now < end;
}

function nativeCheckoutDeadline(now) {
  const remaining = end - Number(now);
  if (remaining >= 31 * 60000 && remaining <= day) return {expires_at: end / 1000};
  if (remaining > 0 && remaining < 31 * 60000) return {expires_at: Math.ceil((Number(now) + 31 * 60000) / 1000)};
  return {};
}

// A single deadline for the sale, including recovery if this process restarts.
function atDeadline(task, attempt = 0) {
  const delay = attempt ? Math.min(60000, 1000 * 2 ** attempt) : Math.max(0, end - Date.now());
  const timer = setTimeout(async () => {
    try { await task(); }
    catch {
      console.error('Black Friday checkout expiration request failed');
      if (Date.now() < end + day) atDeadline(task, attempt + 1);
    }
  }, delay);
  timer.unref();
}

async function expireOpen(stripe, id) {
  try { await stripe.checkout.sessions.expire(id); }
  catch (error) {
    const session = await stripe.checkout.sessions.retrieve(id);
    if (session.status === 'open') throw error;
  }
}

function recoverAtDeadline(stripe) {
  if (!stripe || armed.has(stripe) || Date.now() < start - day || Date.now() > end + day) return;
  armed.add(stripe);
  atDeadline(async () => {
    const sessions = stripe.checkout.sessions.list({status:'open', created:{gte:(end - day) / 1000}, limit:100});
    for await (const session of sessions) {
      if (session.metadata?.promotion === marker) await expireOpen(stripe, session.id);
    }
  });
}

async function reusableSession(stripe, session) {
  if (session.status !== "open") return false;
  if (session.metadata?.promotion !== marker || Date.now() < end) return true;
  await expireOpen(stripe, session.id);
  return false;
}

async function protectSession(stripe, session) {
  if (session.metadata?.promotion !== marker || session.expires_at * 1000 <= end) return;
  if (Date.now() >= end) {
    await expireOpen(stripe, session.id);
    throw Error('Black Friday has ended. Refresh to view the current price.');
  }
  atDeadline(() => expireOpen(stripe, session.id));
}

module.exports = {isBlackFriday, nativeCheckoutDeadline, marker, recoverAtDeadline, protectSession, reusableSession};
