'use strict';

/**
 * invoiceNumberService.js
 *
 * Allocates unique invoice numbers in the format:
 *   Invoice US-{sequence}-{YY}    e.g. Invoice US-1-26, Invoice US-350-26
 *
 * ─── WHY THIS IS AN ALLOCATOR AND NOT A SCANNER ──────────────────────────────
 * The previous implementation scanned six collections, picked the lowest unused
 * sequence, and then wrote it. That read-then-write window was a race: two
 * payments confirming at the same moment both saw the same "free" number, and
 * only the unique index stopped the duplicate — after the work had been done.
 *
 * Allocation is now a SINGLE atomic MongoDB operation against InvoiceCounter:
 *   - `$pop: { released: -1 }` takes the lowest previously-freed number, or
 *   - `$inc: { sequence: 1 }` mints the next new one.
 * MongoDB serialises concurrent updates to one document, so two callers can
 * never be handed the same sequence. No scanning on the hot path.
 *
 * ─── WHY GAPS ARE NOW ACTUALLY REUSED ────────────────────────────────────────
 * Reuse used to depend on a number being absent from every collection. Deleting
 * an invoice left its number behind on the Payment / Renewal / registration
 * mirror, so the scanner still saw it as "used" and the gap was never refilled.
 * Freeing is now explicit: releaseInvoiceNumber() records the sequence in the
 * `released` pool, and the next allocation hands it straight back out.
 *
 * PUBLIC API
 *   allocateInvoiceNumber()  — claim the next number (atomic). Aliased as
 *                              generateInvoiceNumber() for existing callers.
 *   releaseInvoiceNumber()   — give a number back to the pool.
 *   peekNextInvoiceNumber()  — preview without claiming (admin modal).
 *   reconcileInvoiceSequences() — rebuild the counter from live data (repair).
 */

const InvoiceCounter       = require('../models/InvoiceCounter');
const Payment              = require('../models/Payment');
const Invoice              = require('../models/Invoice');
const Renewal              = require('../models/Renewal');
const Individual           = require('../models/Individual');
const Airlines             = require('../models/Airlines');
const AirlinesSubscription = require('../models/AirlinesSubscription');

const PREFIX = 'Invoice US-';

function normalizeInvoiceNumber(value) {
  return String(value || '').trim();
}

/** Two-digit year suffix for a full year (2026 → "26"). */
function yy(year) {
  return String(year).slice(-2);
}

function formatInvoiceNumber(sequence, year) {
  return `${PREFIX}${sequence}-${yy(year)}`;
}

/** Split "Invoice US-350-26" → { sequence: 350, yy: 26 }; null when unparseable. */
function parseInvoiceNumber(value) {
  const m = /^Invoice US-(\d+)-(\d{2})$/.exec(normalizeInvoiceNumber(value));
  if (!m) return null;
  return { sequence: Number(m[1]), yy: Number(m[2]) };
}

