#!/usr/bin/env node
/**
 * verifyUserFlows.js
 *
 * CUSTOMER-side lifecycle audit — the flows an individual or airline drives
 * themselves, plus the cron that carries them forward. Stripe is stubbed
 * faithfully (metadata set at create-time is what retrieve returns), so the real
 * controllers run end-to-end.
 *
 *   individual : first payment -> renew (queues) -> cron activates after expiry
 *   airline    : first payment -> add holders -> convert to Unlimited
 *              : renew base plan, renew ONE add-on group independently
 *   invoices   : each flow mints exactly one invoice, numbered sequentially,
 *                never reusing another plan's number, never leaving an orphan gap
 *   cron       : queued renewal activation (and its live-plan safety guard),
 *                group renewal activation, expiry reminders + cooldown,
 *                invoice-number reclaim sweep
 *
 * Usage:  node scripts/verifyUserFlows.js
 */
process.env.JWT_SECRET = 'x'.repeat(24);
const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_userflow_test';
// SAFETY: never run against real data — this script drops the database it uses.
require('dotenv').config();
if (process.env.MONGO_URI && process.env.MONGO_URI.trim() === TEST_URI.trim()) {
  console.error('Refusing to run: the scratch database matches MONGO_URI.');
  process.exit(2);
}
process.env.MONGO_URI = TEST_URI;
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.ADMIN_NOTIFY_EMAIL = 'ops@example.com';

// ── Stub Stripe (constructible) ──────────────────────────────────────────────
const PI = { id: 'pi_x', status: 'succeeded', amount: 0, amount_received: 0, currency: 'usd',
             latest_charge: null, description: '', metadata: {} };
function stripeStub() {
  return {
    paymentIntents: {
      retrieve: async () => PI,
      create:   async (args) => {
        // Faithful to Stripe: the metadata supplied at create time is exactly what
        // retrieve returns later. The conversion flow puts its whole tier breakdown
        // there, and the itemised credit line is rebuilt from it at confirm time.
        PI.metadata = { ...(args.metadata || {}) };
        PI.amount = args.amount; PI.amount_received = args.amount;
        return { id: PI.id, client_secret: 'cs_x', ...args };
      },
    },
    charges:  { retrieve: async () => ({ id: 'ch_x', payment_method_details: { type: 'card', card: { last4: '4242', brand: 'visa' } } }) },
    webhooks: { constructEvent: (b) => JSON.parse(b.toString()) },
  };
}
require.cache[require.resolve('stripe')] = { id: 'stripe', filename: 'stripe', loaded: true, exports: stripeStub };

const emailService = require('../services/emailService');
for (const fn of Object.keys(emailService)) {
  if (typeof emailService[fn] === 'function' && /^send/.test(fn)) emailService[fn] = async () => {};
}

const mongoose = require('mongoose');
const Individual = require('../models/Individual');
const Airlines   = require('../models/Airlines');
const Invoice    = require('../models/Invoice');
const Payment    = require('../models/Payment');
const Renewal    = require('../models/Renewal');
const InvoiceCounter = require('../models/InvoiceCounter');
const paymentCtrl = require('../controller/paymentController');
const svc      = require('../services/invoiceNumberService');
const pricing  = require('../shared/pricing');

