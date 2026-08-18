'use strict';

/**
 * invoiceStore.js — THE invoice store.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Every read and every write of invoice data goes through this module.
 *  No controller, route or script may call Invoice.create / Invoice.save /
 *  Invoice.updateOne / Invoice.deleteOne directly any more.
 *
 *  Why: invoice data used to live in three places that were reconciled by hand
 *  at ~40 call sites — the canonical Invoice document, Payment.invoiceDraft /
 *  invoiceSnapshot, and the registration's own invoiceNumber mirror. Each write
 *  path decided for itself which of the three to update, so an admin edit could
 *  land in one store while the customer's page read another, and two paths could
 *  mint two invoices for one payment.
 *
 *  Now: the Invoice collection is the store. Payment.invoiceDraft and
 *  registration.invoiceNumber are MIRRORS, written only from here, and read by
 *  nothing that matters. Admin edits and customer views hit the same document,
 *  so they cannot disagree.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * INVARIANTS THIS MODULE ENFORCES
 *  1. An invoice number is claimed ONLY at the moment an invoice is issued —
 *     never while a payment is merely being attempted. A failed or abandoned
 *     payment leaves no invoice and burns no number.
 *  2. An invoice is issued ONLY against settled money: a Payment marked isPaid,
 *     an explicit admin mark-paid, or an explicit pro-forma wire request
 *     (wirePending) which is what an unpaid wire invoice legitimately is.
 *  3. Deleting an invoice RELEASES its number back to the allocator pool, so
 *     the gap is refilled by the next issue instead of being lost forever.
 *  4. Issuance is idempotent per payment: the confirm path and the webhook path
 *     racing on the same PaymentIntent produce one invoice, not two.
 */

const mongoose = require('mongoose');

const Invoice              = require('../models/Invoice');
const Payment              = require('../models/Payment');
const Renewal              = require('../models/Renewal');
const Individual           = require('../models/Individual');
const Airlines             = require('../models/Airlines');
const AirlinesSubscription = require('../models/AirlinesSubscription');

const {
  allocateInvoiceNumber,
  releaseInvoiceNumber,
  isInvoiceNumberTaken,
  normalizeInvoiceNumber,
  parseInvoiceNumber,
} = require('./invoiceNumberService');

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const MODELS = {
  Individual,
  Airlines,
  AirlinesSubscription,
};

function registrationModelFor(name) {
  return MODELS[name] || Airlines;
}

/** 30 days after `from` — the standard payment term printed on the invoice. */
function payableByDate(from) {
  const d = new Date(from || Date.now());
  d.setDate(d.getDate() + 30);
  return d;
}

