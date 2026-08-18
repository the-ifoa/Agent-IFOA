/**
 * verifyInvoices.js
 *
 * Behavioural test suite for the invoice number allocator (invoiceNumberService)
 * and the invoice store (invoiceStore). Covers the four defects this subsystem
 * was rebuilt to fix:
 *
 *   - concurrent allocation handing out the same number (the scan-then-write race)
 *   - a deleted invoice number never being reused
 *   - an invoice being issued for a payment that never settled
 *   - admin edits and customer views reading different stores
 *
 * Usage:
 *   node scripts/verifyInvoices.js
 *   TEST_MONGO_URI=mongodb://host/db node scripts/verifyInvoices.js
 *
 * SAFETY: runs against a dedicated scratch database and DROPS it at both ends.
 * It refuses to start if the target matches MONGO_URI from .env.
 */
process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
require('dotenv').config();
const mongoose = require('mongoose');

const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_invoice_test';

// Never let this suite point at real data — it drops the database it connects to.
if (process.env.MONGO_URI && process.env.MONGO_URI.trim() === TEST_URI.trim()) {
  console.error('Refusing to run: TEST_MONGO_URI is the same as MONGO_URI. Use a scratch database.');
  process.exit(2);
}

const svc   = require('../services/invoiceNumberService');
const store = require('../services/invoiceStore');
const InvoiceCounter = require('../models/InvoiceCounter');
const Invoice        = require('../models/Invoice');
const Payment        = require('../models/Payment');
const Individual     = require('../models/Individual');
const Renewal        = require('../models/Renewal');

let pass = 0, fail = 0;
const ok = (cond, label, extra='') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};

const YEAR = new Date().getFullYear();
const yy = String(YEAR).slice(-2);
const N = (n) => `Invoice US-${n}-${yy}`;

async function reset() {
  await Promise.all([
    InvoiceCounter.deleteMany({}), Invoice.deleteMany({}),
    Payment.deleteMany({}), Individual.deleteMany({}),
    Renewal.deleteMany({}),
  ]);
}

async function mkIndividual() {
  return Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: 69,
    firstName: 'Test', lastName: 'User', email: `t${Date.now()}${Math.random()}@example.com`,
    primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot',
    agreedToTerms: true,
  });
}

async function mkPaidPayment(regId, invoiceNumber, amount = 69) {
  // Payment.invoiceNumber is required+unique, so a payment always carries one at
  // creation time; the store reuses it rather than allocating a second.
  const num = invoiceNumber || await svc.allocateInvoiceNumber();
  return Payment.create({
    stripePaymentIntentId: 'pi_test_' + Math.random().toString(36).slice(2),
    status: 'succeeded', isPaid: true, paidAt: new Date(),
    amountCents: amount * 100, amountDollars: amount,
    registrationId: regId, registrationModel: 'Individual',
    invoiceNumber: num,
  });
}

