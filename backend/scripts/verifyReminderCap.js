#!/usr/bin/env node
/**
 * verifyReminderCap.js
 *
 * Proves a customer is never emailed more than MAX_REMINDERS_PER_MONTH (2) expiry
 * reminders in any rolling REMINDER_WINDOW_DAYS (30) period.
 *
 * The per-window stamps stop the SAME window re-firing; this suite exercises the
 * independent ceiling that holds regardless of how often the job runs, how many
 * windows exist, or how many subscriptions one person owns:
 *
 *   - repeated daily runs across a window produce ONE email, not six
 *   - a normal cycle still delivers both the 60-day and 30-day reminders
 *   - a third reminder inside the same month is refused
 *   - the cap releases once the rolling window elapses, pruning stale entries
 *   - one customer on two records receives one email per run
 *   - 90 consecutive daily runs never exceed the cap
 *
 * Usage:  node scripts/verifyReminderCap.js
 */
process.env.JWT_SECRET = 'x'.repeat(24);
const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_cap_test';
// SAFETY: never run against real data — this script drops the database it uses.
require('dotenv').config();
if (process.env.MONGO_URI && process.env.MONGO_URI.trim() === TEST_URI.trim()) {
  console.error('Refusing to run: the scratch database matches MONGO_URI.');
  process.exit(2);
}
process.env.MONGO_URI = TEST_URI;

// Count sends by intercepting the mailer BEFORE the cron destructures it.
const emailService = require('../services/emailService');
let sends = [];
emailService.sendExpiryReminder = async (doc, isAirline, days) => {
  sends.push({ who: doc.firstName || doc.airlineName, email: doc.email, days });
};
for (const fn of Object.keys(emailService)) {
  if (typeof emailService[fn] === 'function' && /^send/.test(fn) && fn !== 'sendExpiryReminder') {
    emailService[fn] = async () => {};
  }
}

const mongoose = require('mongoose');
const Individual = require('../models/Individual');
const cron = require('../cron/subscriptionReminder');

let pass = 0, fail = 0;
const ok = (c, l, e='') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l} ${e}`); } };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);
const DAY = 24*3600*1000;

const mkInd = (over) => Individual.create({
  subscriptionPlan: '1 Year Subscription Plan', price: 69,
  primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
  agreedToTerms: true, status: 'Active', isPaid: true, ...over,
});

(async () => {
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes().catch(()=>{})));

  // ── 1. Daily runs across the whole 6-day window: only ONE email ───────────
  H('1. Cron runs every day while the customer sits in the 30-day window');
  const a = await mkInd({ firstName: 'Daily', lastName: 'A', email: 'daily@ex.com',
                          expirationDate: new Date(Date.now() + 30*DAY) });
  sends = [];
  for (let d = 0; d < 6; d++) await cron.runReminders();
  ok(sends.length === 1, `6 daily runs -> 1 email (got ${sends.length})`);

  // ── 2. Both windows over a full cycle: exactly 2 ─────────────────────────
  H('2. A full subscription cycle — 60-day window then 30-day window');
  const b = await mkInd({ firstName: 'Cycle', lastName: 'B', email: 'cycle@ex.com',
                          expirationDate: new Date(Date.now() + 60*DAY) });
  sends = [];
  await cron.runReminders();                       // 60-day window fires
  ok(sends.length === 1, `60-day reminder sent (${sends.length})`);
  // Move 30 days on: now in the 30-day window. Backdate the log so the rolling
  // window has genuinely elapsed, as it would in real time.
  await Individual.findByIdAndUpdate(b._id, { $set: {
    expirationDate: new Date(Date.now() + 30*DAY),
    expiryReminderLog: [new Date(Date.now() - 31*DAY)],
    expiryReminder60SentAt: new Date(Date.now() - 31*DAY),
  }});
  sends = [];
  await cron.runReminders();
  ok(sends.length === 1, `30-day reminder sent a month later (${sends.length})`);

  // ── 3. THE CAP: three windows inside one month cannot send three ──────────
  H('3. Hard cap — a third reminder inside the same month is refused');
  const c = await mkInd({ firstName: 'Capped', lastName: 'C', email: 'capped@ex.com',
                          expirationDate: new Date(Date.now() + 30*DAY),
                          expiryReminderLog: [new Date(Date.now() - 2*DAY), new Date(Date.now() - 1*DAY)] });
  sends = [];
  await cron.runReminders();
  ok(sends.length === 0, `already had 2 this month -> 0 sent (got ${sends.length})`);
  const cDoc = await Individual.findById(c._id).lean();
  ok((cDoc.expiryReminderLog || []).length === 2, 'log unchanged (nothing appended)');

  // ── 4. Cap releases once the rolling window passes ────────────────────────
  H('4. Cap releases after the rolling window elapses');
  await Individual.findByIdAndUpdate(c._id, { $set: {
    expiryReminderLog: [new Date(Date.now() - 40*DAY), new Date(Date.now() - 35*DAY)],
    expiryReminder30SentAt: new Date(Date.now() - 35*DAY),
  }});
  sends = [];
  await cron.runReminders();
  ok(sends.length === 1, `both entries older than 30 days -> 1 sent (got ${sends.length})`);
  const cDoc2 = await Individual.findById(c._id).lean();
  ok((cDoc2.expiryReminderLog || []).length === 1, 'stale entries PRUNED, only the new send kept',
     String((cDoc2.expiryReminderLog||[]).length));

  // ── 5. One person, two subscriptions, one run ─────────────────────────────
  H('5. Same customer on two records — one email per run');
  await mkInd({ firstName: 'Twin1', lastName: 'D', email: 'twin@ex.com',
                expirationDate: new Date(Date.now() + 30*DAY) });
  await mkInd({ firstName: 'Twin2', lastName: 'D', email: 'twin@ex.com',
                expirationDate: new Date(Date.now() + 30*DAY) });
  sends = [];
  await cron.runReminders();
  const twinSends = sends.filter(s => s.email === 'twin@ex.com');
  ok(twinSends.length === 1, `two records, same email -> 1 email (got ${twinSends.length})`);

  // ── 6. Never more than 2 per month, simulated over 90 daily runs ──────────
  H('6. 90 consecutive daily runs — never exceeds the cap');
  const e = await mkInd({ firstName: 'Long', lastName: 'Run', email: 'long@ex.com',
                          expirationDate: new Date(Date.now() + 60*DAY) });
  sends = [];
  for (let day = 0; day < 90; day++) {
    // Simulate a day passing: pull the expiry 1 day closer.
    await Individual.findByIdAndUpdate(e._id, { $set: { expirationDate: new Date(Date.now() + (60 - day)*DAY) } });
    await cron.runReminders();
  }
  const longSends = sends.filter(s => s.email === 'long@ex.com');
  ok(longSends.length <= 2, `90 daily runs -> at most 2 emails (got ${longSends.length})`);
  ok(longSends.length === 2, `and it did send both windows (got ${longSends.length}: ${longSends.map(s=>s.days+'d').join(', ')})`);

  console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(76)}`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