let pass = 0, fail = 0;
const ok = (c, l, e='') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l} ${e}`); } };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mkRes = () => { const r = { statusCode: 200, body: null };
  r.status = c => { r.statusCode = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const yy = String(new Date().getFullYear()).slice(-2);
const N = n => `Invoice US-${n}-${yy}`;

// Simulate a real customer paying: create intent (as the user), then confirm.
async function userPays(reg, model, purpose, extraMeta = {}, amount = null) {
  const user = { role: model === 'Individual' ? 'individual' : 'airline',
                 id: String(reg._id), email: reg.email, registrationId: String(reg._id) };
  PI.id = 'pi_' + Math.random().toString(36).slice(2, 12);
  const intentRes = mkRes();
  await paymentCtrl.createPaymentIntent({
    user, params: {}, query: {},
    body: { registrationId: String(reg._id), registrationModel: model, purpose, ...extraMeta },
  }, intentRes);
  if (!intentRes.body?.success) return { failed: intentRes.body?.message, intentRes };

  // PI.metadata / PI.amount were set by the stub's create() from what
  // createPaymentIntent actually sent — do not overwrite them here.
  if (amount != null) { PI.amount = Math.round(amount * 100); PI.amount_received = PI.amount; }

  const confirmRes = mkRes();
  await paymentCtrl.confirmPayment({
    user, params: {}, query: {}, headers: {}, ip: '1.1.1.1',
    body: { paymentIntentId: PI.id, registrationId: String(reg._id), registrationModel: model },
  }, confirmRes);
  await sleep(120);
  return { intentRes, confirmRes };
}

const allNums = async () => (await Invoice.find({}).select('invoiceNumber').lean()).map(i => i.invoiceNumber);
const seqOf = n => Number(/US-(\d+)-/.exec(n)?.[1]);

(async () => {
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes().catch(()=>{})));

  // ══ 1. INDIVIDUAL: initial payment ═══════════════════════════════════════
  H('1. INDIVIDUAL — initial payment');
  const ind = await Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: pricing.individualPrice('1 Year Subscription Plan'),
    firstName: 'Ada', lastName: 'L', email: 'ada@ex.com',
    primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot', agreedToTerms: true,
  });
  let out = await userPays(ind, 'Individual', 'payment');
  ok(out.confirmRes?.body?.success === true, 'payment confirmed', out.failed || '');
  let indDoc = await Individual.findById(ind._id).lean();
  ok(indDoc.isPaid === true && indDoc.status === 'Active', 'plan is active');
  ok(indDoc.invoiceNumber === N(1), 'first invoice is US-1', indDoc.invoiceNumber);
  ok((await Invoice.countDocuments({ registrationId: ind._id })) === 1, 'exactly one invoice');
  const expiry1 = new Date(indDoc.expirationDate);
  ok(expiry1.getFullYear() === new Date().getFullYear() + 1, '1-Year expiry is +1 year', expiry1.toISOString().slice(0,10));

  // ══ 2. INDIVIDUAL renewal while still active → QUEUED ════════════════════
  H('2. INDIVIDUAL — renew while plan is still live (should QUEUE)');
  out = await userPays(ind, 'Individual', 'renewal', { newSubscriptionPlan: '1 Year Subscription Plan' });
  ok(out.confirmRes?.body?.success === true, 'renewal payment confirmed', out.failed || '');
  indDoc = await Individual.findById(ind._id).lean();
  ok(!!indDoc.nextRenewal?.paidAt, 'renewal is QUEUED (nextRenewal.paidAt set)');
  ok(new Date(indDoc.expirationDate).getTime() === expiry1.getTime(),
     'live expiry UNCHANGED while queued', indDoc.expirationDate);
  ok(indDoc.nextRenewal.invoiceNumber === N(2), 'renewal got the NEXT number US-2', indDoc.nextRenewal.invoiceNumber);
  ok(indDoc.invoiceNumber === N(1), 'base invoice pointer still US-1', indDoc.invoiceNumber);
  const ren2 = await Renewal.findOne({ registrationId: ind._id }).lean();
  ok(ren2?.status === 'queued', 'Renewal doc status is queued', ren2?.status);
  ok((await Invoice.countDocuments({ registrationId: ind._id })) === 2, 'two invoices now (base + renewal)');

  // ══ 3. CRON activates it once the plan lapses ════════════════════════════
  H('3. CRON — activates the queued renewal after expiry');
  const past = new Date(Date.now() - 24*60*60*1000);
  await Individual.findByIdAndUpdate(ind._id, { $set: { expirationDate: past } });
  await Renewal.findByIdAndUpdate(ren2._id, { $set: { activationDate: past } });
  await Individual.findByIdAndUpdate(ind._id, { $set: { 'nextRenewal.activationDate': past } });
  const cron = require('../cron/subscriptionReminder');
  await cron.activateMaturedRenewals();
  indDoc = await Individual.findById(ind._id).lean();
  const renAfter = await Renewal.findById(ren2._id).lean();
  ok(renAfter.status === 'active', 'Renewal doc promoted to active', renAfter.status);
  ok(!indDoc.nextRenewal?.paidAt, 'nextRenewal cleared after activation');
  ok(indDoc.lastRenewal?.invoiceNumber === N(2), 'lastRenewal records US-2', indDoc.lastRenewal?.invoiceNumber);
  ok(new Date(indDoc.expirationDate) > new Date(), 'expiry pushed into the future', indDoc.expirationDate);
  ok((await Invoice.countDocuments({ registrationId: ind._id })) === 2, 'still two invoices — none minted by the cron');

  // ══ 4. CRON safety: does NOT activate while the plan is still live ═══════
  H('4. CRON — refuses to activate while the current plan is still live');
  const ind4 = await Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: 69, firstName: 'B', lastName: 'C',
    email: 'b@ex.com', primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true, isPaid: true, status: 'Active',
    expirationDate: new Date(Date.now() + 90*24*60*60*1000),
  });
  await userPays(ind4, 'Individual', 'renewal', { newSubscriptionPlan: '1 Year Subscription Plan' });
  const ren4 = await Renewal.findOne({ registrationId: ind4._id }).lean();
  await Renewal.findByIdAndUpdate(ren4._id, { $set: { activationDate: past } });   // backdate only the renewal
  await cron.activateMaturedRenewals();
  const ren4After = await Renewal.findById(ren4._id).lean();
  ok(ren4After.status === 'queued', 'still queued — live plan protected', ren4After.status);

  // ══ 5. AIRLINE: initial + add holders + renew ════════════════════════════
  H('5. AIRLINE — initial payment, then ADD HOLDERS (holder-upgrade)');
  const ppc4 = pricing.airlinePricePerCert('1 Year Subscription Plan', 4);
  const air = await Airlines.create({
    subscriptionPlan: '1 Year Subscription Plan', pricePerCertificate: ppc4,
    airlineName: 'Beta Air', firstName: 'B', lastName: 'A', email: 'beta@ex.com',
    holderCount: '3 to 5', holderCountValue: '4', committedCount: 4, agreedToTerms: true,
  });
  out = await userPays(air, 'Airlines', 'payment');
  ok(out.confirmRes?.body?.success === true, 'airline initial payment confirmed', out.failed || '');
  let airDoc = await Airlines.findById(air._id).lean();
  ok(airDoc.isPaid === true, 'airline plan active');
  const baseInvNum = airDoc.invoiceNumber;

  out = await userPays(air, 'Airlines', 'holder-upgrade', { additionalHolderCount: 2 });
  ok(out.confirmRes?.body?.success === true, 'holder-upgrade confirmed', out.failed || '');
  airDoc = await Airlines.findById(air._id).lean();
  ok(airDoc.committedCount === 6, 'committedCount grew 4 -> 6', String(airDoc.committedCount));
  ok(airDoc.holderGroups.length === 1, 'a holder group was created', String(airDoc.holderGroups.length));
  const grp = airDoc.holderGroups[0];
  ok(grp.count === 2, 'group holds the 2 purchased slots', String(grp.count));
  ok(!!grp.invoiceNumber && grp.invoiceNumber !== baseInvNum,
     'group got its OWN invoice number, not the base one', `${grp.invoiceNumber} vs ${baseInvNum}`);
  const airInvs = await Invoice.find({ registrationId: air._id }).lean();
  ok(airInvs.length === 2, 'airline now has 2 invoices (base + upgrade)', String(airInvs.length));
  ok(airDoc.invoiceNumber === baseInvNum, 'base invoice pointer untouched by the upgrade');

  // ══ 6. Stacked tier pricing on the upgrade ═══════════════════════════════
  H('6. AIRLINE — upgrade priced at the STACKED tier');
  const expectedTierPpc = pricing.airlinePricePerCert('1 Year Subscription Plan', 6);
  ok(Number(grp.pricePerCert) === expectedTierPpc,
     `group per-cert = tier at 6 holders ($${grp.pricePerCert} vs $${expectedTierPpc})`);
  ok(Number(grp.amount) === expectedTierPpc * 2, `group amount = ppc x 2 ($${grp.amount})`);

  // ══ 7. AIRLINE upgrade to Unlimited (convert) ════════════════════════════
  H('7. AIRLINE — convert base plan to Unlimited (prorated)');
  const beforeConvertInvs = (await Invoice.countDocuments({ registrationId: air._id }));
  out = await userPays(air, 'Airlines', 'convert-unlimited', {});
  ok(out.confirmRes?.body?.success === true, 'conversion confirmed', out.failed || '');
  airDoc = await Airlines.findById(air._id).lean();
  ok(airDoc.subscriptionPlan === 'Unlimited Plan', 'base plan is now Unlimited', airDoc.subscriptionPlan);
  ok(airDoc.expirationDate == null, 'Unlimited has no expiry', String(airDoc.expirationDate));
  const afterConvertInvs = await Invoice.find({ registrationId: air._id }).lean();
  ok(afterConvertInvs.length === beforeConvertInvs + 1, 'conversion minted exactly one NEW invoice',
     `${beforeConvertInvs} -> ${afterConvertInvs.length}`);
  const convInv = afterConvertInvs.find(i => i.purpose === 'convert-unlimited');
  ok(!!convInv, 'conversion invoice tagged purpose=convert-unlimited');
  ok((convInv?.lineItems || []).length >= 2, 'conversion invoice is itemised (plan + credit)',
     String(convInv?.lineItems?.length));
  ok((convInv?.lineItems || []).some(li => Number(li.totalPrice) < 0), 'includes a negative credit line');
  ok(afterConvertInvs.some(i => i.invoiceNumber === baseInvNum), 'the ORIGINAL base invoice is preserved');

  // ══ 8. Invoice numbering integrity across every flow ═════════════════════
  H('8. INVOICE ALLOCATION — sequential, unique, no lost numbers');
  const nums = await allNums();
  const seqs = nums.map(seqOf).sort((a,b) => a-b);
  ok(new Set(nums).size === nums.length, `all ${nums.length} invoice numbers unique`);
  const ctr = await InvoiceCounter.findOne({}).lean();
  const maxSeq = Math.max(...seqs);
  const gaps = [];
  for (let i = 1; i <= maxSeq; i++) if (!seqs.includes(i)) gaps.push(i);
  const unaccounted = gaps.filter(g => !(ctr?.released || []).includes(g));
  ok(unaccounted.length === 0, 'no orphaned gaps — every hole is in the released pool',
     `gaps=${JSON.stringify(gaps)} released=${JSON.stringify(ctr?.released)}`);
  ok(ctr.sequence >= maxSeq, 'counter high-water >= highest issued', `${ctr.sequence} vs ${maxSeq}`);
  const nextNum = await svc.peekNextInvoiceNumber();
  ok(!nums.includes(nextNum), 'the next number to be issued is not already taken', nextNum);
  console.log(`     issued so far: ${seqs.map(s=>'US-'+s).join(', ')}  next: ${nextNum}`);

  // Every invoice must be backed by a payment or explicitly admin/wire
  const unbacked = (await Invoice.find({}).lean()).filter(i => !i.paymentId && !i.adminGenerated && !i.wirePending);
  ok(unbacked.length === 0, 'every invoice is backed by a payment', unbacked.map(i=>i.invoiceNumber).join(','));

  // ══ 9. CRON — invoice reclaim sweep ══════════════════════════════════════
  H('9. CRON — invoice number reclaim sweep');
  const burned = await svc.allocateInvoiceNumber();     // claimed but never used
  const beforeSweep = await svc.peekNextInvoiceNumber();
  ok(beforeSweep !== burned, 'the burned number is out of circulation before the sweep', `${burned} / ${beforeSweep}`);
  const sweep = await cron.reclaimInvoiceNumbers();
  const afterSweep = await svc.peekNextInvoiceNumber();
  ok(afterSweep === burned, 'the sweep returns it to circulation', `${afterSweep} vs ${burned}`);
  ok(Array.isArray(sweep.released), 'sweep reports the released pool', JSON.stringify(sweep.released));

  // ══ 10. AIRLINE base renewal ═════════════════════════════════════════════
  H('10. AIRLINE — renew the BASE plan');
  const ppcR = pricing.airlinePricePerCert('1 Year Subscription Plan', 4);
  const airR = await Airlines.create({
    subscriptionPlan: '1 Year Subscription Plan', pricePerCertificate: ppcR,
    airlineName: 'Renew Air', firstName: 'R', lastName: 'A', email: 'renew@ex.com',
    holderCount: '3 to 5', holderCountValue: '4', committedCount: 4, agreedToTerms: true,
    isPaid: true, status: 'Active', paymentStatus: 'paid',
    subscriptionDate: new Date(Date.now() - 300*24*3600*1000),
    expirationDate:   new Date(Date.now() + 20*24*3600*1000),   // inside the renewal window
    invoiceNumber: 'SEED-BASE',
  });
  const beforeR = await Invoice.countDocuments({ registrationId: airR._id });
  out = await userPays(airR, 'Airlines', 'renewal', { newSubscriptionPlan: '1 Year Subscription Plan' });
  ok(out.confirmRes?.body?.success === true, 'airline renewal confirmed', out.failed || '');
  let airRDoc = await Airlines.findById(airR._id).lean();
  ok(!!airRDoc.nextRenewal?.paidAt, 'renewal QUEUED (plan still live)');
  ok(!!airRDoc.nextRenewal?.invoiceNumber, 'queued renewal has its own invoice number', airRDoc.nextRenewal?.invoiceNumber);
  ok(airRDoc.nextRenewal.invoiceNumber !== 'SEED-BASE', 'renewal did NOT reuse the base invoice number');
  ok((await Invoice.countDocuments({ registrationId: airR._id })) === beforeR + 1,
     'exactly one new invoice for the renewal');

  // ══ 11. AIRLINE holder-GROUP renewal ═════════════════════════════════════
  H('11. AIRLINE — renew ONE add-on holder group independently');
  const airG = await Airlines.create({
    subscriptionPlan: 'Unlimited Plan', pricePerCertificate: pricing.airlinePricePerCert('Unlimited Plan', 3),
    airlineName: 'Group Air', firstName: 'G', lastName: 'A', email: 'grp@ex.com',
    holderCount: '3 to 5', holderCountValue: '3', committedCount: 5, agreedToTerms: true,
    isPaid: true, status: 'Active', paymentStatus: 'paid', subscriptionDate: new Date(),
    holderGroups: [{
      plan: '1 Year Subscription Plan', count: 2,
      pricePerCert: pricing.airlinePricePerCert('1 Year Subscription Plan', 5),
      amount: pricing.airlinePricePerCert('1 Year Subscription Plan', 5) * 2,
      paymentStatus: 'paid', isActive: true,
      subscriptionDate: new Date(Date.now() - 340*24*3600*1000),
      expirationDate:   new Date(Date.now() + 20*24*3600*1000),
      invoiceNumber: 'SEED-GROUP',
    }],
  });
  const gid = String((await Airlines.findById(airG._id).lean()).holderGroups[0]._id);
  const beforeG = await Invoice.countDocuments({ registrationId: airG._id });
  out = await userPays(airG, 'Airlines', 'renewal', { holderGroupId: gid, newSubscriptionPlan: '1 Year Subscription Plan' });
  ok(out.confirmRes?.body?.success === true, 'group renewal confirmed', out.failed || '');
  const airGDoc = await Airlines.findById(airG._id).lean();
  const g2 = airGDoc.holderGroups[0];
  ok(!!g2.nextRenewal?.paidAt, 'the GROUP has its own queued renewal');
  ok(airGDoc.subscriptionPlan === 'Unlimited Plan', 'the BASE plan was not touched', airGDoc.subscriptionPlan);
  ok(!airGDoc.nextRenewal?.paidAt, 'no base-level renewal was queued');
  ok((await Invoice.countDocuments({ registrationId: airG._id })) === beforeG + 1,
     'exactly one new invoice for the group renewal');

  // ══ 12. CRON — group renewal activation ══════════════════════════════════
  H('12. CRON — activates a matured GROUP renewal');
  const pastG = new Date(Date.now() - 24*3600*1000);
  await Airlines.updateOne({ _id: airG._id }, { $set: {
    'holderGroups.0.expirationDate': pastG,
    'holderGroups.0.nextRenewal.activationDate': pastG,
  }});
  await cron.activateMaturedGroupRenewals();
  const airGAfter = await Airlines.findById(airG._id).lean();
  const g3 = airGAfter.holderGroups[0];
  ok(!g3.nextRenewal?.paidAt, 'group nextRenewal cleared after activation');
  ok(new Date(g3.expirationDate) > new Date(), 'group expiry pushed forward', String(g3.expirationDate));
  ok((await Invoice.countDocuments({ registrationId: airG._id })) === beforeG + 1,
     'cron minted NO extra invoice');

  // ══ 13. CRON — expiry reminders ══════════════════════════════════════════
  H('13. CRON — expiry reminder targeting');
  // Assert on the DB stamp rather than the mailer: cron/subscriptionReminder.js
  // destructures sendExpiryReminder at module load, so re-stubbing it here would
  // not intercept anything. The `expiryReminder30SentAt` stamp is the durable,
  // observable side-effect of a reminder actually being sent.
  const soon = new Date(Date.now() + 30*24*3600*1000);
  await Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: 69, firstName: 'Expiring', lastName: 'Soon',
    email: 'exp@ex.com', primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true, status: 'Active', isPaid: true, expirationDate: soon,
  });
  await Individual.create({   // must be SKIPPED: already renewed
    subscriptionPlan: '1 Year Subscription Plan', price: 69, firstName: 'Already', lastName: 'Renewed',
    email: 'renewed@ex.com', primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true, status: 'Active', isPaid: true, expirationDate: soon,
    nextRenewal: { paidAt: new Date(), plan: '1 Year Subscription Plan' },
  });
  await Individual.create({   // must be SKIPPED: Unlimited never expires
    subscriptionPlan: 'Unlimited Plan', price: 299, firstName: 'Never', lastName: 'Expires',
    email: 'unl@ex.com', primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true, status: 'Active', isPaid: true,
  });
  await cron.runReminders();
  const stamped = async (email) => {
    const d = await Individual.findOne({ email }).lean();
    return !!d?.expiryReminder30SentAt;
  };
  ok(await stamped('exp@ex.com'), 'reminder sent to the plan expiring in 30 days');
  ok(!(await stamped('renewed@ex.com')), 'NO reminder to someone who already renewed');
  ok(!(await stamped('unl@ex.com')), 'NO reminder for an Unlimited plan');

  // Re-running the same day must not double-send (20-day cooldown).
  await cron.runReminders();
  const expDoc = await Individual.findOne({ email: 'exp@ex.com' }).lean();
  const firstStamp = expDoc.expiryReminder30SentAt;
  await cron.runReminders();
  const expDoc2 = await Individual.findOne({ email: 'exp@ex.com' }).lean();
  ok(new Date(expDoc2.expiryReminder30SentAt).getTime() === new Date(firstStamp).getTime(),
     'cooldown prevents a repeat reminder on a second run');

  console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(76)}`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
