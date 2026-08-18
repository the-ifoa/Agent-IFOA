'use strict';

/**
 * invoiceRoutes.js — HTTP surface over the invoice store.
 *
 * These handlers do NO invoice logic of their own. They authenticate, authorise,
 * and delegate to services/invoiceStore.js, which is the only module permitted
 * to read or write invoice state.
 *
 * This file used to build invoices inline (its own Invoice.create, its own
 * number checks, its own three-source read union, its own mirror syncing) in
 * parallel with the payment controller doing the same thing differently. That
 * is what let two paths mint two invoices for one payment and let an admin's
 * edit land somewhere the customer's page never read.
 *
 *   GET    /api/invoices/generate-number             admin — preview next number
 *   GET    /api/invoices/by-payment/:paymentId       invoice for one payment
 *   GET    /api/invoices/by-registration/:regId      all invoices for a customer
 *   POST   /api/invoices/admin-create                admin — compose an invoice
 *   PATCH  /api/invoices/:id/draft                   admin — edit an invoice
 *   GET    /api/invoices/admin/all                   admin — every invoice
 *   PATCH  /api/invoices/admin/:invoiceNumber/status admin — paid ↔ pending
 *   DELETE /api/invoices/admin/by-number/:number     admin — delete + free number
 *   POST   /api/invoices/admin/bulk-delete           admin — delete many
 *   POST   /api/invoices/admin/reconcile             admin — repair the allocator
 */

const express = require('express');
const router  = express.Router();

const Invoice    = require('../models/Invoice');
const Airlines   = require('../models/Airlines');
const Individual = require('../models/Individual');

const auth  = require('../middleware/auth');
const store = require('../services/invoiceStore');
const {
  peekNextInvoiceNumber,
  normalizeInvoiceNumber,
  reconcileInvoiceSequences,
} = require('../services/invoiceNumberService');

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  next();
};

/** Map a thrown store error onto an HTTP response. */
const fail = (res, err) => {
  const status = err?.status || (err?.code === 11000 ? 400 : 500);
  const message = err?.code === 11000
    ? 'Invoice number already exists. Please use a different value.'
    : err.message;
  return res.status(status).json({ success: false, message });
};

/** Registration ids this (non-admin) caller is allowed to see. */
async function ownsRegistration(req, regId) {
  const jwtIds = [
    ...(req.user.subscriptionIds || []).map(String),
    req.user.registrationId ? String(req.user.registrationId) : null,
  ].filter(Boolean);

  if (jwtIds.includes(String(regId))) return true;
  if (!req.user.email) return false;

  const [airline, individual] = await Promise.all([
    Airlines.findOne({ _id: regId, email: req.user.email }).select('_id').lean(),
    Individual.findOne({ _id: regId, email: req.user.email }).select('_id').lean(),
  ]);
  return !!(airline || individual);
}

// ── GET /generate-number (admin) ─────────────────────────────────────────────
// Preview only — peeking never claims a sequence, so opening and cancelling the
// invoice modal leaves no gap. The number is claimed when the invoice is saved.
router.get('/generate-number', auth, adminOnly, async (_req, res) => {
  try {
    res.json({ success: true, invoiceNumber: await peekNextInvoiceNumber() });
  } catch (err) { fail(res, err); }
});

// ── GET /by-payment/:paymentId ───────────────────────────────────────────────
router.get('/by-payment/:paymentId', auth, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ paymentId: req.params.paymentId }).lean();
    if (!invoice)
      return res.status(404).json({ success: false, message: 'Invoice not found.' });

    if (req.user.role !== 'admin' && !(await ownsRegistration(req, invoice.registrationId))) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.json({ success: true, data: invoice });
  } catch (err) { fail(res, err); }
});

// ── GET /by-registration/:regId ──────────────────────────────────────────────
// Reads straight from the invoice store. Legacy payment/renewal-only invoices
// were materialised into real documents by the boot-time backfill, so there is
// no longer a three-source union here to disagree with the admin dashboard.
router.get('/by-registration/:regId', auth, async (req, res) => {
  try {
    const { regId } = req.params;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin && !(await ownsRegistration(req, regId))) {
      return res.json({ success: true, data: [] });
    }

    const { invoices, hidden } = await store.listForRegistration(regId, { isAdmin });
    // hiddenInvoiceNumbers is still returned: the admin panel merges it so a
    // previously-deleted number is never rebuilt by its synthetic fallback.
    res.json({ success: true, data: invoices, hiddenInvoiceNumbers: hidden });
  } catch (err) { fail(res, err); }
});

