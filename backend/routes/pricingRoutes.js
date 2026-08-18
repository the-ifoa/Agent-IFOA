'use strict';

/**
 * pricingRoutes.js
 *
 * Serves the canonical price tables (shared/pricing.js) to the browser so the
 * frontend can own ZERO price constants of its own.
 *
 *   GET  /api/pricing/config  — public. The full table set + a version stamp.
 *   POST /api/pricing/quote   — the authoritative amount for a scenario.
 *
 * Rule enforced by these two endpoints: whatever the customer is shown is
 * computed by the same code that later builds the Stripe PaymentIntent, so the
 * displayed price and the charged price cannot drift apart.
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const pricing = require('../shared/pricing');
const { activeCoverageAnchor } = require('../utils/holderGroups');

const Airlines = require('../models/Airlines');

// Attach req.user when a token is present, but never reject for its absence:
// the public register wizard quotes plans before the customer has an account.
// Registration-bound quotes below still demand a token explicitly.
function optionalAuth(req, res, next) {
  const hasToken = !!(req.headers.authorization || req.query?.token);
  if (!hasToken) return next();
  return auth(req, res, next);
}

// ── GET /api/pricing/config ──────────────────────────────────────────────────
// Public: prices are published marketing information and the registration
// wizard runs before the user has a token.
router.get('/config', (_req, res) => {
  const config = pricing.getPricingConfig();
  // Version-stamped and immutable for a short window — a price edit + redeploy
  // changes `version`, which is what the client caches on.
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ success: true, data: config });
});

// ── POST /api/pricing/quote ──────────────────────────────────────────────────
/**
 * Body:
 *   kind: 'individual' | 'airline'
 *   plan: one of pricing.PLANS
 *   multiYearCount?: number          (multi-year terms)
 *   count?: number                   (airline holders being bought)
 *   registrationId?: string          (airline: stack on existing live coverage)
 *   registrationModel?: 'Airlines'
 *   excludeBase?: boolean            (renewing the base plan)
 *   excludeGroupId?: string          (renewing one add-on group)
 *
 * Returns { pricePerCert, holders, years, total, tier, anchor }.
 */
router.post('/quote', optionalAuth, async (req, res) => {
  try {
    const {
      kind,
      plan,
      multiYearCount = null,
      count = null,
      registrationId = null,
      registrationModel = 'Airlines',
      excludeBase = false,
      excludeGroupId = null,
    } = req.body || {};

    const VALID_PLANS = Object.values(pricing.PLANS);
    if (!VALID_PLANS.includes(plan)) {
      return res.status(400).json({ success: false, message: 'Unknown subscription plan.' });
    }

    // ── Individual ───────────────────────────────────────────────────────────
    if (kind === 'individual') {
      const years = pricing.billedYears(plan, multiYearCount);
      const total = pricing.individualPrice(plan, multiYearCount);
      return res.json({
        success: true,
        data: { holders: 1, years, pricePerCert: total, total, tier: null, anchor: 0 },
      });
    }

    if (kind !== 'airline') {
      return res.status(400).json({ success: false, message: 'kind must be "individual" or "airline".' });
    }

    // ── Airline ──────────────────────────────────────────────────────────────
    const holders = Math.max(1, Number(count) || 0);

    // Stacked pricing: when the quote is bound to a real airline, the tier is
    // read at (holders already covered by other live plans + holders being
    // bought) — identical to what paymentController does at charge time.
    let anchor = 0;
    if (registrationId && registrationModel === 'Airlines') {
      // A registration-bound quote leaks holder counts, so it needs a token.
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required for a registration-bound quote.' });
      }
      const doc = await Airlines.findById(registrationId)
        .select('committedCount holderCountValue certificateHolders holderGroups status isPaid subscriptionPlan expirationDate')
        .lean();
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Registration not found.' });
      }
      if (req.user.role !== 'admin') {
        const owned = [
          ...(req.user.subscriptionIds || []).map(String),
          req.user.registrationId ? String(req.user.registrationId) : null,
        ].filter(Boolean);
        if (!owned.includes(String(registrationId))) {
          return res.status(403).json({ success: false, message: 'Access denied.' });
        }
      }
      anchor = activeCoverageAnchor(doc, { excludeBase: !!excludeBase, excludeGroupId });
    }

    // The airline floor applies only when nothing else is already covered.
    const tierPosition = anchor > 0
      ? anchor + holders
      : Math.max(pricing.AIRLINE_MIN_HOLDERS, holders);

    const pricePerCert = pricing.airlinePricePerCert(plan, tierPosition);
    const years = plan === pricing.PLANS.MULTI_YEAR ? pricing.billedYears(plan, multiYearCount) : 1;
    const total = pricing.airlineTotal({ plan, count: holders, multiYearCount, pricePerCert });

    return res.json({
      success: true,
      data: {
        holders,
        years,
        pricePerCert,
        total,
        tier: pricing.airlineTierForCount(tierPosition).key,
        anchor,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
