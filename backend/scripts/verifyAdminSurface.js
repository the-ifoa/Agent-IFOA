#!/usr/bin/env node
/**
 * verifyAdminSurface.js
 *
 * Round-trip audit of the ADMIN side: does what the admin API returns actually
 * match the database, and does an admin action show up correctly on the next read?
 *
 * Drives the real controllers against a scratch database with the mailer stubbed:
 *   - the airline + individual list endpoints mirror stored values
 *   - mark-paid propagates to the list, the invoice dashboard and the Invoice doc
 *   - an invoice status flip updates paymentStatus but NEVER the plan's isPaid
 *   - voided and orphaned invoices stay visible, correctly flagged
 *   - the notifications feed is populated and excludes deleted customers
 *
 * Usage:  node scripts/verifyAdminSurface.js
 */
process.env.JWT_SECRET = 'x'.repeat(24);
const TEST_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/ifoa_admin_test';
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

const emailService = require('../services/emailService');
for (const fn of Object.keys(emailService)) {
  if (typeof emailService[fn] === 'function' && /^send/.test(fn)) emailService[fn] = async () => {};
}

const mongoose = require('mongoose');
const Individual = require('../models/Individual');
const Airlines   = require('../models/Airlines');
const Invoice    = require('../models/Invoice');
const Payment    = require('../models/Payment');
const User       = require('../models/User');

const airlinesCtrl   = require('../controller/airlinesController');
const individualCtrl = require('../controller/individualController');
const paymentCtrl    = require('../controller/paymentController');
const invoiceStore   = require('../services/invoiceStore');
const pricing        = require('../shared/pricing');

