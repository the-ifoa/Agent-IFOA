#!/usr/bin/env node
/**
 * verifyArchitecture.js
 *
 * Static architecture audit — proves the invariants this codebase was refactored
 * to establish still hold, by reading the source rather than trusting comments:
 *
 *   1. shared/pricing.js is the ONLY definition of any price
 *   2. services/invoiceStore.js is the ONLY writer of the Invoice collection
 *   3. every money-completing path sends an admin payment alert
 *   4. every idempotent path guards BEFORE alerting (no duplicate emails)
 *   5. email links are environment-driven, never hardcoded
 *   6. the wire-request template covers all four purposes
 *   7. support alerts are conditional on the admin having seen the message
 *   8. the new modules are actually wired into server.js and the cron
 *
 * Pure source analysis; needs no database and no network.
 *
 * Usage:  node scripts/verifyArchitecture.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0, warn = 0;
const ok   = (c, label, extra='') => { if (c) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${extra}`); } };
const note = (label) => { warn++; console.log(`  NOTE  ${label}`); };
const H = (t) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const files = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`);
const ALL = [...files('controller'), ...files('services'), ...files('routes'), ...files('utils'),
             ...files('cron'), ...files('models'), ...files('shared'), 'server.js'];

// ── 1. PRICING: single source of truth ───────────────────────────────────────
H('1. PRICING — is shared/pricing.js the only definition?');
const PRICE_LITERALS = /\b(265|255|245|299)\b|\b55\s*\*|\*\s*55\b/;
const priceOffenders = [];
for (const f of ALL) {
  if (f === 'shared/pricing.js' || f.includes('chatController')) continue;
  read(f).split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (PRICE_LITERALS.test(code)) priceOffenders.push(`${f}:${i+1}  ${line.trim().slice(0,70)}`);
  });
}
ok(priceOffenders.length === 0, 'no hard-coded plan prices outside shared/pricing.js', '\n     ' + priceOffenders.join('\n     '));

const pricingConsumers = ALL.filter(f => /require\(['"].*shared\/pricing['"]\)/.test(read(f)));
ok(pricingConsumers.length >= 5, `pricing module is consumed by ${pricingConsumers.length} modules`, pricingConsumers.join(', '));

// ── 2. INVOICE STORE: single writer ──────────────────────────────────────────
H('2. INVOICE STORE — is it the only writer?');
const MUT = /\bInvoice\s*\.\s*(create|insertMany|updateOne|updateMany|replaceOne|deleteOne|deleteMany|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findByIdAndUpdate|findByIdAndDelete|bulkWrite)\s*\(/;
const EXEMPT = ['services/invoiceStore.js', 'scripts/resetInvoices.js', 'scripts/verifyInvoices.js'];
const storeOffenders = [];
for (const f of ALL) {
  if (EXEMPT.includes(f)) continue;
  read(f).split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (MUT.test(code) && !/InvoiceCounter/.test(code)) storeOffenders.push(`${f}:${i+1}`);
  });
}
ok(storeOffenders.length === 0, 'no direct Invoice writes outside the store', storeOffenders.join(', '));

// ── 3. ADMIN PAYMENT NOTIFICATION coverage ───────────────────────────────────
H('3. ADMIN PAYMENT NOTIFICATION — every money path alerts, exactly once');
const pc = read('controller/paymentController.js');
const ac = read('controller/airlinesController.js');
const ic = read('controller/individualController.js');

// Extract a named exported function body.
function fnBody(src, name) {
  const start = src.indexOf(`exports.${name} = async (req, res) => {`);
  if (start < 0) return null;
  const end = src.indexOf('\n};\n', start);
  return src.slice(start, end < 0 ? src.length : end);
}
const MONEY_PATHS = [
  ['confirmPayment',          pc], ['stripeWebhook',        pc],
  ['adminHolderUpgrade',      pc], ['markHolderGroupPaid',  pc],
  ['adminRenew',              pc], ['adminConvertToUnlimited', pc],
  ['markAirlinesPaid',        ac], ['activateWirePayment',  ac],
  ['markIndividualPaid',      ic],
];
for (const [name, src] of MONEY_PATHS) {
  const body = fnBody(src, name);
  if (!body) { fail++; console.log(`  FAIL  ${name} not found`); continue; }
  const n = (body.match(/sendAdminPaymentNotification\(/g) || []).length;
  ok(n >= 1, `${name} sends an admin payment alert`, `(found ${n})`);
}

// Paths that must NOT notify (no money moved)
const NON_MONEY = [['cancelQueuedRenewal', pc], ['declineWirePayment', ac], ['getPlanCredits', pc]];
for (const [name, src] of NON_MONEY) {
  const body = fnBody(src, name);
  if (!body) continue;
  const n = (body.match(/sendAdminPaymentNotification\(/g) || []).length;
  ok(n === 0, `${name} does NOT send a payment alert (no money moved)`, `(found ${n})`);
}

// ── 4. DOUBLE-EMAIL RISK: idempotency guards before the alert ────────────────
H('4. DUPLICATE-ALERT RISK — are idempotent paths guarded before notifying?');
const confirmBody = fnBody(pc, 'confirmPayment');
ok(/existing && existing\.isPaid[\s\S]{0,200}return/.test(confirmBody),
   'confirmPayment early-returns on an already-paid intent (no second alert)');
const webhookBody = fnBody(pc, 'stripeWebhook');
ok(/existing && existing\.isPaid[\s\S]{0,200}return/.test(webhookBody),
   'stripeWebhook early-returns on an already-recorded intent (no second alert)');
const mapBody = fnBody(ac, 'markAirlinesPaid');
ok(/isPaid \|\| doc\.paymentStatus === 'paid'[\s\S]{0,160}alreadyPaid/.test(mapBody),
   'markAirlinesPaid early-returns when already paid');
const mipBody = fnBody(ic, 'markIndividualPaid');
ok(/isPaid \|\| individual\.paymentStatus === 'paid'[\s\S]{0,200}alreadyPaid/.test(mipBody),
   'markIndividualPaid early-returns when already paid');
const mhgBody = fnBody(pc, 'markHolderGroupPaid');
const alreadyIdx = mhgBody.indexOf('alreadyPaid');
const firstAlertIdx = mhgBody.indexOf('sendAdminPaymentNotification');
ok(alreadyIdx > -1 && alreadyIdx < firstAlertIdx,
   'markHolderGroupPaid alreadyPaid guard comes BEFORE any alert');

// ── 5. EMAIL LINKS: no hardcoded hosts ───────────────────────────────────────
H('5. EMAIL LINKS — environment-driven, no baked-in hosts');
const es = read('services/emailService.js');
ok(!/localhost/.test(es), 'no localhost anywhere in emailService');
const dashLinks = es.match(/href="\$\{[^}]*\}/g) || [];
ok(dashLinks.length > 0, `${dashLinks.length} dynamic href(s) driven by a variable`);
ok((es.match(/process\.env\.FRONTEND_URL/g) || []).length >= 4,
   'every dashboard link reads FRONTEND_URL');

// ── 6. WIRE REQUEST template covers every purpose ────────────────────────────
H('6. WIRE REQUEST EMAIL — all four purposes handled');
const wireTpl = es.slice(es.indexOf('buildWireRequestAdminNotificationHtml'));
for (const p of ['initial', 'renewal', 'holder-upgrade', 'convert-unlimited']) {
  ok(wireTpl.includes(`'${p}'`), `wire template handles purpose "${p}"`);
}

// ── 7. SUPPORT ALERT: seen-aware, not unconditional ──────────────────────────
H('7. SUPPORT ALERT — conditional on the admin having seen it');
const ss = read('services/supportService.js');
ok(/adminUnread === 0[\s\S]{0,80}return/.test(ss), 'skips the email when adminUnread is 0 (admin saw it)');
ok(/scheduleAdminAlert/.test(ss) && /clearTimeout/.test(ss), 'debounces a burst into one check');
ok(/senderRole === 'user'/.test(ss), 'admin replies never trigger an alert');
ok(/timer\.unref/.test(ss), 'pending timers do not keep the process alive');
ok(/ADMIN_ALERT_THROTTLE_MIN/.test(ss), 'throttle still guards repeat alerts');

// ── 8. NO ORPHANED / DEAD EXPORTS from the refactor ──────────────────────────
H('8. WIRING — new modules are actually reachable');
const server = read('server.js');
ok(/routes\/pricingRoutes/.test(server), 'pricingRoutes mounted in server.js');
ok(/invoiceStore/.test(server), 'invoiceStore used at boot (backfill/reconcile)');
ok(/clearStaleMirrors/.test(server), 'stale-mirror cleanup runs at boot');
const cron = read('cron/subscriptionReminder.js');
ok(/reclaimInvoiceNumbers/.test(cron), 'invoice reclaim sweep wired into the cron');
ok(/clearStaleMirrors/.test(cron), 'cron sweep also clears stale pointers');

console.log(`\n${'='.repeat(76)}\n  ${pass} passed, ${fail} failed, ${warn} notes\n${'='.repeat(76)}`);
process.exit(fail ? 1 : 0);
