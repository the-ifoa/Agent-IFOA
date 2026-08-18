/**
 * InvoiceCounter.js
 *
 * Per-year invoice sequence allocator.
 *
 * Format: Invoice US-{sequence}-{YY}   e.g.  Invoice US-350-26
 * One document per calendar year; the sequence restarts each new year.
 *
 * TWO FIELDS, TWO JOBS
 * ────────────────────
 *  sequence — a monotonic HIGH-WATER MARK. Never decreases. `$inc` on it is a
 *             single atomic MongoDB operation, so two concurrent allocations can
 *             never receive the same number (this replaces the old
 *             scan-the-whole-DB-then-write approach, which raced).
 *
 *  released — sequences that were issued and later freed (invoice deleted).
 *             Kept sorted ascending so `$pop: -1` always yields the LOWEST free
 *             number. This is what makes a deleted invoice number reusable:
 *             reuse is now an explicit, recorded act rather than a side effect
 *             of a number happening to be absent from a full-collection scan.
 *
 * See services/invoiceNumberService.js for the allocate / release API. Nothing
 * else may write to this collection.
 */
const mongoose = require('mongoose');

const InvoiceCounterSchema = new mongoose.Schema({
  year:     { type: Number, required: true, unique: true, index: true },
  sequence: { type: Number, default: 0 },
  released: { type: [Number], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('InvoiceCounter', InvoiceCounterSchema);