/** Full year (2026) that a two-digit suffix belongs to. */
function fullYearFromYY(twoDigit) {
  return 2000 + Number(twoDigit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Claim the next invoice number for `year`. Atomic — safe under concurrency.
 *
 * Prefers the lowest previously-released sequence so deleted numbers are reused
 * before the counter advances; falls back to incrementing the high-water mark.
 */
async function allocateInvoiceNumber(yearOverride) {
  const year = yearOverride || new Date().getFullYear();

  // 1. Try to reuse the lowest released sequence.
  //    findOneAndUpdate returns the PRE-image, so we read the element this call
  //    popped. Concurrent callers are serialised by MongoDB's document-level
  //    atomicity and therefore each pop a different element.
  const popped = await InvoiceCounter.findOneAndUpdate(
    { year, 'released.0': { $exists: true } },
    { $pop: { released: -1 } },
    { new: false },
  ).lean();

  if (popped && Array.isArray(popped.released) && popped.released.length) {
    const seq = popped.released[0];
    // Keep the high-water mark at or above anything we hand out.
    await InvoiceCounter.updateOne({ year }, { $max: { sequence: seq } });
    return formatInvoiceNumber(seq, year);
  }

  // 2. Otherwise mint a brand-new sequence.
  const doc = await InvoiceCounter.findOneAndUpdate(
    { year },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return formatInvoiceNumber(doc.sequence, year);
}

/**
 * Return a number to the pool so the next allocation reuses it.
 *
 * Safe to call more than once — the `released: { $ne: seq }` guard makes the
 * push idempotent, and `$sort: 1` keeps the pool ordered so `$pop: -1` always
 * yields the lowest free number.
 *
 * Refuses to free a number that is still referenced anywhere, so a mistaken
 * release can never hand a live invoice's number to a second invoice.
 */
async function releaseInvoiceNumber(invoiceNumber) {
  const parsed = parseInvoiceNumber(invoiceNumber);
  if (!parsed) return false;

  if (await isInvoiceNumberTaken(invoiceNumber)) return false;

  const year = fullYearFromYY(parsed.yy);
  await InvoiceCounter.updateOne(
    { year, released: { $ne: parsed.sequence } },
    { $push: { released: { $each: [parsed.sequence], $sort: 1 } } },
    { upsert: true },
  );
  return true;
}

/**
 * The number allocateInvoiceNumber() would return next, WITHOUT claiming it.
 * Used by the admin invoice modal so opening and cancelling it never burns a
 * sequence. The number is only claimed when the invoice is actually saved.
 */
async function peekNextInvoiceNumber(yearOverride) {
  const year = yearOverride || new Date().getFullYear();
  const doc = await InvoiceCounter.findOne({ year }).lean();
  if (!doc) return formatInvoiceNumber(1, year);
  if (Array.isArray(doc.released) && doc.released.length) {
    return formatInvoiceNumber(Math.min(...doc.released), year);
  }
  return formatInvoiceNumber(Number(doc.sequence || 0) + 1, year);
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniqueness checks
// ─────────────────────────────────────────────────────────────────────────────

async function existsOnModel(Model, query, excludeId = null) {
  const row = await Model.findOne(query).select('_id').lean();
  if (!row) return false;
  return String(row._id) !== String(excludeId || '');
}

/** Is this number referenced by ANY record (optionally excluding known owners)? */
async function isInvoiceNumberTaken(invoiceNumber, opts = {}) {
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  if (!normalized) return false;

  const {
    excludePaymentId = null,
    excludeInvoiceId = null,
    excludeRenewalId = null,
    excludeRegistrationId = null,
    excludeRegistrationModel = null,
  } = opts;

  if (await existsOnModel(Payment, { invoiceNumber: normalized }, excludePaymentId)) return true;
  if (await existsOnModel(Invoice, { invoiceNumber: normalized }, excludeInvoiceId)) return true;

  // A Renewal row belonging to the SAME registration is not a collision — it is
  // that registration's own record of this very invoice. Excluding only by
  // renewalId missed this: a renewal's own freshly-written Renewal doc made its
  // number look taken, so a second number was allocated and the first stranded.
  // That burned one sequence number on every single renewal.
  const renewalQuery = { invoiceNumber: normalized };
  if (excludeRegistrationId) renewalQuery.registrationId = { $ne: excludeRegistrationId };
  if (await existsOnModel(Renewal, renewalQuery, excludeRenewalId)) return true;

  const regModels = [
    ['Individual', Individual],
    ['Airlines', Airlines],
    ['AirlinesSubscription', AirlinesSubscription],
  ];
  for (const [name, Model] of regModels) {
    const query = {
      $or: [
        { invoiceNumber: normalized },
        { 'nextRenewal.invoiceNumber': normalized },
        { 'lastRenewal.invoiceNumber': normalized },
        { 'holderGroups.invoiceNumber': normalized },
      ],
    };
    // eslint-disable-next-line no-await-in-loop
    if (await existsOnModel(Model, query, excludeRegistrationModel === name ? excludeRegistrationId : null)) {
      return true;
    }
  }

  return false;
}

/**
 * True only when `invoiceNumber` belongs to a DIFFERENT registration. A
 * registration's own Invoice/Payment/Renewal rows are not a collision, so an
 * admin can re-point a registration at its own number without a false error.
 */
async function isInvoiceNumberTakenByOtherRegistration(invoiceNumber, registrationId) {
  const norm = normalizeInvoiceNumber(invoiceNumber);
  if (!norm) return false;
  const regId = String(registrationId || '');

  const regQuery = {
    _id: { $ne: regId },
    $or: [
      { invoiceNumber: norm },
      { 'nextRenewal.invoiceNumber': norm },
      { 'lastRenewal.invoiceNumber': norm },
      { 'holderGroups.invoiceNumber': norm },
    ],
  };

  const [pay, inv, ren, ind, air, asub] = await Promise.all([
    Payment.findOne({ invoiceNumber: norm, registrationId: { $ne: regId } }).select('_id').lean(),
    Invoice.findOne({ invoiceNumber: norm, registrationId: { $ne: regId } }).select('_id').lean(),
    Renewal.findOne({ invoiceNumber: norm, registrationId: { $ne: regId } }).select('_id').lean(),
    Individual.findOne(regQuery).select('_id').lean(),
    Airlines.findOne(regQuery).select('_id').lean(),
    AirlinesSubscription.findOne(regQuery).select('_id').lean(),
  ]);

  return !!(pay || inv || ren || ind || air || asub);
}

// ─────────────────────────────────────────────────────────────────────────────
// Repair
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every sequence currently referenced anywhere, for one two-digit year.
 * Only used by reconcile — never on the allocation path.
 */
async function collectUsedSequences(twoDigitYear) {
  const used = new Set();
  const add = (value) => {
    const parsed = parseInvoiceNumber(value);
    if (parsed && parsed.yy === Number(twoDigitYear)) used.add(parsed.sequence);
  };

  const [payments, invoices, renewals, individuals, airlines, airSubs] = await Promise.all([
    Payment.find({}).select('invoiceNumber').lean(),
    Invoice.find({}).select('invoiceNumber').lean(),
    Renewal.find({}).select('invoiceNumber').lean(),
    Individual.find({}).select('invoiceNumber nextRenewal.invoiceNumber lastRenewal.invoiceNumber').lean(),
    Airlines.find({}).select('invoiceNumber nextRenewal.invoiceNumber lastRenewal.invoiceNumber holderGroups.invoiceNumber').lean(),
    AirlinesSubscription.find({}).select('invoiceNumber nextRenewal.invoiceNumber lastRenewal.invoiceNumber').lean(),
  ]);

  payments.forEach(d => add(d.invoiceNumber));
  invoices.forEach(d => add(d.invoiceNumber));
  renewals.forEach(d => add(d.invoiceNumber));
  [...individuals, ...airlines, ...airSubs].forEach((d) => {
    add(d.invoiceNumber);
    add(d.nextRenewal?.invoiceNumber);
    add(d.lastRenewal?.invoiceNumber);
    (d.holderGroups || []).forEach(g => add(g.invoiceNumber));
  });

  return used;
}

/**
 * Rebuild a year's counter from what the database actually contains.
 *
 * Sets `sequence` to the highest sequence in use and `released` to every gap
 * below it. Run once at boot (cheap, one pass) so the allocator inherits any
 * history created before this allocator existed, and so numbers freed by a
 * crash mid-issue are recovered rather than lost forever.
 */
async function reconcileInvoiceSequences(yearOverride) {
  const year = yearOverride || new Date().getFullYear();
  const used = await collectUsedSequences(yy(year));
  const highWater = used.size ? Math.max(...used) : 0;

  const released = [];
  for (let n = 1; n <= highWater; n += 1) {
    if (!used.has(n)) released.push(n);
  }

  await InvoiceCounter.updateOne(
    { year },
    { $set: { sequence: highWater, released } },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return { year, sequence: highWater, released };
}

module.exports = {
  // allocation
  allocateInvoiceNumber,
  generateInvoiceNumber: allocateInvoiceNumber, // back-compat alias
  releaseInvoiceNumber,
  peekNextInvoiceNumber,

  // checks
  isInvoiceNumberTaken,
  isInvoiceNumberTakenByOtherRegistration,

  // helpers
  normalizeInvoiceNumber,
  parseInvoiceNumber,
  formatInvoiceNumber,

  // repair
  reconcileInvoiceSequences,
  collectUsedSequences,
};