// ── POST /admin-create (admin) ───────────────────────────────────────────────
router.post('/admin-create', auth, adminOnly, async (req, res) => {
  try {
    const { registrationId, registrationModel, draft, invoiceNumber, purpose, wirePending } = req.body;
    const data = await store.adminCreateInvoice({
      registrationId, registrationModel, draft, invoiceNumber, purpose, wirePending,
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
});

// ── PATCH /:id/draft (admin) ─────────────────────────────────────────────────
// The admin edits the ONE stored invoice; the customer's subscription page reads
// that same document, so the change is visible to them immediately.
router.patch('/:id/draft', auth, adminOnly, async (req, res) => {
  try {
    const { draft, invoiceNumber, purpose, wirePending } = req.body;
    const data = await store.saveAdminDraft({
      invoiceId: req.params.id, draft, invoiceNumber, purpose, wirePending,
    });
    res.json({ success: true, data });
  } catch (err) { fail(res, err); }
});

// ── GET /admin/all (admin) ───────────────────────────────────────────────────
router.get('/admin/all', auth, adminOnly, async (_req, res) => {
  try {
    res.json({ success: true, data: await store.listAll() });
  } catch (err) { fail(res, err); }
});

// ── PATCH /admin/:invoiceNumber/status (admin) ───────────────────────────────
router.patch('/admin/:invoiceNumber/status', auth, adminOnly, async (req, res) => {
  try {
    const num = normalizeInvoiceNumber(decodeURIComponent(req.params.invoiceNumber));
    const result = await store.setStatus(num, req.body?.status);
    res.json({ success: true, ...result });
  } catch (err) { fail(res, err); }
});

// ── DELETE /by-registration/:regId/:invoiceNumber (admin) ────────────────────
// Deleting from a customer's invoice list is the SAME operation as deleting from
// the admin invoices page: the document goes, every mirror is cleared, and the
// number returns to the allocator pool. It used to merely hide the number, which
// is why deleted numbers were never handed out again.
router.delete('/by-registration/:regId/:invoiceNumber', auth, adminOnly, async (req, res) => {
  try {
    const num = normalizeInvoiceNumber(decodeURIComponent(req.params.invoiceNumber));
    if (!num) return res.status(400).json({ success: false, message: 'invoiceNumber required.' });
    const result = await store.deleteByNumber(num);
    res.json({ success: true, message: 'Invoice deleted and its number freed for reuse.', ...result });
  } catch (err) { fail(res, err); }
});

// ── DELETE /admin/by-number/:invoiceNumber (admin) ───────────────────────────
router.delete('/admin/by-number/:invoiceNumber', auth, adminOnly, async (req, res) => {
  try {
    const num = normalizeInvoiceNumber(decodeURIComponent(req.params.invoiceNumber));
    if (!num) return res.status(400).json({ success: false, message: 'invoiceNumber required.' });
    const result = await store.deleteByNumber(num);
    res.json({ success: true, message: 'Invoice deleted and its number freed for reuse.', ...result });
  } catch (err) { fail(res, err); }
});

// ── POST /admin/bulk-delete (admin) ──────────────────────────────────────────
router.post('/admin/bulk-delete', auth, adminOnly, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.invoiceNumbers) ? req.body.invoiceNumbers : [];
    const numbers = [...new Set(list.map(normalizeInvoiceNumber).filter(Boolean))];
    if (!numbers.length)
      return res.status(400).json({ success: false, message: 'invoiceNumbers array required.' });

    for (const num of numbers) {
      // eslint-disable-next-line no-await-in-loop
      await store.deleteByNumber(num);
    }
    res.json({ success: true, deleted: numbers.length, message: `${numbers.length} invoice(s) deleted.` });
  } catch (err) { fail(res, err); }
});

// ── POST /admin/reconcile (admin) ────────────────────────────────────────────
// Rebuild the allocator from live data and materialise any invoice number that
// still exists only as a legacy reference. Safe to run at any time.
router.post('/admin/reconcile', auth, adminOnly, async (req, res) => {
  try {
    // Explicit admin action, so the destructive duplicate collapse is allowed here.
    const backfill = await store.backfillLegacyInvoices({ dedupe: req.body?.dedupe !== false });
    const counter  = await reconcileInvoiceSequences(req.body?.year);
    res.json({ success: true, backfill, counter });
  } catch (err) { fail(res, err); }
});

module.exports = router;
