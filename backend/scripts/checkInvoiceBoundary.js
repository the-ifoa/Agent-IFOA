#!/usr/bin/env node
'use strict';

/**
 * checkInvoiceBoundary.js
 *
 * Fails if any file outside services/invoiceStore.js writes to the Invoice
 * collection directly.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every invoice defect this codebase has had shared one root cause: a flow that
 * changed invoice state without going through the store. Each one looked
 * harmless in isolation and each one silently diverged the three places invoice
 * data is mirrored — the Invoice document, the Payment row, and the
 * registration's own invoiceNumber fields. Between them they:
 *
 *   - handed the same number to two invoices (confirm racing the webhook)
 *   - burned a number on every renewal (self-collision on its own Renewal row)
 *   - burned a number on every admin cancellation (delete by hand, no release)
 *   - showed the admin one invoice number and the customer another (rename by hand)
 *   - marked unrelated wire invoices paid (over-broad updateMany)
 *
 * A grep would have caught all of them. That grep is this file.
 *
 * Usage:  node scripts/checkInvoiceBoundary.js     (exit 1 on violation)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Only this module may mutate the Invoice collection.
const OWNER = path.join('services', 'invoiceStore.js');

// Files exempt because they legitimately operate below the store: the destructive
// reset tool, and the test suite which fabricates legacy states on purpose.
// Exempt because they legitimately operate below the store: the destructive reset
// tool, and the verification harnesses, which fabricate legacy states and reset
// collections between scenarios on purpose.
const EXEMPT = [
  path.join('scripts', 'resetInvoices.js'),
  path.join('scripts', 'verifyInvoices.js'),
  path.join('scripts', 'verifyNotifications.js'),
  path.join('scripts', 'verifyPaymentRace.js'),
  path.join('scripts', 'verifyEmailLinks.js'),
  path.join('scripts', 'verifyArchitecture.js'),
  path.join('scripts', 'checkInvoiceBoundary.js'),
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'backups', 'public_html', 'assets']);

// Invoice.<mutating method>(  — note this deliberately does NOT flag reads
// (find/findOne/countDocuments/aggregate/distinct), which any module may perform.
const MUTATION = /\bInvoice\s*\.\s*(create|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findByIdAndUpdate|findByIdAndDelete|bulkWrite)\s*\(/;

// `InvoiceCounter.` and `AirlinesSubscription.` must not be mistaken for `Invoice.`
const FALSE_FRIEND = /\b(InvoiceCounter|InvoiceNumber)\s*\./;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (rel === OWNER || EXEMPT.includes(rel)) continue;

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (!MUTATION.test(code)) return;
    if (FALSE_FRIEND.test(code)) return;
    violations.push({ file: rel, line: i + 1, text: line.trim() });
  });
}

if (!violations.length) {
  console.log('invoice boundary: OK — services/invoiceStore.js is the only writer.');
  process.exit(0);
}

console.error(`\ninvoice boundary VIOLATED — ${violations.length} direct write(s) to the Invoice collection:\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.text}\n`);
}
console.error('Route these through services/invoiceStore.js instead:');
console.error('  create/update an invoice  → issueInvoice() / adminCreateInvoice()');
console.error('  rename or edit            → saveAdminDraft()');
console.error('  paid ↔ pending            → setStatus()');
console.error('  remove + free the number  → deleteByNumber()');
console.error('  retire but keep the record→ voidByNumber()');
console.error('  registration deleted      → markRegistrationDeleted()\n');
process.exit(1);
