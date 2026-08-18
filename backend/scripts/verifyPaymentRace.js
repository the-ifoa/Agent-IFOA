#!/usr/bin/env node
/**
 * verifyPaymentRace.js
 *
 * The confirm-vs-webhook race, which this system runs BY DESIGN: both the browser
 * callback and the Stripe webhook process the same PaymentIntent. Proves that
 * yields exactly ONE invoice, ONE payment and ONE admin alert — in either order,
 * and under genuine concurrency.
 *
 * Stripe is stubbed; no network calls are made.
 *
 * Usage:  node scripts/verifyPaymentRace.js
 */
process.env.JWT_SECRET = 'x'.repeat(24);
const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_race_test';
// SAFETY: never run against real data — this script drops the database it uses.
require('dotenv').config();
if (process.env.MONGO_URI && process.env.MONGO_URI.trim() === TEST_URI.trim()) {
  console.error('Refusing to run: the scratch database matches MONGO_URI. Use a different database.');
  process.exit(2);
}
process.env.MONGO_URI = TEST_URI;
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.ADMIN_NOTIFY_EMAILS = 'ops@example.com';

// ── Stub the `stripe` package before paymentController loads it ──────────────
const PI = {
  id: 'pi_race_test_001',
  status: 'succeeded',
  amount: 6900, amount_received: 6900, currency: 'usd',
  latest_charge: null,
  description: 'test',
  metadata: {},   // filled per-test
};
// paymentController does `new Stripe(key)`, so the stub must be constructible.
function stripeStub() {
  return {
    paymentIntents: { retrieve: async () => PI },
    charges:        { retrieve: async () => ({ id: 'ch_x', payment_method_details: { type: 'card', card: { last4: '4242', brand: 'visa' } } }) },
    webhooks:       { constructEvent: (body) => JSON.parse(body.toString()) },
  };
}
const stripePath = require.resolve('stripe');
require.cache[stripePath] = { id: stripePath, filename: stripePath, loaded: true, exports: stripeStub };

// ── Stub the mailer before controllers destructure it ────────────────────────
const emailService = require('../services/emailService');
const mailLog = [];
for (const fn of Object.keys(emailService)) {
  if (typeof emailService[fn] === 'function' && /^send/.test(fn)) {
    emailService[fn] = async (...args) => { mailLog.push({ fn, args }); };
  }
}
const alerts = () => mailLog.filter(m => m.fn === 'sendAdminPaymentNotification');
const resetMail = () => { mailLog.length = 0; };

const mongoose = require('mongoose');
const Individual = require('../models/Individual');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const paymentCtrl = require('../controller/paymentController');
const pricing = require('../shared/pricing');

let pass = 0, fail = 0;
const ok = (c, l, e='') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l} ${e}`); } };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mkRes = () => { const r = { statusCode: 200, body: null, sent: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.send = b => { r.sent = b; return r; };
  return r; };

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes().catch(()=>{})));

  const ind = await Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: 69,
    firstName: 'Ada', lastName: 'L', email: 'race@ex.com',
    primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true,
  });
  PI.metadata = { registrationId: String(ind._id), registrationModel: 'Individual', purpose: 'payment' };
  const user = { role: 'admin', id: String(ind._id), email: 'race@ex.com', registrationId: String(ind._id) };

  // ══ 1. confirm THEN webhook ═══════════════════════════════════════════════
  H('1. confirmPayment first, then the webhook for the same intent');
  resetMail();
  const r1 = mkRes();
  await paymentCtrl.confirmPayment({
    body: { paymentIntentId: PI.id, registrationId: String(ind._id), registrationModel: 'Individual' },
    user, ip: '1.1.1.1', headers: {},
  }, r1);
  await sleep(200);
  ok(r1.body?.success === true, 'confirm succeeded');
  const afterConfirm = alerts().length;
  ok(afterConfirm === 1, 'confirm sent exactly one alert', `got ${afterConfirm}`);

  const r2 = mkRes();
  await paymentCtrl.stripeWebhook({
    headers: { 'stripe-signature': 'sig' },
    body: Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded', data: { object: PI } })),
  }, r2);
  await sleep(200);
  ok(alerts().length === 1, 'webhook did NOT send a second alert', `total ${alerts().length}`);
  ok((await Invoice.countDocuments({ registrationId: ind._id })) === 1, 'exactly one invoice exists');
  ok((await Payment.countDocuments({ stripePaymentIntentId: PI.id })) === 1, 'exactly one payment exists');

  // ══ 2. webhook FIRST, then confirm (opposite order) ═══════════════════════
  H('2. webhook first, then confirmPayment (reverse order)');
  await Invoice.deleteMany({}); await Payment.deleteMany({});
  await Individual.findByIdAndUpdate(ind._id, { $set: { isPaid: false, paymentStatus: 'pending', invoiceNumber: '' } });
  resetMail();
  PI.id = 'pi_race_test_002';
  PI.metadata.registrationId = String(ind._id);

  const r3 = mkRes();
  await paymentCtrl.stripeWebhook({
    headers: { 'stripe-signature': 'sig' },
    body: Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded', data: { object: PI } })),
  }, r3);
  await sleep(200);
  ok(alerts().length === 1, 'webhook sent exactly one alert', `got ${alerts().length}`);

  const r4 = mkRes();
  await paymentCtrl.confirmPayment({
    body: { paymentIntentId: PI.id, registrationId: String(ind._id), registrationModel: 'Individual' },
    user, ip: '1.1.1.1', headers: {},
  }, r4);
  await sleep(200);
  ok(r4.body?.alreadyRecorded === true, 'confirm reports alreadyRecorded');
  ok(alerts().length === 1, 'confirm did NOT send a second alert', `total ${alerts().length}`);
  ok((await Invoice.countDocuments({})) === 1, 'still exactly one invoice');

  // ══ 3. TRUE concurrency — both fired simultaneously ══════════════════════
  H('3. genuine race — confirm and webhook dispatched together');
  await Invoice.deleteMany({}); await Payment.deleteMany({});
  await Individual.findByIdAndUpdate(ind._id, { $set: { isPaid: false, paymentStatus: 'pending', invoiceNumber: '' } });
  resetMail();
  PI.id = 'pi_race_test_003';

  await Promise.allSettled([
    paymentCtrl.confirmPayment({
      body: { paymentIntentId: PI.id, registrationId: String(ind._id), registrationModel: 'Individual' },
      user, ip: '1.1.1.1', headers: {},
    }, mkRes()),
    paymentCtrl.stripeWebhook({
      headers: { 'stripe-signature': 'sig' },
      body: Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded', data: { object: PI } })),
    }, mkRes()),
  ]);
  await sleep(400);
  const invCount = await Invoice.countDocuments({});
  const payCount = await Payment.countDocuments({ stripePaymentIntentId: PI.id });
  ok(invCount === 1, 'exactly ONE invoice despite the race', `got ${invCount}`);
  ok(payCount === 1, 'exactly ONE payment despite the race', `got ${payCount}`);
  ok(alerts().length <= 1, 'at most ONE admin alert despite the race', `got ${alerts().length}`);
  if (alerts().length === 0) { fail++; console.log('  FAIL  at least one alert should have been sent'); }
  else { pass++; console.log('  PASS  an alert was sent (not silently dropped)'); }

  // Invoice number integrity after the race
  const invs = await Invoice.find({}).select('invoiceNumber').lean();
  const nums = invs.map(i => i.invoiceNumber);
  ok(new Set(nums).size === nums.length, 'no duplicate invoice numbers after the race');

  console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(76)}`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