function toIsoDay(value) {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

/**
 * The PDF-ready payload. This exact shape is what
 * frontend/src/utils/ifoaInvoicePdf.js renders, so admin and customer produce
 * byte-identical documents from one stored object.
 */
function buildDraft(invoiceDoc, overrides = {}) {
  return {
    invoiceNumber:     invoiceDoc.invoiceNumber,
    issueDate:         toIsoDay(invoiceDoc.issueDate),
    payableBy:         toIsoDay(invoiceDoc.payableBy || payableByDate(invoiceDoc.issueDate)),
    recipientCompany:  invoiceDoc.recipientCompany  || '',
    recipientName:     invoiceDoc.recipientName     || '',
    recipientContact:  invoiceDoc.recipientContact  || invoiceDoc.recipientName || '',
    recipientAddress1: invoiceDoc.recipientAddress1 || '',
    recipientAddress2: invoiceDoc.recipientAddress2 || '',
    recipientCountry:  invoiceDoc.recipientCountry  || '',
    paymentMethod:     invoiceDoc.paymentMethod     || '',
    lineItems:         invoiceDoc.lineItems || [],
    ...overrides,
  };
}

/** Sum a line-item array the way the PDF footer does. */
function sumLineItems(lineItems) {
  return (lineItems || []).reduce((s, li) => s + (Number(li.totalPrice) || 0), 0);
}

/**
 * Newest-first. Invoice numbers are monotonic within a year, so (yy, seq) is a
 * more reliable ordering than createdAt — which drifts once an admin edits an
 * issue date. Falls back to createdAt for anything unnumbered.
 */
function byNewestFirst(a, b) {
  const ka = parseInvoiceNumber(a.invoiceNumber);
  const kb = parseInvoiceNumber(b.invoiceNumber);
  if (ka && kb) {
    if (kb.yy !== ka.yy) return kb.yy - ka.yy;
    if (kb.sequence !== ka.sequence) return kb.sequence - ka.sequence;
    return 0;
  }
  if (ka && !kb) return -1;
  if (!ka && kb) return 1;
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide whether this issuance is allowed, and say why not when it is not.
 *
 * Settled money looks like ONE of:
 *   - a Payment document that is actually marked isPaid   (card, or admin-created)
 *   - adminGenerated: an admin recording an off-Stripe payment (wire, cash, comp)
 *   - wirePending: an explicit pro-forma invoice — the document you SEND in order
 *     to get paid by wire. It is marked unpaid and hidden from the customer's
 *     paid history until an admin activates it.
 */
async function assertIssuable({ paymentId, paidAt, adminGenerated, wirePending }) {
  if (wirePending) return 'wire-proforma';

  // A linked Stripe payment is the strongest basis — but only once it has
  // actually succeeded. This is the check that stops an invoice being minted
  // mid-attempt or after a decline.
  if (paymentId) {
    const payment = await Payment.findById(paymentId).select('isPaid status').lean();
    if (payment && payment.isPaid) return 'payment';

    // The payment row is missing or not settled. An admin recording an
    // off-Stripe settlement (wire received, comp, correction) still supplies
    // its own basis, so fall through to those rather than blocking them.
    if (!adminGenerated && !paidAt) {
      throw new Error(
        payment
          ? 'Refusing to issue an invoice: the linked payment has not succeeded.'
          : `Refusing to issue an invoice: Payment ${paymentId} does not exist.`,
      );
    }
  }

  if (adminGenerated) return 'admin';
  if (paidAt) return 'settled';

  throw new Error(
    'Refusing to issue an invoice with no proof of payment. Pass a settled paymentId, ' +
    'set adminGenerated for an off-Stripe payment, or set wirePending for a pro-forma invoice.',
  );
}

/**
 * Find the invoice this issuance should UPDATE rather than duplicate.
 *
 * Card payments key on paymentId — that is what makes the confirm path and the
 * webhook path idempotent when they race on the same PaymentIntent.
 * Wire/manual issuances key on (registration, invoiceNumber).
 */
async function findExisting({ paymentId, registrationId, existingInvoiceNumber }) {
  if (paymentId) {
    const byPayment = await Invoice.findOne({ paymentId });
    if (byPayment) return byPayment;
  }
  const norm = normalizeInvoiceNumber(existingInvoiceNumber);
  if (norm && registrationId) {
    return Invoice.findOne({ registrationId, invoiceNumber: norm });
  }
  return null;
}

/**
 * Resolve the invoice number to use, claiming a new one only when necessary.
 *
 * A caller-supplied number is honoured when it is genuinely free; otherwise a
 * fresh one is allocated. The allocation happens HERE and nowhere else, at the
 * last possible moment, so an abandoned flow never consumes a sequence.
 */
async function resolveInvoiceNumber({ existing, existingInvoiceNumber, paymentId, registrationId, registrationModel }) {
  if (existing?.invoiceNumber) return { invoiceNumber: existing.invoiceNumber, allocated: false };

  // Payment.invoiceNumber is required and unique, so a payment always arrives
  // carrying a number. Adopt it instead of allocating a second one for the same
  // money — that is what used to leave one number stranded per payment.
  let preferred = normalizeInvoiceNumber(existingInvoiceNumber);
  if (!preferred && paymentId) {
    const payment = await Payment.findById(paymentId).select('invoiceNumber').lean();
    preferred = normalizeInvoiceNumber(payment?.invoiceNumber);
  }

  if (preferred) {
    const taken = await isInvoiceNumberTaken(preferred, {
      excludePaymentId:         paymentId || null,
      excludeInvoiceId:         existing?._id || null,
      excludeRegistrationId:    registrationId || null,
      excludeRegistrationModel: registrationModel || null,
    });
    if (!taken) return { invoiceNumber: preferred, allocated: false };
  }

  return { invoiceNumber: await allocateInvoiceNumber(), allocated: true };
}

/**
 * Create or update THE invoice for a payment. The only invoice-creating function
 * in the codebase.
 *
 * @param {object}  opts
 * @param {string}  opts.registrationId
 * @param {string}  opts.registrationModel   'Individual' | 'Airlines' | 'AirlinesSubscription'
 * @param {string}  [opts.paymentId]         Payment._id — required for card payments
 * @param {object}  [opts.snapshot]          invoiceSnapshot captured at payment time
 * @param {number}  [opts.amountDollars]
 * @param {Date}    [opts.paidAt]
 * @param {string}  [opts.paymentMethod]
 * @param {object}  [opts.draftOverrides]    admin edits merged into the draft
 * @param {boolean} [opts.adminGenerated]    admin recording an off-Stripe payment
 * @param {boolean} [opts.wirePending]       pro-forma wire invoice (not yet paid)
 * @param {string}  [opts.existingInvoiceNumber] reuse this number if it is free
 * @param {string}  [opts.purpose]           payment | renewal | holder-upgrade | convert-unlimited | custom
 * @param {Array}   [opts.lineItems]         explicit lines (e.g. conversion credit)
 * @returns {Promise<Invoice>}
 */
async function issueInvoice(opts) {
  const {
    registrationId,
    registrationModel,
    paymentId       = null,
    snapshot        = {},
    amountDollars   = 0,
    paidAt,
    paymentMethod   = '',
    draftOverrides  = null,
    adminGenerated  = false,
    wirePending     = false,
    existingInvoiceNumber = null,
    purpose         = 'payment',
    lineItems       = null,
  } = opts;

  if (!registrationId || !registrationModel) {
    throw new Error('issueInvoice requires registrationId and registrationModel.');
  }

  // INVARIANT 2 — never issue against money that has not settled.
  const basis = await assertIssuable({ paymentId, paidAt, adminGenerated, wirePending });

  const existing = await findExisting({ paymentId, registrationId, existingInvoiceNumber });

  // INVARIANT 1 — the number is claimed here, at the last possible moment.
  const { invoiceNumber, allocated } = await resolveInvoiceNumber({
    existing, existingInvoiceNumber, paymentId, registrationId, registrationModel,
  });

  try {
    const isAirline      = registrationModel !== 'Individual';
    const holderCount    = Number(snapshot.holderCount    || 0);
    const pricePerCert   = Number(snapshot.pricePerCert   || 0);
    const multiYearCount = Number(snapshot.multiYearCount || 1);
    const yearMultiplier =
      snapshot.subscriptionPlan === 'Multiple Years Subscription Plan' && multiYearCount > 1
        ? multiYearCount
        : 1;

    // Trust the snapshot total first — every payment path builds it from the
    // amount actually charged (including admin price overrides). The ppc × count
    // recompute is only a fallback for legacy snapshots that carry no total.
    const snapshotTotal = Number(snapshot.totalPaid || snapshot.subtotal || 0);
    const totalAmount = snapshotTotal > 0
      ? snapshotTotal
      : (isAirline && pricePerCert > 0 && holderCount > 0
        ? pricePerCert * holderCount * yearMultiplier
        : amountDollars);

    const planBase = (snapshot.subscriptionPlan || '1 Year Plan')
      .replace(' Subscription Plan', '')
      .replace(' Plan', '');
    const planLabel = snapshot.subscriptionPlan === 'Multiple Years Subscription Plan' && multiYearCount > 1
      ? `${planBase} (${multiYearCount} Years)`
      : planBase;

    const lineDescription = purpose === 'holder-upgrade'
      ? 'Agent For Service - Holder Upgrade'
      : `Agent For Service - ${planLabel}`;

    // Fold the year multiplier into unitPrice (per holder, for the whole term) so
    // the invoice arithmetic reconciles: quantity × unitPrice === totalPrice.
    const airlineUnitPrice = (pricePerCert || amountDollars) * yearMultiplier;
    const computedLineItems = Array.isArray(lineItems) && lineItems.length
      ? lineItems
      : [{
          description: lineDescription,
          quantity:    isAirline ? holderCount || 1 : 1,
          unitPrice:   isAirline ? airlineUnitPrice : amountDollars,
          totalPrice:  totalAmount,
        }];

    const issueDate = paidAt || existing?.issueDate || new Date();
    const recipientName    = snapshot.name || '';
    const recipientCompany = isAirline ? (snapshot.airlineName || recipientName) : '';

    const docPayload = {
      invoiceNumber,
      paymentId,
      registrationId,
      registrationModel,
      // A pro-forma wire invoice is 'issued' (awaiting money), everything else is paid.
      status:            basis === 'wire-proforma' ? 'issued' : 'paid',
      issueDate,
      payableBy:         payableByDate(issueDate),
      paidAt:            basis === 'wire-proforma' ? null : (paidAt || issueDate),
      recipientName,
      recipientCompany,
      recipientContact:  recipientName,
      recipientAddress1: snapshot.address || '',
      recipientAddress2: '',
      recipientCountry:  '',
      recipientEmail:    snapshot.email || '',
      recipientPhone:    snapshot.phone || '',
      subscriptionPlan:  snapshot.subscriptionPlan || '',
      subscriptionDate:  snapshot.subscriptionDate || issueDate,
      expirationDate:    snapshot.expirationDate   || null,
      isAirline,
      lineItems:   computedLineItems,
      subtotal:    totalAmount,
      tax:         0,
      totalAmount,
      currency:    'USD',
      paymentMethod,
      purpose,
      wirePending: !!wirePending,
    };

    const baseDraft = buildDraft(docPayload, {});
    docPayload.draft = draftOverrides
      ? { ...baseDraft, ...draftOverrides }
      : (existing?.draft || baseDraft);

    if (adminGenerated) docPayload.adminGenerated = true;

    const applyTo = async (doc) => {
      const updateSet = { ...docPayload };
      // Never clobber a draft the admin deliberately set unless new overrides
      // are explicitly supplied.
      if (!draftOverrides && doc.draft) delete updateSet.draft;
      // The number already on the stored document wins — re-issuing must never
      // renumber an invoice a customer has already been shown.
      delete updateSet.invoiceNumber;
      Object.assign(doc, updateSet);
      return doc.save();
    };

    let saved;
    if (existing) {
      saved = await applyTo(existing);
    } else if (paymentId) {
      // INVARIANT 4 — the confirm path and the webhook path race on the same
      // PaymentIntent by design. An upsert against the unique paymentId index
      // makes "create if absent" a single atomic operation, so the loser of the
      // race updates the winner's document instead of minting a second invoice.
      try {
        const res = await Invoice.findOneAndUpdate(
          { paymentId },
          { $setOnInsert: docPayload },
          { upsert: true, new: true, setDefaultsOnInsert: true, includeResultMetadata: true },
        );
        const doc = res.value;
        saved = res.lastErrorObject?.updatedExisting ? await applyTo(doc) : doc;
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Lost the insert race — adopt the winner's document.
        const winner = await Invoice.findOne({ paymentId });
        if (!winner) throw err;
        saved = await applyTo(winner);
      }
    } else {
      saved = await Invoice.create(docPayload);
    }

    // If we claimed a number but ended up adopting another document (race
    // loser, or a doc that already had its own number), give ours straight back
    // rather than stranding it.
    if (allocated && saved.invoiceNumber !== invoiceNumber) {
      await releaseInvoiceNumber(invoiceNumber).catch(() => {});
    }

    await syncMirrors(saved);
    return saved;
  } catch (err) {
    // INVARIANT 3 (inverse) — a number claimed for an issue that then failed must
    // not be lost. Hand it straight back to the pool.
    if (allocated) {
      await releaseInvoiceNumber(invoiceNumber).catch(() => {});
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mirrors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push the stored invoice out to its back-compat mirrors.
 *
 * Payment.invoiceDraft / Payment.invoiceNumber and registration.invoiceNumber
 * are legacy readers. They are written ONLY here, so they can never diverge from
 * the Invoice document by being updated on some other path.
 *
 * The registration mirror is only re-pointed when it already pointed at THIS
 * invoice (or at nothing). A renewal or add-on invoice shares the registration
 * but must not steal the pointer to the active subscription invoice.
 */
async function syncMirrors(invoice, previousNumber = null) {
  if (!invoice) return;

  const num = invoice.invoiceNumber;

  if (invoice.paymentId) {
    await Payment.findByIdAndUpdate(invoice.paymentId, {
      $set: { invoiceDraft: invoice.draft, invoiceNumber: num },
    }).catch(() => {});
    await Renewal.findOneAndUpdate(
      { paymentId: invoice.paymentId },
      { $set: { invoiceNumber: num } },
    ).catch(() => {});
  }

  const RegModel = registrationModelFor(invoice.registrationModel);
  const reg = await RegModel.findById(invoice.registrationId)
    .select('invoiceNumber nextRenewal lastRenewal holderGroups')
    .lean()
    .catch(() => null);
  if (!reg) return;

  // ── Renames: every pointer at the OLD number must follow ────────────────────
  // A pointer left on the old number dangles (it references an invoice that no
  // longer exists under that name) and, worse, keeps the old number looking
  // "in use" so it can never be released back to the allocator.
  if (previousNumber && previousNumber !== num) {
    const followed = {};
    if (reg.invoiceNumber === previousNumber) followed.invoiceNumber = num;
    if (reg.nextRenewal?.invoiceNumber === previousNumber) followed['nextRenewal.invoiceNumber'] = num;
    if (reg.lastRenewal?.invoiceNumber === previousNumber) followed['lastRenewal.invoiceNumber'] = num;
    (reg.holderGroups || []).forEach((g, i) => {
      if (g.invoiceNumber === previousNumber) followed[`holderGroups.${i}.invoiceNumber`] = num;
    });
    if (Object.keys(followed).length) {
      await RegModel.findByIdAndUpdate(invoice.registrationId, { $set: followed }).catch(() => {});
      Object.assign(reg, { invoiceNumber: followed.invoiceNumber ?? reg.invoiceNumber });
    }
  }

  const matches = (value) =>
    value && (value === num || (previousNumber && value === previousNumber));

  // A queued renewal's invoice belongs to the NEXT term, not the live one. It
  // must update nextRenewal.invoiceNumber and never steal the pointer to the
  // active subscription invoice.
  if (invoice.purpose === 'renewal' && reg.nextRenewal?.paidAt) {
    if (!reg.nextRenewal.invoiceNumber || matches(reg.nextRenewal.invoiceNumber)) {
      await RegModel.findByIdAndUpdate(invoice.registrationId, {
        $set: { 'nextRenewal.invoiceNumber': num },
      }).catch(() => {});
      return;
    }
  }

  // An add-on group's invoice belongs to that group.
  const groupIdx = (reg.holderGroups || []).findIndex(g => matches(g.invoiceNumber));
  if (groupIdx >= 0) {
    await RegModel.findByIdAndUpdate(invoice.registrationId, {
      $set: { [`holderGroups.${groupIdx}.invoiceNumber`]: num },
    }).catch(() => {});
    return;
  }

  // Otherwise this is the active subscription invoice — but only re-point the
  // registration when it already pointed here (or nowhere).
  if (!reg.invoiceNumber || matches(reg.invoiceNumber)) {
    await RegModel.findByIdAndUpdate(invoice.registrationId, {
      $set: { invoiceNumber: num, invoiceGenerated: true },
    }).catch(() => {});
  }
}

/**
 * The invoice document for a Payment, creating it from the payment's own
 * snapshot if it does not exist yet (older wire/manual payments predate the
 * Invoice collection). Used by the admin edit path so there is always exactly
 * one document to edit.
 */
async function ensureInvoiceForPayment(paymentId, { draftOverrides = null } = {}) {
  const existing = await Invoice.findOne({ paymentId });
  if (existing) return existing;

  const payment = await Payment.findById(paymentId).lean();
  if (!payment) {
    const err = new Error('Payment record not found.');
    err.status = 404;
    throw err;
  }

  return issueInvoice({
    registrationId:        payment.registrationId,
    registrationModel:     payment.registrationModel,
    paymentId:             payment._id,
    snapshot:              payment.invoiceSnapshot || {},
    amountDollars:         payment.amountDollars || 0,
    paidAt:                payment.paidAt || new Date(),
    paymentMethod:         payment.paymentMethodType || '',
    draftOverrides:        draftOverrides || payment.invoiceDraft || null,
    adminGenerated:        true,
    existingInvoiceNumber: payment.invoiceNumber || null,
    purpose:               payment.purpose || 'payment',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin edit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply an admin's edits to a stored invoice.
 *
 * This is the write half of "the admin changes it and the customer sees the
 * change": there is one document, the admin edits it here, and the customer's
 * subscription page reads that same document back.
 *
 * Renaming to a number that is in use anywhere is rejected rather than silently
 * stealing it. A successful rename RELEASES the old number for reuse.
 */
async function saveAdminDraft({ invoiceId, draft, invoiceNumber, purpose, wirePending }) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    const err = new Error('Invoice not found.');
    err.status = 404;
    throw err;
  }

  const previousNumber = invoice.invoiceNumber;
  const requested = normalizeInvoiceNumber(invoiceNumber);

  if (requested && requested !== previousNumber) {
    const taken = await isInvoiceNumberTaken(requested, {
      excludeInvoiceId:         invoice._id,
      excludePaymentId:         invoice.paymentId || null,
      excludeRegistrationId:    invoice.registrationId || null,
      excludeRegistrationModel: invoice.registrationModel || null,
    });
    if (taken) {
      const err = new Error('Invoice number already exists. Please use a different value.');
      err.status = 400;
      throw err;
    }
    invoice.invoiceNumber = requested;
  }

  if (draft) {
    invoice.draft = { ...draft, invoiceNumber: invoice.invoiceNumber };
    invoice.markModified('draft');

    // Editable dates are persisted onto the document itself, not just the draft,
    // so every reader sees them — not only the PDF renderer.
    if (draft.issueDate) {
      const d = new Date(draft.issueDate);
      if (!Number.isNaN(d.getTime())) invoice.issueDate = d;
    }
    if (draft.payableBy) {
      const d = new Date(draft.payableBy);
      if (!Number.isNaN(d.getTime())) invoice.payableBy = d;
    }
    if (draft.recipientName    !== undefined) invoice.recipientName    = draft.recipientName;
    if (draft.recipientCompany !== undefined) invoice.recipientCompany = draft.recipientCompany;
    if (draft.recipientAddress1!== undefined) invoice.recipientAddress1= draft.recipientAddress1;
    if (draft.recipientAddress2!== undefined) invoice.recipientAddress2= draft.recipientAddress2;
    if (draft.recipientCountry !== undefined) invoice.recipientCountry = draft.recipientCountry;
    if (draft.paymentMethod    !== undefined) invoice.paymentMethod    = draft.paymentMethod;

    if (draft.lineItems?.length) {
      const total = sumLineItems(draft.lineItems);
      invoice.lineItems   = draft.lineItems;
      invoice.totalAmount = total;
      invoice.subtotal    = total;
    }
  }

  if (purpose) invoice.purpose = purpose;
  if (wirePending !== undefined) invoice.wirePending = !!wirePending;
  invoice.adminGenerated = true;

  const saved = await invoice.save();

  // A rename frees the old number for the next issue.
  if (requested && requested !== previousNumber) {
    await syncMirrors(saved, previousNumber);
    await releaseInvoiceNumber(previousNumber).catch(() => {});
  } else {
    await syncMirrors(saved);
  }

  return saved;
}

/**
 * Create an invoice the admin composed by hand (wire / off-Stripe / correction).
 *
 * Idempotent on (registration, invoiceNumber): re-saving the modal updates the
 * same document instead of minting a second one.
 */
async function adminCreateInvoice({
  registrationId,
  registrationModel,
  draft = {},
  invoiceNumber,
  purpose = 'payment',
  wirePending = false,
}) {
  if (!registrationId || !registrationModel) {
    const err = new Error('registrationId and registrationModel required.');
    err.status = 400;
    throw err;
  }

  const norm = normalizeInvoiceNumber(invoiceNumber);

  // Reuse the document that already carries this number for this registration.
  const existing = norm
    ? await Invoice.findOne({ registrationId, invoiceNumber: norm })
    : null;

  if (existing) {
    return saveAdminDraft({
      invoiceId: existing._id,
      draft,
      invoiceNumber: norm,
      purpose,
      wirePending,
    });
  }

  if (norm) {
    const taken = await isInvoiceNumberTaken(norm);
    if (taken) {
      const err = new Error('Invoice number already exists. Please use a different value.');
      err.status = 400;
      throw err;
    }
  }

  const lineItems = draft?.lineItems || [];
  const total = sumLineItems(lineItems);
  const issueDate = draft?.issueDate ? new Date(draft.issueDate) : new Date();

  return issueInvoice({
    registrationId,
    registrationModel,
    // An admin-composed invoice is either a recorded off-Stripe payment or an
    // explicit pro-forma wire request — both are legitimate issuance bases.
    adminGenerated: !wirePending,
    wirePending,
    existingInvoiceNumber: norm || null,
    purpose,
    paidAt: wirePending ? null : issueDate,
    amountDollars: total,
    paymentMethod: draft?.paymentMethod || '',
    lineItems,
    snapshot: {
      name:        draft?.recipientName    || '',
      airlineName: draft?.recipientCompany || '',
      address:     draft?.recipientAddress1|| '',
      email:       draft?.recipientEmail   || '',
      phone:       draft?.recipientPhone   || '',
      subtotal:    total,
      totalPaid:   total,
    },
    draftOverrides: draft,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flip an invoice between paid and pending.
 *
 * Invoice status IS the registration's payment state for the active base
 * invoice, and the group's payment state for an add-on invoice — the same
 * fields the admin edit modal writes. The PLAN's active/inactive flag (isPaid)
 * is deliberately never touched here, so changing an invoice's status can never
 * deactivate somebody's subscription.
 */
async function setStatus(invoiceNumber, status) {
  const num = normalizeInvoiceNumber(invoiceNumber);
  if (!['paid', 'pending'].includes(status)) {
    const err = new Error('status must be "paid" or "pending".');
    err.status = 400;
    throw err;
  }

  const invoice = await Invoice.findOne({ invoiceNumber: num });
  if (!invoice) {
    const err = new Error('No invoice found for this number.');
    err.status = 404;
    throw err;
  }

  invoice.status = status === 'paid' ? 'paid' : 'issued';
  if (status === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
  if (status === 'paid') invoice.wirePending = false;
  await invoice.save();

  const RegModel = registrationModelFor(invoice.registrationModel);
  const reg = await RegModel.findById(invoice.registrationId)
    .select('invoiceNumber holderGroups').lean();

  if (reg) {
    const isActiveBase = reg.invoiceNumber && normalizeInvoiceNumber(reg.invoiceNumber) === num;
    if (isActiveBase) {
      await RegModel.findByIdAndUpdate(invoice.registrationId, { $set: { paymentStatus: status } });
    } else {
      const idx = (reg.holderGroups || []).findIndex(
        g => g.invoiceNumber && normalizeInvoiceNumber(g.invoiceNumber) === num,
      );
      if (idx >= 0) {
        await RegModel.findByIdAndUpdate(invoice.registrationId, {
          $set: { [`holderGroups.${idx}.paymentStatus`]: status },
        });
      }
    }
  }

  return { invoiceNumber: num, status };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete an invoice everywhere and FREE its number for reuse.
 *
 * This is the fix for "a deleted invoice number is never handed out again": the
 * old soft-delete hid the number on the registration but left it referenced by
 * the Payment / Renewal / mirror rows, so the allocator still considered it
 * taken forever. Now every reference is cleared and the sequence is explicitly
 * returned to the pool.
 *
 * @param {string}  invoiceNumber
 * @param {object}  [opts]
 * @param {boolean} [opts.deletePayment=true] also remove the Payment/Renewal rows.
 *   Leave true for an admin deleting a mistake; pass false to keep the financial
 *   record and only drop the document (the number then stays taken).
 */
async function deleteByNumber(invoiceNumber, opts = {}) {
  const { deletePayment = true } = opts;
  const num = normalizeInvoiceNumber(invoiceNumber);
  if (!num) return { deleted: 0, released: false };

  const invoices = await Invoice.find({ invoiceNumber: num }).select('_id').lean();
  await Invoice.deleteMany({ invoiceNumber: num });

  if (deletePayment) {
    await Payment.deleteMany({ invoiceNumber: num });
    await Renewal.deleteMany({ invoiceNumber: num });
  }

  // Clear every mirror so nothing still claims the number.
  const mirrorMatch = { $or: [{ invoiceNumber: num }, { 'invoiceDraft.invoiceNumber': num }] };
  const clearMirror = { $set: { invoiceNumber: '', invoiceDraft: null, invoiceGenerated: false } };

  await Promise.all([
    Individual.updateMany(mirrorMatch, clearMirror),
    Individual.updateMany({ 'nextRenewal.invoiceNumber': num }, { $set: { 'nextRenewal.invoiceNumber': '' } }),
    Airlines.updateMany(mirrorMatch, clearMirror),
    Airlines.updateMany({ 'nextRenewal.invoiceNumber': num }, { $set: { 'nextRenewal.invoiceNumber': '' } }),
    Airlines.updateMany(
      { 'holderGroups.invoiceNumber': num },
      { $set: { 'holderGroups.$[g].invoiceNumber': '' } },
      { arrayFilters: [{ 'g.invoiceNumber': num }] },
    ),
    AirlinesSubscription.updateMany({ invoiceNumber: num }, { $set: { invoiceNumber: '' } }),
    AirlinesSubscription.updateMany({ 'nextRenewal.invoiceNumber': num }, { $set: { 'nextRenewal.invoiceNumber': '' } }),
  ]);

  // The hidden-list was only ever needed to suppress ghosts rebuilt from stale
  // mirrors. With the mirrors cleared it must be dropped too, or the number
  // would be reissued and then immediately hidden again.
  await Promise.all([
    Individual.updateMany({ hiddenInvoiceNumbers: num }, { $pull: { hiddenInvoiceNumbers: num } }),
    Airlines.updateMany({ hiddenInvoiceNumbers: num }, { $pull: { hiddenInvoiceNumbers: num } }),
  ]);

  // INVARIANT 3 — the sequence goes back into the pool.
  const released = await releaseInvoiceNumber(num);

  return { deleted: invoices.length, released };
}

/**
 * Clear registration mirror fields that point at an invoice number nothing
 * financial references any more, and free those numbers.
 *
 * A mirror (`invoiceNumber`, `nextRenewal.invoiceNumber`,
 * `lastRenewal.invoiceNumber`, `holderGroups[].invoiceNumber`) is a POINTER to an
 * invoice. When no Invoice, Payment or Renewal row carries that number, the
 * pointer is stale — it corroborates nothing — yet it still makes the number look
 * taken, permanently removing it from the sequence.
 *
 * That is how a renewal artefact stranded a number: the number was written to
 * `lastRenewal.invoiceNumber`, the real invoice ended up under a different number,
 * and the stale pointer kept the original out of circulation for good.
 *
 * MUST run AFTER backfillLegacyInvoices(), which deliberately turns mirrors that
 * DO represent real money into proper Invoice documents. Whatever is still
 * dangling afterwards is genuinely stale.
 */
async function clearStaleMirrors({ verbose = false } = {}) {
  const backed = new Set();
  const collect = (rows) => rows.forEach(r => {
    const n = normalizeInvoiceNumber(r.invoiceNumber);
    if (n) backed.add(n);
  });
  collect(await Invoice.find({}).select('invoiceNumber').lean());
  collect(await Payment.find({}).select('invoiceNumber').lean());
  collect(await Renewal.find({}).select('invoiceNumber').lean());

  const cleared = [];
  const sources = [
    ['Individual', Individual],
    ['Airlines', Airlines],
    ['AirlinesSubscription', AirlinesSubscription],
  ];

  for (const [, Model] of sources) {
    // eslint-disable-next-line no-await-in-loop
    const regs = await Model.find({}).select(
      'invoiceNumber nextRenewal.invoiceNumber lastRenewal.invoiceNumber holderGroups.invoiceNumber',
    ).lean();

    for (const reg of regs) {
      const unset = {};
      const consider = (value, path) => {
        const n = normalizeInvoiceNumber(value);
        if (!n || backed.has(n)) return;
        unset[path] = '';
        cleared.push({ number: n, path, registrationId: String(reg._id) });
      };

      consider(reg.invoiceNumber, 'invoiceNumber');
      consider(reg.nextRenewal?.invoiceNumber, 'nextRenewal.invoiceNumber');
      consider(reg.lastRenewal?.invoiceNumber, 'lastRenewal.invoiceNumber');
      (reg.holderGroups || []).forEach((g, i) => {
        consider(g.invoiceNumber, `holderGroups.${i}.invoiceNumber`);
      });

      if (Object.keys(unset).length) {
        // eslint-disable-next-line no-await-in-loop
        await Model.updateOne({ _id: reg._id }, { $set: unset });
        if (verbose) {
          Object.keys(unset).forEach(pth => console.log(`[staleMirror] cleared ${pth} on ${reg._id}`));
        }
      }
    }
  }

  // Now that nothing points at them, the numbers can go back into the pool.
  const freed = [];
  for (const c of [...new Set(cleared.map(x => x.number))]) {
    // eslint-disable-next-line no-await-in-loop
    if (await releaseInvoiceNumber(c)) freed.push(c);
  }

  return { cleared: cleared.length, freed };
}

/**
 * Void an invoice: keep the record, retire the number for good.
 *
 * The counterpart to deleteByNumber(). Use this whenever money was involved —
 * a paid renewal an admin later cancels, a charge that was refunded. Deleting
 * such an invoice to reclaim its number would erase the evidence that a customer
 * was charged, which is exactly what accounting practice forbids: you void an
 * issued invoice, you do not delete it.
 *
 * The Payment and Renewal rows are deliberately left intact, which also means the
 * number can never be released — that is the point.
 */
async function voidByNumber(invoiceNumber, { reason = '' } = {}) {
  const num = normalizeInvoiceNumber(invoiceNumber);
  if (!num) return { voided: 0 };

  const now = new Date();
  const res = await Invoice.updateMany(
    { invoiceNumber: num },
    {
      $set: {
        status: 'void',
        voidedAt: now,
        // A voided invoice is no longer awaiting a wire payment.
        wirePending: false,
        ...(reason ? { notes: reason } : {}),
      },
    },
  );

  return { voided: res.modifiedCount ?? res.nModified ?? 0, invoiceNumber: num };
}

/**
 * An admin deleted a registration. Keep its invoices and retire their numbers.
 *
 * The invoices are NOT deleted: each one denormalises the recipient's name,
 * company and email, so it still reads correctly with the customer record gone,
 * and it remains the record of money that changed hands. Their numbers stay
 * permanently out of circulation — they were genuinely issued, so reissuing them
 * to a different customer would be wrong.
 *
 * Payment and Renewal rows are likewise retained, which is what keeps those
 * numbers reserved: releaseInvoiceNumber() refuses to free anything still
 * referenced.
 */
async function markRegistrationDeleted(registrationId) {
  const now = new Date();
  const res = await Invoice.updateMany(
    { registrationId },
    { $set: { orphaned: true, orphanedAt: now } },
  );
  return { orphaned: res.modifiedCount ?? res.nModified ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Read models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoice numbers an admin previously deleted from a registration's list.
 *
 * The pre-refactor soft-delete removed the Invoice document but left the number
 * on the Payment/Renewal rows and recorded it here. Those numbers must stay
 * invisible: without this the backfill would resurrect every invoice an admin had
 * already deleted, for the customer as well as the admin.
 *
 * New deletions go through deleteByNumber(), which clears the mirrors AND drops
 * the hidden entry, so this list only ever shrinks from here on.
 */
async function hiddenNumbersFor(registrationId) {
  const [air, ind] = await Promise.all([
    Airlines.findById(registrationId).select('hiddenInvoiceNumbers').lean().catch(() => null),
    Individual.findById(registrationId).select('hiddenInvoiceNumbers').lean().catch(() => null),
  ]);
  const list = (air || ind)?.hiddenInvoiceNumbers || [];
  return new Set(list.map(n => normalizeInvoiceNumber(n)).filter(Boolean));
}

/** The same list for many registrations at once, as Map<regId, Set<number>>. */
async function hiddenNumbersForMany(registrationIds) {
  const ids = [...new Set(registrationIds.map(String))];
  if (!ids.length) return new Map();
  const [airs, inds] = await Promise.all([
    Airlines.find({ _id: { $in: ids } }).select('hiddenInvoiceNumbers').lean(),
    Individual.find({ _id: { $in: ids } }).select('hiddenInvoiceNumbers').lean(),
  ]);
  const map = new Map();
  for (const r of [...airs, ...inds]) {
    map.set(String(r._id), new Set((r.hiddenInvoiceNumbers || []).map(n => normalizeInvoiceNumber(n)).filter(Boolean)));
  }
  return map;
}

/**
 * Overlay each invoice's live payment state from its registration.
 *
 * Invoice.status is frozen at issue time, but an admin can later flip a
 * registration (or one add-on group) between paid and pending. The invoice list
 * must show the CURRENT state, so it is projected here rather than being
 * denormalised into every row at write time.
 */
async function applyLiveStatus(rows) {
  const idsByModel = { Airlines: new Set(), AirlinesSubscription: new Set(), Individual: new Set() };
  for (const row of rows) {
    if (row.registrationId && idsByModel[row.registrationModel]) {
      idsByModel[row.registrationModel].add(String(row.registrationId));
    }
  }

  const select = '_id invoiceNumber paymentStatus isPaid holderGroups';
  const [air, asub, ind] = await Promise.all([
    idsByModel.Airlines.size
      ? Airlines.find({ _id: { $in: [...idsByModel.Airlines] } }).select(select).lean() : [],
    idsByModel.AirlinesSubscription.size
      ? AirlinesSubscription.find({ _id: { $in: [...idsByModel.AirlinesSubscription] } }).select(select).lean() : [],
    idsByModel.Individual.size
      ? Individual.find({ _id: { $in: [...idsByModel.Individual] } }).select(select).lean() : [],
  ]);

  const regMap = new Map();
  for (const r of [...air, ...asub, ...ind]) regMap.set(String(r._id), r);

  for (const row of rows) {
    // 'void' is a terminal state — the live registration state must not resurrect it.
    if (row.status === 'void') continue;
    const reg = regMap.get(String(row.registrationId));
    if (!reg) continue;

    if (reg.invoiceNumber && normalizeInvoiceNumber(reg.invoiceNumber) === row.invoiceNumber) {
      row.status = reg.paymentStatus === 'paid' ? 'paid' : 'pending';
      continue;
    }
    const grp = (reg.holderGroups || []).find(
      g => g.invoiceNumber && normalizeInvoiceNumber(g.invoiceNumber) === row.invoiceNumber,
    );
    if (grp) row.status = grp.paymentStatus === 'paid' ? 'paid' : 'pending';
  }

  return rows;
}

/**
 * Every invoice belonging to one registration.
 * Non-admins never see a pro-forma wire invoice that is still awaiting approval.
 */
async function listForRegistration(registrationId, { isAdmin = false } = {}) {
  const query = isAdmin
    ? { registrationId }
    : { registrationId, wirePending: { $ne: true } };

  const hidden = await hiddenNumbersFor(registrationId);
  const invoices = (await Invoice.find(query).lean())
    .filter(inv => !hidden.has(normalizeInvoiceNumber(inv.invoiceNumber)));

  // Enrich with the Stripe reference the payment carries, for admin display.
  const paymentIds = invoices.map(i => i.paymentId).filter(Boolean);
  if (paymentIds.length) {
    const payments = await Payment.find({ _id: { $in: paymentIds } })
      .select('_id purpose stripePaymentIntentId').lean();
    const meta = new Map(payments.map(p => [String(p._id), p]));
    for (const inv of invoices) {
      const p = inv.paymentId ? meta.get(String(inv.paymentId)) : null;
      if (!p) continue;
      if ((!inv.purpose || inv.purpose === 'payment') && p.purpose && p.purpose !== 'payment') {
        inv.purpose = p.purpose;
      }
      inv.stripePaymentIntentId = inv.stripePaymentIntentId || p.stripePaymentIntentId || '';
    }
  }

  await applyLiveStatus(invoices);
  return { invoices: invoices.sort(byNewestFirst), hidden: [...hidden] };
}

/** Every invoice in the system, for the admin invoices dashboard. */
async function listAll() {
  const invoices = await Invoice.find({}).lean();

  const rows = invoices.map(inv => ({
    invoiceNumber:     normalizeInvoiceNumber(inv.invoiceNumber),
    invoiceId:         inv._id,
    source:            'invoice',
    registrationId:    inv.registrationId,
    registrationModel: inv.registrationModel,
    recipientName:     inv.recipientName    || inv.draft?.recipientName    || '',
    recipientCompany:  inv.recipientCompany || inv.draft?.recipientCompany || '',
    totalAmount:       inv.totalAmount || 0,
    status:            inv.status || '',
    purpose:           inv.purpose || 'payment',
    wirePending:       !!inv.wirePending,
    adminGenerated:    !!inv.adminGenerated,
    voided:            inv.status === 'void',
    orphaned:          !!inv.orphaned,
    createdAt:         inv.createdAt,
    issueDate:         inv.issueDate,
    paidAt:            inv.paidAt,
    draft:             inv.draft || null,
  })).filter(r => r.invoiceNumber);

  // Respect deletions an admin made before the store existed (see hiddenNumbersFor).
  const hiddenMap = await hiddenNumbersForMany(rows.map(r => r.registrationId).filter(Boolean));
  const visible = rows.filter((r) => {
    const hidden = hiddenMap.get(String(r.registrationId));
    return !(hidden && hidden.has(r.invoiceNumber));
  });

  await applyLiveStatus(visible);
  return visible.sort(byNewestFirst);
}

// ─────────────────────────────────────────────────────────────────────────────
// Backfill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collapse invoices that share a paymentId down to one.
 *
 * Historic data can contain duplicates, because before the unique index existed
 * the confirm path and the Stripe webhook could each mint an invoice for the
 * same PaymentIntent. Keeps the OLDEST document (the one the customer is most
 * likely to have already seen), deletes the rest, and releases their numbers so
 * they return to circulation instead of being stranded.
 *
 * Must run before the unique index is built, or the build fails on the dupes.
 */
async function dedupeInvoicesByPayment() {
  const groups = await Invoice.aggregate([
    { $match: { paymentId: { $ne: null } } },
    { $group: { _id: '$paymentId', ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  let removed = 0;
  for (const g of groups) {
    // eslint-disable-next-line no-await-in-loop
    const docs = await Invoice.find({ _id: { $in: g.ids } }).sort({ createdAt: 1 }).lean();
    const [, ...losers] = docs;
    for (const loser of losers) {
      // eslint-disable-next-line no-await-in-loop
      await Invoice.deleteOne({ _id: loser._id });
      removed += 1;
      // eslint-disable-next-line no-await-in-loop
      await releaseInvoiceNumber(loser.invoiceNumber).catch(() => {});
    }
  }
  return removed;
}

/**
 * Materialise every invoice number that exists only as a legacy reference into a
 * real Invoice document.
 *
 * Before this, the invoice lists had to UNION three sources at read time —
 * Invoice docs, paid Payment rows, and Renewal rows — because older records
 * carried a number but never got a document. That union is why the admin
 * dashboard and the customer page could disagree, and why an invoice number
 * already assigned to a customer could be missing from the admin dashboard.
 *
 * After this runs, the Invoice collection holds everything and every reader can
 * simply query it. Idempotent: an invoice number that already has a document is
 * skipped, so it is safe to run on every boot.
 *
 * Sources, in precedence order (first one wins for a given number):
 *   1. paid Payment rows        — carry a full invoiceSnapshot
 *   2. Renewal rows             — carry plan/price/term
 *   3. registration mirrors     — reg.invoiceNumber with no other backing
 *   4. airline holderGroups     — per-add-on invoice numbers
 */
async function backfillLegacyInvoices({ verbose = false, dedupe = false } = {}) {
  // Collapsing duplicates DELETES documents, so it is opt-in: the operator-run
  // script asks for it, an unattended production boot does not.
  const deduped = dedupe ? await dedupeInvoicesByPayment() : 0;
  if (deduped && verbose) console.log(`[invoiceBackfill] removed ${deduped} duplicate invoice(s)`);

  // createIndexes (not syncIndexes): it adds what is missing and drops NOTHING,
  // so an index created by hand in production is never silently removed. The
  // unique paymentId index cannot build while duplicates remain — that is logged,
  // and `node scripts/reconcileInvoices.js` is the fix.
  try {
    await Invoice.createIndexes();
  } catch (err) {
    console.warn('[invoiceBackfill] index build skipped:', err.message);
  }

  // Numbers an admin already deleted must NOT be recreated from the Payment /
  // Renewal / mirror rows they left behind. They are freed for reuse instead.
  const hiddenAll = new Set();
  for (const Model of [Airlines, Individual]) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await Model.find({ hiddenInvoiceNumbers: { $exists: true, $ne: [] } })
      .select('hiddenInvoiceNumbers').lean();
    rows.forEach(r => (r.hiddenInvoiceNumbers || []).forEach(n => {
      const norm = normalizeInvoiceNumber(n);
      if (norm) hiddenAll.add(norm);
    }));
  }

  const created = [];
  const known = new Set(
    (await Invoice.find({}).select('invoiceNumber').lean())
      .map(i => normalizeInvoiceNumber(i.invoiceNumber))
      .filter(Boolean),
  );

  const skippedHidden = [];
  const claim = (num) => {
    const n = normalizeInvoiceNumber(num);
    if (!n || known.has(n)) return null;
    if (hiddenAll.has(n)) {           // deleted by an admin — leave it deleted
      known.add(n);
      skippedHidden.push(n);
      return null;
    }
    known.add(n);
    return n;
  };

  const save = async (payload) => {
    try {
      const doc = await Invoice.create(payload);
      created.push(doc.invoiceNumber);
      if (verbose) console.log(`[invoiceBackfill] created ${doc.invoiceNumber}`);
    } catch (err) {
      // A concurrent writer won the unique index — that is fine, the number is
      // represented either way.
      if (err?.code !== 11000) {
        console.warn(`[invoiceBackfill] ${payload.invoiceNumber} failed:`, err.message);
      }
    }
  };

  // 1 ── paid Payments -------------------------------------------------------
  const payments = await Payment.find({ isPaid: true }).lean();
  for (const p of payments) {
    const num = claim(p.invoiceNumber);
    if (!num) continue;
    const snap = p.invoiceSnapshot || {};
    const total = Number(snap.totalPaid || snap.subtotal || p.amountDollars || 0);
    const isAirline = p.registrationModel !== 'Individual';
    const issueDate = p.paidAt || p.createdAt || new Date();
    // eslint-disable-next-line no-await-in-loop
    await save({
      invoiceNumber:     num,
      paymentId:         p._id,
      registrationId:    p.registrationId,
      registrationModel: p.registrationModel,
      status:            'paid',
      issueDate,
      payableBy:         payableByDate(issueDate),
      paidAt:            p.paidAt || issueDate,
      recipientName:     snap.name || '',
      recipientCompany:  isAirline ? (snap.airlineName || snap.name || '') : '',
      recipientContact:  snap.name || '',
      recipientAddress1: snap.address || '',
      recipientEmail:    snap.email || '',
      recipientPhone:    snap.phone || '',
      subscriptionPlan:  snap.subscriptionPlan || '',
      subscriptionDate:  snap.subscriptionDate || issueDate,
      expirationDate:    snap.expirationDate || null,
      isAirline,
      lineItems: p.invoiceDraft?.lineItems?.length ? p.invoiceDraft.lineItems : [{
        description: `Agent For Service - ${(snap.subscriptionPlan || '').replace(' Subscription Plan', '').replace(' Plan', '') || 'Subscription'}`,
        quantity:    isAirline ? Number(snap.holderCount || 1) : 1,
        unitPrice:   isAirline ? Number(snap.pricePerCert || total) : total,
        totalPrice:  total,
      }],
      subtotal:      total,
      tax:           0,
      totalAmount:   total,
      currency:      'USD',
      paymentMethod: p.paymentMethodType || '',
      purpose:       p.purpose || 'payment',
      draft:         p.invoiceDraft || null,
    });
  }

  // 2 ── Renewals ------------------------------------------------------------
  const renewals = await Renewal.find({}).lean();
  for (const r of renewals) {
    const num = claim(r.invoiceNumber);
    if (!num) continue;
    const total = Number(r.price || 0);
    const issueDate = r.paidAt || r.createdAt || new Date();
    // eslint-disable-next-line no-await-in-loop
    await save({
      invoiceNumber:     num,
      paymentId:         r.paymentId || null,
      registrationId:    r.registrationId,
      registrationModel: r.registrationModel,
      status:            'paid',
      issueDate,
      payableBy:         payableByDate(issueDate),
      paidAt:            r.paidAt || issueDate,
      subscriptionPlan:  r.plan || '',
      subscriptionDate:  r.activationDate || issueDate,
      expirationDate:    r.expiresAt || null,
      isAirline:         r.registrationModel !== 'Individual',
      lineItems: [{
        description: `Agent For Service - Renewal (${(r.plan || '').replace(' Subscription Plan', '').replace(' Plan', '')})`.trim(),
        quantity:    1,
        unitPrice:   total,
        totalPrice:  total,
      }],
      subtotal:    total,
      tax:         0,
      totalAmount: total,
      currency:    'USD',
      purpose:     'renewal',
    });
  }

  // 3 & 4 ── registration mirrors and holder groups --------------------------
  const regSources = [
    ['Individual', Individual],
    ['Airlines', Airlines],
    ['AirlinesSubscription', AirlinesSubscription],
  ];

  for (const [modelName, Model] of regSources) {
    // eslint-disable-next-line no-await-in-loop
    const regs = await Model.find({}).lean();
    for (const reg of regs) {
      const isAirline = modelName !== 'Individual';
      const name = isAirline
        ? [reg.firstName, reg.lastName].filter(Boolean).join(' ')
        : [reg.firstName, reg.lastName].filter(Boolean).join(' ');

      const mirrors = [
        { num: reg.invoiceNumber, purpose: 'payment', plan: reg.subscriptionPlan, total: isAirline ? reg.totalAmount : reg.price, expires: reg.expirationDate, starts: reg.subscriptionDate, paid: reg.paymentStatus === 'paid' },
        { num: reg.nextRenewal?.invoiceNumber, purpose: 'renewal', plan: reg.nextRenewal?.plan, total: reg.nextRenewal?.price, expires: reg.nextRenewal?.expiresAt, starts: reg.nextRenewal?.activationDate, paid: !!reg.nextRenewal?.paidAt },
        ...(reg.holderGroups || []).map(g => ({
          num: g.invoiceNumber, purpose: 'holder-upgrade', plan: g.plan, total: g.amount,
          expires: g.expirationDate, starts: g.subscriptionDate, paid: g.paymentStatus === 'paid',
          holders: g.count, ppc: g.pricePerCert,
        })),
      ];

      for (const m of mirrors) {
        const num = claim(m.num);
        if (!num) continue;
        const total = Number(m.total || 0);
        const issueDate = m.starts || reg.createdAt || new Date();
        // eslint-disable-next-line no-await-in-loop
        await save({
          invoiceNumber:     num,
          paymentId:         null,
          registrationId:    reg._id,
          registrationModel: modelName,
          status:            m.paid ? 'paid' : 'issued',
          issueDate,
          payableBy:         payableByDate(issueDate),
          paidAt:            m.paid ? issueDate : null,
          recipientName:     name,
          recipientCompany:  isAirline ? (reg.airlineName || name) : '',
          recipientContact:  name,
          recipientAddress1: [reg.addressLine1, reg.city, reg.state, reg.postalCode, reg.country].filter(Boolean).join(', '),
          recipientEmail:    reg.email || '',
          recipientPhone:    reg.phone || '',
          subscriptionPlan:  m.plan || '',
          subscriptionDate:  issueDate,
          expirationDate:    m.expires || null,
          isAirline,
          lineItems: [{
            description: `Agent For Service - ${(m.plan || '').replace(' Subscription Plan', '').replace(' Plan', '') || 'Subscription'}`,
            quantity:    Number(m.holders || (isAirline ? reg.committedCount || 1 : 1)),
            unitPrice:   Number(m.ppc || (isAirline ? reg.pricePerCertificate || 0 : total)),
            totalPrice:  total,
          }],
          subtotal:    total,
          tax:         0,
          totalAmount: total,
          currency:    'USD',
          purpose:     m.purpose,
          draft:       reg.invoiceDraft && normalizeInvoiceNumber(reg.invoiceDraft.invoiceNumber) === num
            ? reg.invoiceDraft
            : null,
        });
      }
    }
  }

  return {
    created: created.length,
    invoiceNumbers: created,
    deduped,
    skippedHidden: skippedHidden.length,
  };
}

module.exports = {
  issueInvoice,
  voidByNumber,
  markRegistrationDeleted,
  ensureInvoiceForPayment,
  backfillLegacyInvoices,
  clearStaleMirrors,
  dedupeInvoicesByPayment,
  adminCreateInvoice,
  saveAdminDraft,
  setStatus,
  deleteByNumber,
  listForRegistration,
  listAll,
  syncMirrors,
  buildDraft,
  byNewestFirst,
};
