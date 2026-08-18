'use strict';

/**
 * reconcileInvoices.js
 *
 * Repairs the invoice subsystem against whatever the database actually holds.
 * Safe and idempotent — the server runs the same routine on every boot; this
 * script exists so an operator can run it on demand and see the report.
 *
 * What it does, in order:
 *   1. Collapses duplicate invoices that share a paymentId (legacy confirm-vs-
 *      webhook races), releasing the losers' numbers.
 *   2. Builds the unique paymentId index so the duplicate cannot recur.
 *   3. Materialises every invoice number that exists only as a legacy Payment /
 *      Renewal / registration reference into a real Invoice document, so the
 *      admin dashboard and the customer's page read one collection.
 *   4. Rebuilds the per-year sequence allocator: high-water mark plus the list
 *      of freed numbers available for reuse.
 *
 * Usage:
 *   node scripts/reconcileInvoices.js
 *   node scripts/reconcileInvoices.js --year 2026
 */

require('dotenv').config();
const mongoose = require('mongoose');

const invoiceStore = require('../services/invoiceStore');
const { reconcileInvoiceSequences } = require('../services/invoiceNumberService');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected\n');

  const backfill = await invoiceStore.backfillLegacyInvoices({ verbose: true, dedupe: !process.argv.includes('--no-dedupe') });
  console.log(`duplicates removed : ${backfill.deduped}`);
  console.log(`invoices created   : ${backfill.created}`);
  console.log(`left deleted       : ${backfill.skippedHidden} (previously removed by an admin)`);
  if (backfill.invoiceNumbers.length) {
    console.log(`                     ${backfill.invoiceNumbers.join(', ')}`);
  }

  // After the backfill, any mirror still pointing at a number that no Invoice /
  // Payment / Renewal carries is stale and is silently holding that number out of
  // circulation. Clear those pointers before rebuilding the counter.
  const stale = await invoiceStore.clearStaleMirrors({ verbose: true });
  console.log(`stale pointers      : ${stale.cleared} cleared`);
  if (stale.freed.length) console.log(`                      freed: ${stale.freed.join(', ')}`);

  const year = arg('year') ? Number(arg('year')) : undefined;
  const counter = await reconcileInvoiceSequences(year);
  console.log(`\nyear               : ${counter.year}`);
  console.log(`highest number used: ${counter.sequence}`);
  console.log(`free for reuse     : ${counter.released.length ? counter.released.join(', ') : '(none)'}`);

  await mongoose.disconnect();
  console.log('\nDone.');
})().catch((err) => {
  console.error('reconcileInvoices failed:', err);
  process.exit(1);
});
