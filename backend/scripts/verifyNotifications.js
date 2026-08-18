#!/usr/bin/env node
/**
 * verifyNotifications.js
 *
 * Behavioural audit of the admin-notification wiring. Drives the REAL controllers
 * against a scratch database with the mailer stubbed, proving what a static grep
 * cannot: that every money-completing path produces an invoice AND exactly one
 * admin alert, that repeat calls to an idempotent path do not re-alert or
 * re-invoice, and that a declined wire request produces no payment alert.
 *
 * Usage:  node scripts/verifyNotifications.js
 */
process.env.JWT_SECRET = 'x'.repeat(24);
const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_arch_test';
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
process.env.SUPPORT_ALERT_GRACE_SECONDS = '1';
process.env.SUPPORT_ALERT_THROTTLE_MINUTES = '10';

// ── Stub the mailer BEFORE controllers require (they destructure at load) ────
const emailService = require('../services/emailService');
const mailLog = [];
for (const fn of Object.keys(emailService)) {
  if (typeof emailService[fn] === 'function' && /^send/.test(fn)) {
    emailService[fn] = async (...args) => { mailLog.push({ fn, args }); };
  }
}
const mailsOf = (fn) => mailLog.filter(m => m.fn === fn);
const resetMail = () => { mailLog.length = 0; };

const mongoose = require('mongoose');
const Individual = require('../models/Individual');
const Airlines   = require('../models/Airlines');
const Invoice    = require('../models/Invoice');
const Payment    = require('../models/Payment');
const Renewal    = require('../models/Renewal');
const InvoiceCounter = require('../models/InvoiceCounter');

const individualCtrl = require('../controller/individualController');
const airlinesCtrl   = require('../controller/airlinesController');
const paymentCtrl    = require('../controller/paymentController');
const pricing        = require('../shared/pricing');

