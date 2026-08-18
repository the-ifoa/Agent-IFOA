'use strict';

/**
 * invoiceService.js — COMPATIBILITY SHIM.
 *
 * The real implementation now lives in services/invoiceStore.js, which is the
 * single module allowed to touch the Invoice collection.
 *
 * This file exists only so the ~20 existing call sites in
 * paymentController / airlinesController / individualController keep working
 * unchanged while every one of them is funnelled through the same store. Prefer
 * requiring invoiceStore directly in new code.
 *
 * Behavioural note for callers: issuance is now REFUSED unless the money has
 * settled — a paid Payment row, an explicit adminGenerated off-Stripe payment,
 * or an explicit wirePending pro-forma invoice. Passing none of these throws
 * instead of quietly minting an invoice (and burning a number) for a payment
 * that never completed. See invoiceStore.assertIssuable.
 */

const invoiceStore = require('./invoiceStore');

/** @deprecated use invoiceStore.issueInvoice */
async function createOrUpdateInvoice(opts) {
  return invoiceStore.issueInvoice(opts);
}

module.exports = {
  createOrUpdateInvoice,
  buildDraft: invoiceStore.buildDraft,
};
