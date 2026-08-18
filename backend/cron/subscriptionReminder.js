'use strict';

const cron       = require('node-cron');
const Airlines   = require('../models/Airlines');
const Individual = require('../models/Individual');
const Renewal    = require('../models/Renewal');
const { sendExpiryReminder } = require('../services/emailService');

const UNLIMITED = 'Unlimited Plan';

// Window boundaries in milliseconds
const MS_PER_DAY  = 24 * 60 * 60 * 1000;
const WINDOWS = [
  { days: 60, field: 'expiryReminder60SentAt' },
  { days: 30, field: 'expiryReminder30SentAt' },
];

// ── Hard cap: how often a customer may be reminded ───────────────────────────
// At most MAX_REMINDERS_PER_MONTH expiry reminders to the same subscription in any
// rolling REMINDER_WINDOW_DAYS period, enforced from a per-record send log.
//
// The per-window stamps above stop the SAME window re-firing; this is the
// independent ceiling that holds no matter how many windows exist, how often the
// job runs, or whether someone triggers it by hand.
const MAX_REMINDERS_PER_MONTH = Number(process.env.MAX_REMINDERS_PER_MONTH || 2);
const REMINDER_WINDOW_DAYS    = Number(process.env.REMINDER_WINDOW_DAYS || 30);

/**
 * Send the reminder for one window to a set of records, respecting the cap.
 *
 * @param {object}  Model         Airlines | Individual
 * @param {Array}   docs          candidate records for this window
 * @param {boolean} isAirline
 * @param {number}  days          the window (60 / 30)
 * @param {string}  field         the per-window stamp field
 * @param {Set}     sentThisRun   recipient emails already mailed in this pass
 * @returns {Promise<number>}     how many were actually sent
 */
async function sendWindowReminders(Model, docs, isAirline, days, field, sentThisRun) {
  const cutoff = Date.now() - REMINDER_WINDOW_DAYS * MS_PER_DAY;
  let sent = 0;

  for (const doc of docs) {
    // One customer, one email per run — even if two records for the same person
    // land in the same window.
    const recipient = String(doc.email || doc.paymentEmail || '').toLowerCase().trim();
    if (recipient && sentThisRun.has(recipient)) continue;

    // Prune the log to the rolling window, then apply the cap.
    const recent = (doc.expiryReminderLog || [])
      .map(d => new Date(d))
      .filter(d => d.getTime() >= cutoff);
    if (recent.length >= MAX_REMINDERS_PER_MONTH) {
      console.log(`[reminderCron] capped — ${Model.modelName} ${doc._id} already had ${recent.length} reminder(s) in ${REMINDER_WINDOW_DAYS} days`);
      continue;
    }

    try {
      const actualDays = doc.expirationDate
        ? Math.ceil((new Date(doc.expirationDate) - Date.now()) / MS_PER_DAY)
        : days;
      await sendExpiryReminder(doc, isAirline, actualDays);

      const now = new Date();
      // Writing the pruned array + this send both records and trims in one update.
      await Model.findByIdAndUpdate(doc._id, {
        $set: { [field]: now, expiryReminderLog: [...recent, now] },
      });
      if (recipient) sentThisRun.add(recipient);
      sent += 1;
    } catch (e) {
      console.error(`[reminderCron] ${Model.modelName} ${doc._id} ${days}d failed:`, e.message);
    }
  }
  return sent;
}

async function runReminders() {
  const now = Date.now();
  // Recipients already mailed in THIS pass — a customer never receives two
  // reminders from a single run, even across different windows.
  const sentThisRun = new Set();

  for (const { days, field } of WINDOWS) {
    const windowStart = new Date(now + (days - 3) * MS_PER_DAY);
    const windowEnd   = new Date(now + (days + 3) * MS_PER_DAY);
    const cooldown    = new Date(now - 20 * MS_PER_DAY); // don't re-send within 20 days

    // Only send reminders to records that:
    // 1. Are expiring within the window
    // 2. Are Active subscriptions (not Pending / Inactive)
    // 3. Are NOT on an Unlimited Plan (they never expire)
    // 4. Haven't received this reminder within the cooldown period
    // 5. Do NOT already have a queued renewal (nextRenewal.paidAt set) — they already renewed
    const baseQuery = {
      expirationDate: { $gte: windowStart, $lte: windowEnd },
      status: 'Active',
      subscriptionPlan: { $ne: UNLIMITED },
      $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: { $lt: cooldown } }],
      // Skip records where the user has already paid for a renewal
      'nextRenewal.paidAt': { $in: [null, undefined] },
    };

    const [airlines, individuals] = await Promise.all([
      Airlines.find(baseQuery).lean(),
      Individual.find(baseQuery).lean(),
    ]);

    const sentAir = await sendWindowReminders(Airlines, airlines, true, days, field, sentThisRun);
    const sentInd = await sendWindowReminders(Individual, individuals, false, days, field, sentThisRun);

    if (sentAir + sentInd > 0) {
      console.log(`[reminderCron] ${days}-day window: ${sentAir} airlines, ${sentInd} individuals notified`);
    }
  }
}