let pass = 0, fail = 0;
const ok = (c, label, extra='') => { if (c) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${extra}`); } };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Minimal express req/res doubles.
const mkRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const admin = { role: 'admin', id: new mongoose.Types.ObjectId().toString(), email: 'admin@example.com' };

async function mkIndividual(over = {}) {
  return Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: pricing.individualPrice('1 Year Subscription Plan'),
    firstName: 'Ada', lastName: 'Lovelace', email: `ada${Date.now()}${Math.random()}@ex.com`,
    primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true, ...over,
  });
}
async function mkAirline(over = {}) {
  const ppc = pricing.airlinePricePerCert('1 Year Subscription Plan', 4);
  return Airlines.create({
    subscriptionPlan: '1 Year Subscription Plan', pricePerCertificate: ppc,
    airlineName: 'Test Air', firstName: 'Al', lastName: 'Pilot',
    email: `air${Date.now()}${Math.random()}@ex.com`,
    holderCount: '3 to 5', holderCountValue: '4', committedCount: 4,
    agreedToTerms: true, ...over,
  });
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes().catch(()=>{})));

  // ══ 1. Individual manual mark-paid ═══════════════════════════════════════
  H('1. markIndividualPaid — invoice + exactly one admin alert');
  resetMail();
  const ind1 = await mkIndividual();
  let res = mkRes();
  await individualCtrl.markIndividualPaid({ params: { id: ind1._id }, user: admin, body: {} }, res);
  await sleep(120);
  ok(res.body?.success === true, 'endpoint succeeded');
  const inv1 = await Invoice.find({ registrationId: ind1._id }).lean();
  ok(inv1.length === 1, 'exactly one invoice created', `got ${inv1.length}`);
  ok(mailsOf('sendAdminPaymentNotification').length === 1, 'exactly one admin alert', `got ${mailsOf('sendAdminPaymentNotification').length}`);
  ok(mailsOf('sendIndividualPaymentConfirmation').length === 1, 'exactly one customer confirmation');
  const ctx1 = mailsOf('sendAdminPaymentNotification')[0]?.args[1];
  ok(ctx1?.amountDollars === pricing.individualPrice('1 Year Subscription Plan'),
     `alert carries the right amount ($${ctx1?.amountDollars})`);
  ok(ctx1?.invoiceNumber === inv1[0].invoiceNumber, 'alert carries the real invoice number', `${ctx1?.invoiceNumber} vs ${inv1[0].invoiceNumber}`);

  // idempotency — second call must not re-alert
  resetMail();
  res = mkRes();
  await individualCtrl.markIndividualPaid({ params: { id: ind1._id }, user: admin, body: {} }, res);
  await sleep(120);
  ok(res.body?.alreadyPaid === true, 'second call reports alreadyPaid');
  ok(mailsOf('sendAdminPaymentNotification').length === 0, 'NO duplicate alert on repeat call');
  ok((await Invoice.countDocuments({ registrationId: ind1._id })) === 1, 'still exactly one invoice');

  // ══ 2. Airline manual mark-paid ═══════════════════════════════════════════
  H('2. markAirlinesPaid — invoice + exactly one admin alert');
  resetMail();
  const air2 = await mkAirline();
  res = mkRes();
  await airlinesCtrl.markAirlinesPaid({ params: { id: air2._id }, user: admin, body: {} }, res);
  await sleep(120);
  const inv2 = await Invoice.find({ registrationId: air2._id }).lean();
  ok(inv2.length === 1, 'exactly one invoice created', `got ${inv2.length}`);
  ok(mailsOf('sendAdminPaymentNotification').length === 1, 'exactly one admin alert');
  const ctx2 = mailsOf('sendAdminPaymentNotification')[0]?.args[1];
  const expected2 = pricing.airlinePricePerCert('1 Year Subscription Plan', 4) * 4;
  ok(ctx2?.amountDollars === expected2, `alert amount = ppc x holders ($${ctx2?.amountDollars} vs $${expected2})`);
  ok(ctx2?.registrationModel === 'Airlines', 'alert tagged as Airlines');
  ok(ctx2?.invoiceNumber === inv2[0].invoiceNumber, 'alert carries the real invoice number');

  resetMail();
  res = mkRes();
  await airlinesCtrl.markAirlinesPaid({ params: { id: air2._id }, user: admin, body: {} }, res);
  await sleep(120);
  ok(mailsOf('sendAdminPaymentNotification').length === 0, 'NO duplicate alert on repeat call');

  // ══ 3. Admin renewal ══════════════════════════════════════════════════════
  H('3. adminRenew — renewal invoice + one alert, correct purpose');
  resetMail();
  res = mkRes();
  await paymentCtrl.adminRenew({
    params: { id: ind1._id }, user: admin, baseUrl: '/api/individuals',
    body: { registrationModel: 'Individual', plan: '1 Year Subscription Plan' },
  }, res);
  await sleep(120);
  ok(res.body?.success === true, 'renewal succeeded', JSON.stringify(res.body).slice(0,120));
  const alerts3 = mailsOf('sendAdminPaymentNotification');
  ok(alerts3.length === 1, 'exactly one admin alert', `got ${alerts3.length}`);
  ok(alerts3[0]?.args[1]?.purpose === 'renewal', 'alert purpose is "renewal"', alerts3[0]?.args[1]?.purpose);
  ok(alerts3[0]?.args[1]?.invoiceNumber === res.body.invoiceNumber, 'alert invoice number matches the response');

  // ══ 4. Admin holder upgrade (paid) ════════════════════════════════════════
  H('4. adminHolderUpgrade — one alert with holder-upgrade context');
  resetMail();
  res = mkRes();
  await paymentCtrl.adminHolderUpgrade({
    params: { id: air2._id }, user: admin,
    body: { plan: '1 Year Subscription Plan', additionalCount: 2, paid: true },
  }, res);
  await sleep(120);
  ok(res.body?.success === true, 'upgrade succeeded');
  const alerts4 = mailsOf('sendAdminPaymentNotification');
  ok(alerts4.length === 1, 'exactly one admin alert', `got ${alerts4.length}`);
  ok(alerts4[0]?.args[1]?.purpose === 'holder-upgrade', 'purpose is "holder-upgrade"');
  ok(alerts4[0]?.args[1]?.additionalHolderCount === 2, 'alert reports +2 holders', String(alerts4[0]?.args[1]?.additionalHolderCount));
  ok(!!alerts4[0]?.args[1]?.invoiceNumber, 'alert carries an invoice number', String(alerts4[0]?.args[1]?.invoiceNumber));

  // ══ 5. Wire request → approve ═════════════════════════════════════════════
  H('5. wire request → approval — request alert, then payment alert');
  resetMail();
  const air5 = await mkAirline();
  res = mkRes();
  await airlinesCtrl.requestAirlineInvoice({ params: { id: air5._id }, user: admin, body: { purpose: 'initial' } }, res);
  await sleep(120);
  ok(mailsOf('sendWireRequestAdminNotification').length === 1, 'wire REQUEST alert sent');
  ok(mailsOf('sendAdminPaymentNotification').length === 0, 'no PAYMENT alert yet (money has not arrived)');

  resetMail();
  res = mkRes();
  await airlinesCtrl.activateWirePayment({ params: { id: air5._id }, user: admin, body: {} }, res);
  await sleep(150);
  ok(res.body?.success === true, 'wire approval succeeded');
  ok(mailsOf('sendAdminPaymentNotification').length === 1, 'exactly one payment alert on approval', `got ${mailsOf('sendAdminPaymentNotification').length}`);
  const ctx5 = mailsOf('sendAdminPaymentNotification')[0]?.args[1];
  ok(ctx5?.paymentMethod === 'wire', 'alert records payment method "wire"');
  ok(!!ctx5?.invoiceNumber, 'alert carries an invoice number');
  const inv5 = await Invoice.find({ registrationId: air5._id }).lean();
  ok(inv5.length === 1, 'exactly one invoice for the wire activation', `got ${inv5.length}`);
  ok(inv5[0].invoiceNumber === ctx5?.invoiceNumber, 'invoice number in alert matches the stored invoice');

  // ══ 6. Wire DECLINE — no payment alert, invoice freed ═════════════════════
  H('6. declineWirePayment — no payment alert');
  resetMail();
  const air6 = await mkAirline();
  await airlinesCtrl.requestAirlineInvoice({ params: { id: air6._id }, user: admin, body: { purpose: 'initial' } }, mkRes());
  await sleep(80);
  resetMail();
  res = mkRes();
  await airlinesCtrl.declineWirePayment({ params: { id: air6._id }, user: admin, body: {} }, res);
  await sleep(120);
  ok(res.body?.success === true, 'decline succeeded');
  ok(mailsOf('sendAdminPaymentNotification').length === 0, 'NO payment alert on decline');

  // ══ 7. Invoice numbering integrity across all of the above ════════════════
  H('7. INVOICE NUMBERING — no duplicates, no gaps left behind');
  const allInv = await Invoice.find({}).select('invoiceNumber').lean();
  const nums = allInv.map(i => i.invoiceNumber);
  ok(new Set(nums).size === nums.length, 'every invoice number is unique', `${nums.length} invoices`);
  const seqs = nums.map(n => Number(/US-(\d+)-/.exec(n)?.[1])).filter(Number.isFinite).sort((a,b)=>a-b);
  const ctr = await InvoiceCounter.findOne({}).lean();
  const gaps = [];
  for (let i = 1; i <= Math.max(...seqs); i++) if (!seqs.includes(i)) gaps.push(i);
  const released = ctr?.released || [];
  const unaccounted = gaps.filter(g => !released.includes(g));
  ok(unaccounted.length === 0, 'every gap is accounted for in the released pool',
     `gaps=${JSON.stringify(gaps)} released=${JSON.stringify(released)}`);

  // ══ 8. Pricing served == pricing charged ══════════════════════════════════
  H('8. PRICING — the served config equals what the code charges');
  const cfg = pricing.getPricingConfig();
  ok(cfg.airline.tiers.every(t => t.oneYear === pricing.airlinePricePerCert('1 Year Subscription Plan', t.minCount)),
     'every served 1-Year tier price matches airlinePricePerCert()');
  ok(cfg.airline.tiers.every(t => t.unlimited === pricing.airlinePricePerCert('Unlimited Plan', t.minCount)),
     'every served Unlimited tier price matches airlinePricePerCert()');
  ok(cfg.individual.oneYear === pricing.individualPrice('1 Year Subscription Plan'),
     'served individual 1-Year price matches individualPrice()');
  ok(cfg.individual.unlimited === pricing.individualPrice('Unlimited Plan'),
     'served individual Unlimited price matches individualPrice()');

  console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(76)}`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