let pass = 0, fail = 0;
const ok = (c, l, e='') => { if (c) { pass++; console.log(`  PASS  ${l}`); } else { fail++; console.log(`  FAIL  ${l} ${e}`); } };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let admin = { role: 'admin', id: null, email: 'admin@ex.com' };  // id filled from a real User below
const mkRes = () => { const r = { statusCode: 200, body: null };
  r.status = c => { r.statusCode = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const call = async (fn, req) => { const r = mkRes(); await fn({ user: admin, params: {}, query: {}, body: {}, ...req }, r); return r; };

(async () => {
  await mongoose.connect(TEST_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes().catch(()=>{})));

  // A real admin User: several admin endpoints resolve req.user.id against the DB.
  const adminUser = await User.create({ email: 'admin@ex.com', password: 'p'.repeat(12), role: 'admin' });
  admin = { role: 'admin', id: String(adminUser._id), email: adminUser.email };

  // ══ 1. Airline list: API == DB ═══════════════════════════════════════════
  H('1. ADMIN AIRLINE LIST — does the API mirror the DB?');
  const ppc = pricing.airlinePricePerCert('1 Year Subscription Plan', 4);
  const air = await Airlines.create({
    subscriptionPlan: '1 Year Subscription Plan', pricePerCertificate: ppc,
    airlineName: 'Alpha Air', firstName: 'Al', lastName: 'P', email: 'alpha@ex.com',
    holderCount: '3 to 5', holderCountValue: '4', committedCount: 4, agreedToTerms: true,
  });
  let r = await call(airlinesCtrl.getAllAirlinesSubscriptions, {});
  const listed = r.body.data.find(d => String(d._id) === String(air._id));
  ok(!!listed, 'the airline appears in the admin list');
  ok(listed.airlineName === 'Alpha Air', 'name matches the DB');
  ok(listed.committedCount === 4, 'committedCount matches the DB', String(listed.committedCount));
  ok(Number(listed.pricePerCertificate) === ppc, `pricePerCertificate matches ($${listed.pricePerCertificate})`);
  const dbAir = await Airlines.findById(air._id).lean();
  ok(Number(listed.totalAmount) === Number(dbAir.totalAmount), 'totalAmount matches the stored value',
     `${listed.totalAmount} vs ${dbAir.totalAmount}`);
  ok(Number(dbAir.totalAmount) === ppc * 4, 'stored totalAmount = ppc x holders (pre-save hook correct)',
     `${dbAir.totalAmount} vs ${ppc*4}`);

  // ══ 2. Individual list ═══════════════════════════════════════════════════
  H('2. ADMIN INDIVIDUAL LIST — API == DB');
  const ind = await Individual.create({
    subscriptionPlan: '1 Year Subscription Plan', price: pricing.individualPrice('1 Year Subscription Plan'),
    firstName: 'Ada', lastName: 'L', email: 'ada@ex.com',
    primaryAirmanCertificate: 'EXISTING', primaryCertificate: 'Part 61 - Pilot', agreedToTerms: true,
  });
  r = await call(individualCtrl.getAllIndividuals, {});
  const li = r.body.data.find(d => String(d._id) === String(ind._id));
  ok(!!li, 'the individual appears in the admin list');
  ok(Number(li.price) === pricing.individualPrice('1 Year Subscription Plan'), `price matches ($${li.price})`);
  ok(li.paymentStatus === 'pending', 'unpaid status shown as pending', li.paymentStatus);

  // ══ 3. mark-paid round trip: does the list reflect it? ═══════════════════
  H('3. ROUND TRIP — admin marks paid, list + invoice dashboard update');
  await call(individualCtrl.markIndividualPaid, { params: { id: ind._id } });
  await sleep(150);
  r = await call(individualCtrl.getAllIndividuals, {});
  const li2 = r.body.data.find(d => String(d._id) === String(ind._id));
  ok(li2.paymentStatus === 'paid', 'list now shows paid', li2.paymentStatus);
  ok(li2.isPaid === true, 'isPaid flag set');
  ok(li2.status === 'Active', 'status now Active', li2.status);
  ok(!!li2.invoiceNumber, 'invoice number now on the record', li2.invoiceNumber);
  ok(!!li2.expirationDate, 'expiry date computed');

  const invRows = await invoiceStore.listAll();
  const row = invRows.find(x => x.invoiceNumber === li2.invoiceNumber);
  ok(!!row, 'the invoice appears in the admin invoices dashboard');
  ok(row.recipientName === 'Ada L', 'dashboard shows the right recipient', row.recipientName);
  ok(row.totalAmount === pricing.individualPrice('1 Year Subscription Plan'),
     `dashboard shows the right amount ($${row.totalAmount})`);
  ok(row.status === 'paid', 'dashboard shows paid', row.status);

  const dbInv = await Invoice.findOne({ invoiceNumber: li2.invoiceNumber }).lean();
  ok(!!dbInv, 'a real Invoice document exists in the DB');
  ok(dbInv.totalAmount === row.totalAmount, 'dashboard amount == DB amount');
  ok(String(dbInv.registrationId) === String(ind._id), 'invoice is linked to the right registration');

  // ══ 4. Admin status toggle propagates to DB and back ═════════════════════
  H('4. ROUND TRIP — admin flips invoice status paid -> pending');
  await invoiceStore.setStatus(li2.invoiceNumber, 'pending');
  const rows2 = await invoiceStore.listAll();
  const row2 = rows2.find(x => x.invoiceNumber === li2.invoiceNumber);
  ok(row2.status === 'pending', 'dashboard now shows pending', row2.status);
  const regAfter = await Individual.findById(ind._id).lean();
  ok(regAfter.paymentStatus === 'pending', 'registration paymentStatus followed', regAfter.paymentStatus);
  ok(regAfter.isPaid === true, 'PLAN state (isPaid) deliberately unchanged', String(regAfter.isPaid));
  await invoiceStore.setStatus(li2.invoiceNumber, 'paid');

  // ══ 5. Payments list ═════════════════════════════════════════════════════
  H('5. ADMIN PAYMENTS LIST — API == DB');
  r = await call(paymentCtrl.getAllPayments, {});
  const payRows = r.body.data || r.body.payments || [];
  const dbPayCount = await Payment.countDocuments({});
  ok(Array.isArray(payRows), 'payments endpoint returns an array');
  ok(payRows.length === dbPayCount, `payments count matches DB (${payRows.length} vs ${dbPayCount})`);

  // ══ 6. voided / orphaned surfaced to the admin API ═══════════════════════
  H('6. VOID + ORPHAN — are the new states visible to the admin?');
  const air6 = await Airlines.create({
    subscriptionPlan: '1 Year Subscription Plan', pricePerCertificate: ppc,
    airlineName: 'Void Air', firstName: 'V', lastName: 'A', email: 'void@ex.com',
    holderCount: '3 to 5', holderCountValue: '3', committedCount: 3, agreedToTerms: true,
  });
  await call(airlinesCtrl.markAirlinesPaid, { params: { id: air6._id } });
  await sleep(150);
  const air6doc = await Airlines.findById(air6._id).lean();
  await invoiceStore.voidByNumber(air6doc.invoiceNumber, { reason: 'audit test' });
  const rows3 = await invoiceStore.listAll();
  const voidRow = rows3.find(x => x.invoiceNumber === air6doc.invoiceNumber);
  ok(!!voidRow, 'voided invoice still listed to the admin (not hidden)');
  ok(voidRow.status === 'void', 'listed with status "void"', voidRow.status);
  ok(voidRow.voided === true, 'exposes a `voided` flag for the UI');

  const air7 = await Airlines.create({
    subscriptionPlan: '1 Year Subscription Plan', pricePerCertificate: ppc,
    airlineName: 'Gone Air', firstName: 'G', lastName: 'A', email: 'gone@ex.com',
    holderCount: '3 to 5', holderCountValue: '3', committedCount: 3, agreedToTerms: true,
  });
  await call(airlinesCtrl.markAirlinesPaid, { params: { id: air7._id } });
  await sleep(150);
  const air7doc = await Airlines.findById(air7._id).lean();
  await call(airlinesCtrl.deleteAirlinesSubscription, { params: { id: air7._id } });
  const rows4 = await invoiceStore.listAll();
  const orphanRow = rows4.find(x => x.invoiceNumber === air7doc.invoiceNumber);
  ok(!!orphanRow, 'invoice of a DELETED customer still listed');
  ok(orphanRow.orphaned === true, 'exposes an `orphaned` flag for the UI');
  ok(orphanRow.recipientCompany === 'Gone Air' || orphanRow.recipientName,
     'recipient still readable without the customer record',
     `${orphanRow.recipientCompany}/${orphanRow.recipientName}`);

  // ══ 7. Notifications feed ════════════════════════════════════════════════
  H('7. ADMIN NOTIFICATIONS FEED');
  const notifCtrl = require('../controller/notificationsController');
  r = await call(notifCtrl.getNotifications, { query: { limit: '50' } });
  const notifs = r.body?.data || r.body?.notifications || [];
  ok(Array.isArray(notifs), 'notifications endpoint returns an array', typeof notifs);
  const types = [...new Set(notifs.map(n => n.type))];
  ok(r.body?.success === true, 'notifications endpoint succeeded', JSON.stringify(r.body).slice(0,90));
  ok(notifs.length > 0, `feed is populated (${notifs.length} items: ${types.join(', ')})`);
  ok(notifs.every(n => n.id && n.type && n.title), 'every notification has id/type/title');
  ok(types.includes('new-registration'), 'unpaid registration surfaces as new-registration', types.join(','));
  ok(types.includes('payment-confirmed'), 'recent payment surfaces as payment-confirmed', types.join(','));
  const deletedMentioned = notifs.some(n => /Gone Air/.test(n.message || ''));
  ok(!deletedMentioned, 'a DELETED customer does not appear in the feed');

  console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(76)}`);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(2); });