/**
 * activateMaturedRenewals
 *
 * Finds all queued Renewal docs whose activationDate has now passed
 * and promotes them to the live subscription on the parent record.
 * Runs daily so the worst-case delay is ~24 hours after expiry.
 *
 * Activation goes through performQueuedRenewalActivation — the SAME helper used
 * by the admin force-activate endpoint and the user auto-activate endpoint — so
 * holder removals, pricePerCertificate tier recompute, holderCount range,
 * Renewal doc status and the confirmation email behave identically no matter
 * which path triggers the activation.
 */
async function activateMaturedRenewals() {
  const now = new Date();
  // Lazy require avoids a circular import (paymentController is loaded by routes).
  const { performQueuedRenewalActivation } = require('../controller/paymentController');

  // Find all queued renewals whose activation window has arrived
  const due = await Renewal.find({
    status:         'queued',
    activationDate: { $lte: now },
  }).lean();

  if (!due.length) return;
  console.log(`[renewalCron] ${due.length} renewal(s) ready to activate`);

  for (const renewal of due) {
    const Model = renewal.registrationModel === 'Individual' ? Individual : Airlines;
    try {
      const doc = await Model.findById(renewal.registrationId);

      // Safety: only promote if this renewal is still the one queued on the record
      if (!doc || String(doc.nextRenewalId) !== String(renewal._id)) {
        // Already superseded or record gone — just mark it
        await Renewal.findByIdAndUpdate(renewal._id, { $set: { status: 'superseded' } });
        continue;
      }

      // Safety: do NOT activate if the current plan is still live.
      // This guards against test backdating where renewal.activationDate was
      // manually set to the past but the subscription's expirationDate is still future.
      // For Unlimited Plan docs there is no expirationDate — skip this guard.
      const docExpiry = doc.expirationDate ? new Date(doc.expirationDate) : null;
      if (docExpiry && docExpiry > now) {
        console.log(`[renewalCron] Skipping renewal ${renewal._id} — current plan still active until ${docExpiry.toISOString()}`);
        continue;
      }

      await performQueuedRenewalActivation(doc, Model, renewal.registrationModel, false);
      console.log(`[renewalCron] Activated renewal ${renewal._id} for ${renewal.registrationModel} ${renewal.registrationId}`);
    } catch (e) {
      console.error(`[renewalCron] Failed to activate renewal ${renewal._id}:`, e.message);
    }
  }
}

/**
 * activateMaturedGroupRenewals
 *
 * Activates queued holder-group renewals (stored on Airlines.holderGroups[].nextRenewal)
 * whose activationDate has passed. Independent of the Renewal collection.
 */
async function activateMaturedGroupRenewals() {
  const now = new Date();
  const { performQueuedGroupRenewals } = require('../controller/paymentController');
  const airlines = await Airlines.find({
    'holderGroups.nextRenewal.activationDate': { $lte: now, $ne: null },
  });
  if (!airlines.length) return;
  console.log(`[renewalCron] ${airlines.length} airline(s) with due group renewals`);
  for (const doc of airlines) {
    try {
      await performQueuedGroupRenewals(doc, Airlines);
    } catch (e) {
      console.error(`[renewalCron] Group renewal activation failed for ${doc._id}:`, e.message);
    }
  }
}

/**
 * Reclaim invoice numbers that were claimed but never attached to a record.
 *
 * The payment paths hand a claim back the moment they know it is unused, so this
 * is a safety net rather than the primary mechanism — it catches anything lost to
 * a process crash between claiming a number and writing the row. Without it such a
 * number stays a permanent hole in the sequence until the next restart.
 *
 * Cheap and idempotent: it recomputes the high-water mark and the free list from
 * what the database actually references.
 */
async function reclaimInvoiceNumbers() {
  const { reconcileInvoiceSequences } = require('../services/invoiceNumberService');
  const invoiceStore = require('../services/invoiceStore');
  const stale = await invoiceStore.clearStaleMirrors();
  if (stale.cleared) console.log(`[invoiceSweep] cleared ${stale.cleared} stale invoice pointer(s)`);
  const result = await reconcileInvoiceSequences();
  if (result.released.length) {
    console.log(`[invoiceSweep] ${result.released.length} number(s) available for reuse: ${result.released.join(', ')}`);
  }
  return result;
}

function startSubscriptionReminderCron() {
  // Run daily at 8:00 AM UTC
  cron.schedule('0 8 * * *', () => {
    console.log('[reminderCron] Running subscription expiry check...');
    runReminders().catch((e) => console.error('[reminderCron] Error:', e.message));
    activateMaturedRenewals().catch((e) => console.error('[renewalCron] Error:', e.message));
    activateMaturedGroupRenewals().catch((e) => console.error('[renewalCron][group] Error:', e.message));
    reclaimInvoiceNumbers().catch((e) => console.error('[invoiceSweep] Error:', e.message));
  });
  console.log('[reminderCron] Scheduled — runs daily at 08:00 UTC');
}

// runReminders is exported so the reminder targeting (which windows fire, who is
// skipped) can be verified directly rather than only via the daily schedule.
module.exports = {
  startSubscriptionReminderCron,
  runReminders,
  activateMaturedRenewals,
  activateMaturedGroupRenewals,
  reclaimInvoiceNumbers,
};