(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes().catch(()=>{})));
  console.log(`connected to scratch db: ${TEST_URI}\n`);

  // ── 1. Sequential allocation ────────────────────────────────────────────────
  console.log('1) sequential allocation');
  await reset();
  const a = [];
  for (let i = 0; i < 5; i++) a.push(await svc.allocateInvoiceNumber());
  ok(JSON.stringify(a) === JSON.stringify([N(1),N(2),N(3),N(4),N(5)]),
     'allocates 1..5 in order', JSON.stringify(a));

  // ── 2. Concurrency: no duplicates under parallel load ───────────────────────
  console.log('\n2) concurrent allocation (the old scan-then-write race)');
  await reset();
  const conc = await Promise.all(Array.from({length: 50}, () => svc.allocateInvoiceNumber()));
  const uniq = new Set(conc);
  ok(uniq.size === 50, `50 parallel allocations yield 50 distinct numbers`, `got ${uniq.size}`);
  const seqs = conc.map(n => svc.parseInvoiceNumber(n).sequence).sort((x,y)=>x-y);
  ok(JSON.stringify(seqs) === JSON.stringify(Array.from({length:50},(_,i)=>i+1)),
     'they form an unbroken 1..50 run (no gaps burned)');

  // ── 3. Release + reuse (the reported bug) ───────────────────────────────────
  console.log('\n3) released numbers are handed back out');
  await reset();
  for (let i = 0; i < 5; i++) await svc.allocateInvoiceNumber();
  ok(await svc.releaseInvoiceNumber(N(2)) === true, 'release US-2 succeeds');
  ok(await svc.releaseInvoiceNumber(N(4)) === true, 'release US-4 succeeds');
  const r1 = await svc.allocateInvoiceNumber();
  const r2 = await svc.allocateInvoiceNumber();
  const r3 = await svc.allocateInvoiceNumber();
  ok(r1 === N(2), 'next allocation reuses the LOWEST free number (US-2)', r1);
  ok(r2 === N(4), 'then the next free one (US-4)', r2);
  ok(r3 === N(6), 'then advances past the high-water mark (US-6)', r3);

  // ── 4. A number still in use cannot be released ─────────────────────────────
  console.log('\n4) release refuses numbers still referenced');
  await reset();
  const ind = await mkIndividual();
  await mkPaidPayment(ind._id, N(1));
  ok(await svc.releaseInvoiceNumber(N(1)) === false,
     'refuses to free a number a Payment still carries');

  // ── 5. peek does not consume ────────────────────────────────────────────────
  console.log('\n5) peek never burns a sequence');
  await reset();
  const p1 = await svc.peekNextInvoiceNumber();
  const p2 = await svc.peekNextInvoiceNumber();
  const p3 = await svc.allocateInvoiceNumber();
  ok(p1 === p2 && p2 === p3, 'peek is stable and matches the next allocation', `${p1}/${p2}/${p3}`);

  // ── 6. Issuance requires settled money ──────────────────────────────────────
  console.log('\n6) an invoice is never issued for an unsettled payment');
  await reset();
  const ind6 = await mkIndividual();
  const unpaid = await Payment.create({
    stripePaymentIntentId: 'pi_unpaid_' + Math.random().toString(36).slice(2),
    status: 'pending', isPaid: false,
    amountCents: 6900, amountDollars: 69,
    registrationId: ind6._id, registrationModel: 'Individual',
    invoiceNumber: N(999),
  });
  let threw = null;
  try {
    await store.issueInvoice({
      registrationId: ind6._id, registrationModel: 'Individual',
      paymentId: unpaid._id, amountDollars: 69,
    });
  } catch (e) { threw = e.message; }
  ok(threw && /has not succeeded/.test(threw), 'refuses to issue against a pending payment', threw || 'no throw');
  ok(await Invoice.countDocuments({}) === 0, 'no invoice document was created');

  let threw2 = null;
  try {
    await store.issueInvoice({ registrationId: ind6._id, registrationModel: 'Individual', amountDollars: 69 });
  } catch (e) { threw2 = e.message; }
  ok(threw2 && /no proof of payment/.test(threw2), 'refuses to issue with no basis at all', threw2 || 'no throw');

  const before = await svc.peekNextInvoiceNumber();
  try { await store.issueInvoice({ registrationId: ind6._id, registrationModel: 'Individual', amountDollars: 69 }); } catch {}
  const after = await svc.peekNextInvoiceNumber();
  ok(before === after, 'a refused issuance burns no invoice number', `${before} -> ${after}`);

  // ── 7. Idempotency: confirm + webhook racing on one payment ─────────────────
  console.log('\n7) confirm and webhook racing produce ONE invoice');
  await reset();
  const ind7 = await mkIndividual();
  const pay7 = await mkPaidPayment(ind7._id, null);
  const both = await Promise.allSettled([
    store.issueInvoice({ registrationId: ind7._id, registrationModel: 'Individual', paymentId: pay7._id, amountDollars: 69, paidAt: new Date() }),
    store.issueInvoice({ registrationId: ind7._id, registrationModel: 'Individual', paymentId: pay7._id, amountDollars: 69, paidAt: new Date() }),
  ]);
  const okCount = both.filter(r => r.status === 'fulfilled').length;
  const invCount = await Invoice.countDocuments({ paymentId: pay7._id });
  ok(invCount === 1, 'exactly one invoice document exists for the payment', `got ${invCount}, ${okCount} calls succeeded`);

  // ── 8. Delete frees the number for reuse ────────────────────────────────────
  console.log('\n8) deleting an invoice frees its number (end to end)');
  await reset();
  const ind8 = await mkIndividual();
  const pay8 = await mkPaidPayment(ind8._id, null);
  const inv8 = await store.issueInvoice({
    registrationId: ind8._id, registrationModel: 'Individual',
    paymentId: pay8._id, amountDollars: 69, paidAt: new Date(),
    snapshot: { name: 'Test User', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 69 },
  });
  const issued = inv8.invoiceNumber;
  ok(issued === N(1), 'first invoice gets US-1', issued);
  const nextBefore = await svc.allocateInvoiceNumber();
  ok(nextBefore === N(2), 'a second invoice would get US-2', nextBefore);
  const del = await store.deleteByNumber(issued);
  ok(del.released === true, 'deleting US-1 releases it');
  const reissued = await svc.allocateInvoiceNumber();
  ok(reissued === N(1), 'the very next allocation reuses US-1', reissued);
  ok(await Payment.countDocuments({ invoiceNumber: issued }) === 0, 'the payment mirror was cleared');
  const reg8 = await Individual.findById(ind8._id).lean();
  ok(!reg8.invoiceNumber, 'the registration mirror was cleared', String(reg8.invoiceNumber));

  // ── 9. Reconcile rebuilds from live data ────────────────────────────────────
  console.log('\n9) reconcile recovers gaps left by anything else');
  await reset();
  const ind9 = await mkIndividual();
  await mkPaidPayment(ind9._id, N(3));
  await mkPaidPayment(ind9._id, N(7));
  const rec = await svc.reconcileInvoiceSequences();
  ok(rec.sequence === 7, 'high-water mark set to the highest number in use', String(rec.sequence));
  ok(JSON.stringify(rec.released) === JSON.stringify([1,2,4,5,6]),
     'every gap below it is marked free', JSON.stringify(rec.released));
  const next9 = await svc.allocateInvoiceNumber();
  ok(next9 === N(1), 'allocation then starts filling gaps from the lowest', next9);

  // ── 10. Admin edit is visible to the customer (one document) ────────────────
  console.log('\n10) an admin edit lands where the customer reads');
  await reset();
  const ind10 = await mkIndividual();
  const pay10 = await mkPaidPayment(ind10._id, null);
  const inv10 = await store.issueInvoice({
    registrationId: ind10._id, registrationModel: 'Individual',
    paymentId: pay10._id, amountDollars: 69, paidAt: new Date(),
    snapshot: { name: 'Original Name', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 69 },
  });
  await store.saveAdminDraft({
    invoiceId: inv10._id,
    draft: { recipientName: 'Edited By Admin', lineItems: [{ description: 'Edited line', quantity: 1, unitPrice: 123, totalPrice: 123 }] },
  });
  const { invoices: customerView } = await store.listForRegistration(ind10._id, { isAdmin: false });
  ok(customerView.length === 1, 'customer sees exactly one invoice', String(customerView.length));
  ok(customerView[0].draft.recipientName === 'Edited By Admin', "customer sees the admin's edited name");
  ok(customerView[0].totalAmount === 123, "customer sees the admin's edited total", String(customerView[0].totalAmount));
  const adminView = await store.listAll();
  ok(adminView.length === 1 && adminView[0].totalAmount === 123, 'admin dashboard shows the same figures');
  const payMirror = await Payment.findById(pay10._id).lean();
  ok(payMirror.invoiceDraft?.recipientName === 'Edited By Admin', 'the payment mirror was updated too');

  // ── 11. Backfill surfaces already-assigned numbers to the admin ─────────────
  console.log('\n11) an invoice number assigned to a customer shows in the admin dashboard');
  await reset();
  const ind11 = await mkIndividual();
  // A legacy customer that carries a number with no Invoice document at all.
  await Individual.findByIdAndUpdate(ind11._id, {
    $set: { invoiceNumber: N(42), paymentStatus: 'paid', price: 69, subscriptionPlan: '1 Year Subscription Plan' },
  });
  ok((await store.listAll()).length === 0, 'before backfill the admin dashboard is empty');
  const bf = await store.backfillLegacyInvoices();
  ok(bf.created === 1, 'backfill materialises it', JSON.stringify(bf.invoiceNumbers));
  const adminRows = await store.listAll();
  ok(adminRows.length === 1 && adminRows[0].invoiceNumber === N(42),
     'the admin dashboard now shows the number already assigned to the customer');
  ok(adminRows[0].status === 'paid', 'with its live paid status', adminRows[0].status);
  ok(adminRows[0].totalAmount === 69, 'and the correct amount', String(adminRows[0].totalAmount));
  const bf2 = await store.backfillLegacyInvoices();
  ok(bf2.created === 0, 'backfill is idempotent on a second run');

  // ── 12. Previously-deleted invoices stay deleted (migration safety) ─────────
  console.log('\n12) an invoice an admin already deleted is NOT resurrected');
  await reset();
  const ind12 = await mkIndividual();
  // Reproduce pre-refactor state: the Invoice doc was removed, the paid Payment
  // row still carries the number, and the number is on hiddenInvoiceNumbers.
  await mkPaidPayment(ind12._id, N(5));
  await Individual.findByIdAndUpdate(ind12._id, {
    $set: { hiddenInvoiceNumbers: [N(5)] },
  });
  const bf12 = await store.backfillLegacyInvoices();
  ok(bf12.created === 0, 'backfill creates nothing for it', JSON.stringify(bf12.invoiceNumbers));
  ok(bf12.skippedHidden === 1, 'and reports it as deliberately left deleted', String(bf12.skippedHidden));
  const cust12 = await store.listForRegistration(ind12._id, { isAdmin: false });
  ok(cust12.invoices.length === 0, 'the customer does not see it come back', String(cust12.invoices.length));
  ok(cust12.hidden.includes(N(5)), 'the hidden list is reported back to the client');
  ok((await store.listAll()).length === 0, 'the admin dashboard does not show it either');

  // ── 13. Boot backfill never deletes ─────────────────────────────────────────
  console.log('\n13) the boot path is additive only');
  await reset();
  const ind13 = await mkIndividual();
  const pay13a = await mkPaidPayment(ind13._id, N(1));
  // Simulate a pre-refactor database: the unique index does not exist yet, so the
  // legacy confirm-vs-webhook duplicate can be written.
  await Invoice.collection.dropIndex('paymentId_unique').catch(() => {});
  // Two invoices on one payment: exactly the legacy duplicate the index forbids.
  await Invoice.create({ invoiceNumber: N(1), paymentId: pay13a._id, registrationId: ind13._id, registrationModel: 'Individual', totalAmount: 69 });
  await Invoice.create({ invoiceNumber: N(2), paymentId: pay13a._id, registrationId: ind13._id, registrationModel: 'Individual', totalAmount: 69 });
  const before13 = await Invoice.countDocuments({});
  await store.backfillLegacyInvoices({ dedupe: false });
  ok(await Invoice.countDocuments({}) === before13, 'default backfill deleted nothing', String(before13));
  const bf13 = await store.backfillLegacyInvoices({ dedupe: true });
  ok(bf13.deduped === 1, 'explicit dedupe collapses the duplicate', String(bf13.deduped));
  ok(await Invoice.countDocuments({ paymentId: pay13a._id }) === 1, 'one invoice remains for the payment');

  // ── 14. A claimed-but-unattached number is not stranded ─────────────────────
  // This is the "US-24 is missing and the customer got US-25" defect: a number was
  // claimed, the flow did not attach it, and nothing handed it back — so the
  // allocator skipped past it forever.
  console.log('\n14) a number claimed but never attached is recoverable');
  await reset();
  for (let i = 0; i < 3; i++) await svc.allocateInvoiceNumber();   // US-1..3
  const ind14 = await mkIndividual();
  await mkPaidPayment(ind14._id, N(1));
  await mkPaidPayment(ind14._id, N(3));
  // US-2 was claimed but never landed on any record — exactly the leak.
  let ctr14 = await InvoiceCounter.findOne({ year: YEAR }).lean();
  ok((ctr14.released || []).length === 0, 'the allocator does not know US-2 is free');
  ok(await svc.peekNextInvoiceNumber() === N(4), 'so it would skip to US-4', await svc.peekNextInvoiceNumber());
  const swept = await svc.reconcileInvoiceSequences();
  ok(JSON.stringify(swept.released) === JSON.stringify([2]), 'the sweep reclaims US-2', JSON.stringify(swept.released));
  ok(await svc.allocateInvoiceNumber() === N(2), 'the next allocation reuses US-2');

  // ── 15. Explicit release beats waiting for the sweep ────────────────────────
  console.log('\n15) the payment paths hand a claim back immediately');
  await reset();
  const a1 = await svc.allocateInvoiceNumber();   // US-1
  const a2 = await svc.allocateInvoiceNumber();   // US-2 — pretend this one lost a race
  ok(a1 === N(1) && a2 === N(2), 'two numbers claimed');
  ok(await svc.releaseInvoiceNumber(a2) === true, 'the loser releases its claim');
  ok(await svc.peekNextInvoiceNumber() === N(2), 'US-2 is immediately available again — no sweep needed', await svc.peekNextInvoiceNumber());
  const reused = await svc.allocateInvoiceNumber();
  ok(reused === N(2), 'and the next claim gets it', reused);

  // ── 16. A renewal must not burn a number on its own Renewal doc ─────────────
  console.log('\n16) a renewal reuses its own number instead of allocating a second');
  await reset();
  const ind16 = await mkIndividual();
  const pay16 = await mkPaidPayment(ind16._id, null);          // claims US-1
  // applyRenewalToRegistration writes a Renewal row carrying the SAME number.
  await Renewal.create({
    registrationId: ind16._id, registrationModel: 'Individual', paymentId: pay16._id,
    invoiceNumber: pay16.invoiceNumber, plan: '1 Year Subscription Plan',
    price: 69, paidAt: new Date(), activationDate: new Date(), status: 'queued',
  });
  const inv16 = await store.issueInvoice({
    registrationId: ind16._id, registrationModel: 'Individual', paymentId: pay16._id,
    amountDollars: 69, paidAt: new Date(), purpose: 'renewal',
    existingInvoiceNumber: pay16.invoiceNumber,
    snapshot: { name: 'Test', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 69 },
  });
  ok(inv16.invoiceNumber === pay16.invoiceNumber,
     "the invoice keeps the payment's number", `${inv16.invoiceNumber} vs ${pay16.invoiceNumber}`);
  ok(await svc.peekNextInvoiceNumber() === N(2),
     'no second number was burned', await svc.peekNextInvoiceNumber());

  // ── 17. Cancelling a queued renewal frees its number ────────────────────────
  console.log('\n17) cancelling a queued renewal returns its number to the pool');
  await reset();
  const ind17 = await mkIndividual();
  const pay17 = await mkPaidPayment(ind17._id, null);          // US-1
  const inv17 = await store.issueInvoice({
    registrationId: ind17._id, registrationModel: 'Individual', paymentId: pay17._id,
    amountDollars: 220, paidAt: new Date(), purpose: 'renewal',
    existingInvoiceNumber: pay17.invoiceNumber,
    snapshot: { name: 'Test', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 220 },
  });
  await Individual.findByIdAndUpdate(ind17._id, {
    $set: { 'nextRenewal.invoiceNumber': inv17.invoiceNumber, 'nextRenewal.paidAt': new Date() },
  });
  await store.deleteByNumber(inv17.invoiceNumber);
  ok(await Payment.countDocuments({ invoiceNumber: inv17.invoiceNumber }) === 0, 'the payment row is gone');
  ok(await svc.peekNextInvoiceNumber() === N(1),
     'the number is immediately reusable', await svc.peekNextInvoiceNumber());

  // ── 18. A stale mirror does not hold a number hostage ───────────────────────
  console.log('\n18) a dangling mirror pointer is cleared and its number freed');
  await reset();
  const ind18 = await mkIndividual();
  await mkPaidPayment(ind18._id, N(1));
  for (let i = 0; i < 2; i++) await svc.allocateInvoiceNumber();   // burn US-2, US-3
  // US-2 survives only as a lastRenewal pointer — the exact renewal artefact.
  await Individual.findByIdAndUpdate(ind18._id, { $set: { 'lastRenewal.invoiceNumber': N(2) } });
  await svc.reconcileInvoiceSequences();
  ok(await svc.peekNextInvoiceNumber() !== N(2),
     'while the pointer exists US-2 stays out of circulation', await svc.peekNextInvoiceNumber());
  const staleRes = await store.clearStaleMirrors();
  ok(staleRes.cleared === 1, 'the stale pointer is detected', JSON.stringify(staleRes));
  const reg18 = await Individual.findById(ind18._id).lean();
  ok(!reg18.lastRenewal?.invoiceNumber, 'and cleared from the registration');
  await svc.reconcileInvoiceSequences();
  ok(await svc.peekNextInvoiceNumber() === N(2),
     'US-2 is back in circulation', await svc.peekNextInvoiceNumber());

  // ── 19. A LIVE mirror is never cleared ──────────────────────────────────────
  console.log('\n19) a mirror backed by real money is left alone');
  await reset();
  const ind19 = await mkIndividual();
  const pay19 = await mkPaidPayment(ind19._id, N(1));
  await Individual.findByIdAndUpdate(ind19._id, { $set: { invoiceNumber: N(1), 'lastRenewal.invoiceNumber': N(1) } });
  const keep = await store.clearStaleMirrors();
  ok(keep.cleared === 0, 'nothing cleared', JSON.stringify(keep));
  const reg19 = await Individual.findById(ind19._id).lean();
  ok(reg19.invoiceNumber === N(1) && reg19.lastRenewal.invoiceNumber === N(1), 'both pointers intact');
  void pay19;

  // ── 20. Renaming a renewal's number keeps every surface in step ─────────────
  console.log('\n20) an admin rename updates the invoice, not just the mirrors');
  await reset();
  const ind20 = await mkIndividual();
  const pay20 = await mkPaidPayment(ind20._id, null);            // US-1
  const inv20 = await store.issueInvoice({
    registrationId: ind20._id, registrationModel: 'Individual', paymentId: pay20._id,
    amountDollars: 220, paidAt: new Date(), purpose: 'renewal',
    existingInvoiceNumber: pay20.invoiceNumber,
    snapshot: { name: 'T', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 220 },
  });
  await Individual.findByIdAndUpdate(ind20._id, {
    $set: { 'nextRenewal.invoiceNumber': inv20.invoiceNumber, 'nextRenewal.paidAt': new Date() },
  });
  await svc.allocateInvoiceNumber();                              // US-2 taken
  const target = N(9);                                            // admin picks a free number
  await store.saveAdminDraft({ invoiceId: inv20._id, invoiceNumber: target });
  const after20 = await Invoice.findById(inv20._id).lean();
  ok(after20.invoiceNumber === target, 'the invoice document is renamed', after20.invoiceNumber);
  const payAfter20 = await Payment.findById(pay20._id).lean();
  ok(payAfter20.invoiceNumber === target, 'the payment mirror follows', payAfter20.invoiceNumber);
  const reg20 = await Individual.findById(ind20._id).lean();
  ok(reg20.nextRenewal.invoiceNumber === target, 'the queued-renewal mirror follows', reg20.nextRenewal.invoiceNumber);
  const adminRows20 = await store.listAll();
  ok(adminRows20.some(r => r.invoiceNumber === target) && !adminRows20.some(r => r.invoiceNumber === N(1)),
     'the admin dashboard shows only the new number');
  ok(await svc.peekNextInvoiceNumber() === N(1), 'the old number is released for reuse', await svc.peekNextInvoiceNumber());

  // ── 21. Voiding keeps the record and retires the number ─────────────────────
  console.log('\n21) a settled invoice is voided, never deleted');
  await reset();
  const ind21 = await mkIndividual();
  const pay21 = await mkPaidPayment(ind21._id, null);            // US-1
  const inv21 = await store.issueInvoice({
    registrationId: ind21._id, registrationModel: 'Individual', paymentId: pay21._id,
    amountDollars: 220, paidAt: new Date(), purpose: 'renewal',
    existingInvoiceNumber: pay21.invoiceNumber,
    snapshot: { name: 'T', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 220 },
  });
  const vres = await store.voidByNumber(inv21.invoiceNumber, { reason: 'cancelled by admin' });
  ok(vres.voided === 1, 'the invoice is voided', JSON.stringify(vres));
  const after21 = await Invoice.findById(inv21._id).lean();
  ok(after21 && after21.status === 'void', 'the record still exists, marked void', after21?.status);
  ok(!!after21.voidedAt, 'with a voided timestamp');
  ok(await Payment.countDocuments({ _id: pay21._id }) === 1, 'the payment record is PRESERVED');
  ok(await svc.releaseInvoiceNumber(inv21.invoiceNumber) === false, 'the number cannot be released');
  ok(await svc.peekNextInvoiceNumber() === N(2), 'so the next invoice moves on', await svc.peekNextInvoiceNumber());
  const rows21 = await store.listAll();
  ok(rows21.length === 1 && rows21[0].status === 'void',
     'the admin still sees it, marked void', JSON.stringify(rows21.map(r => r.status)));

  // ── 22. Deleting a customer keeps invoices and retires their numbers ────────
  console.log('\n22) deleting a customer retains invoices and retires their numbers');
  await reset();
  const ind22 = await mkIndividual();
  const pay22 = await mkPaidPayment(ind22._id, null);            // US-1
  const inv22 = await store.issueInvoice({
    registrationId: ind22._id, registrationModel: 'Individual', paymentId: pay22._id,
    amountDollars: 69, paidAt: new Date(),
    snapshot: { name: 'Ada Lovelace', email: 'ada@example.com', subscriptionPlan: '1 Year Subscription Plan', totalPaid: 69 },
  });
  await store.markRegistrationDeleted(ind22._id);
  await Individual.findByIdAndDelete(ind22._id);

  const after22 = await Invoice.findById(inv22._id).lean();
  ok(!!after22, 'the invoice survives the customer being deleted');
  ok(after22.orphaned === true, 'and is flagged orphaned');
  ok(after22.recipientName === 'Ada Lovelace', 'the recipient is still readable from the invoice itself', after22.recipientName);
  ok(await svc.releaseInvoiceNumber(inv22.invoiceNumber) === false,
     'the number is NOT released — it was genuinely issued');
  await svc.reconcileInvoiceSequences();
  ok(await svc.peekNextInvoiceNumber() === N(2),
     'and a reconcile never hands it out again', await svc.peekNextInvoiceNumber());
  const rows22 = await store.listAll();
  ok(rows22.length === 1 && rows22[0].orphaned === true,
     'the admin dashboard shows it flagged, not broken');

  console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
