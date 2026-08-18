'use strict';

/**
 * pricing.js — THE canonical pricing engine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SINGLE SOURCE OF TRUTH.  Nothing anywhere else in this repository — backend
 *  or frontend — may hard-code a plan price, a holder tier boundary, or a
 *  proration formula.
 *
 *  Backend consumers  import this module directly.
 *  Frontend consumers read the SAME tables over `GET /api/pricing/config` and
 *  the SAME arithmetic over `POST /api/pricing/quote` (see routes/pricingRoutes.js
 *  and frontend/src/services/pricing.js). The browser never owns a price table,
 *  so the UI can no longer show $60 while the server charges $55.
 *
 *  This file is deliberately dependency-free (no mongoose, no config, no env)
 *  so it can be required from anywhere and serialised straight to the client.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Plan identifiers ─────────────────────────────────────────────────────────
const PLANS = {
  ONE_YEAR:  '1 Year Subscription Plan',
  MULTI_YEAR:'Multiple Years Subscription Plan',
  UNLIMITED: 'Unlimited Plan',
};

// ── Individual pricing ───────────────────────────────────────────────────────
// Marketing names: Turboprop (1 year), Jet (multi-year), VIP (unlimited).
const INDIVIDUAL = {
  oneYear:           69,   // $/year
  multiYearPerYear:  55,   // $/year, billed upfront for the whole term
  unlimited:        299,   // one-time, never expires
  multiYearMinYears:  2,   // a "multi-year" term is never shorter than this
  multiYearMaxYears:  5,
};

// ── Airline / operator pricing ───────────────────────────────────────────────
// Volume tiers, priced PER CERTIFICATE HOLDER. `maxCount: null` = open-ended.
// Order matters: the first tier whose maxCount covers the count wins.
const AIRLINE_TIERS = [
  { key: '3 to 5',       label: '3 – 5 holders',   minCount: 1,  maxCount: 5,    oneYear: 60, unlimited: 265 },
  { key: '5 to 10',      label: '5 – 10 holders',  minCount: 6,  maxCount: 10,   oneYear: 55, unlimited: 255 },
  { key: 'More than 10', label: 'More than 10',    minCount: 11, maxCount: null, oneYear: 49, unlimited: 245 },
];

// Per-certificate fallback for an airline multi-year term (per holder, per year).
const AIRLINE_MULTI_YEAR_PER_CERT = 55;

// Minimum holders an airline account may hold.
const AIRLINE_MIN_HOLDERS = 3;

// ── Tier helpers ─────────────────────────────────────────────────────────────

/** The tier object covering `count` holders. Never returns undefined. */
function airlineTierForCount(count) {
  const n = Number(count) || 0;
  return (
    AIRLINE_TIERS.find(t => t.maxCount === null || n <= t.maxCount) ||
    AIRLINE_TIERS[AIRLINE_TIERS.length - 1]
  );
}

/** The tier KEY ("3 to 5" | "5 to 10" | "More than 10") covering `count`. */
function holderRangeFromCount(count) {
  return airlineTierForCount(count).key;
}

/**
 * Price per certificate for an airline plan at a given total holder count.
 * `count` must be the CUMULATIVE position (see activeCoverageAnchor in
 * utils/holderGroups.js) so stacked add-ons are priced at the tier the whole
 * account has reached, not as a fresh 3-holder purchase.
 */
function airlinePricePerCert(plan, count) {
  const tier = airlineTierForCount(count);
  if (plan === PLANS.UNLIMITED)  return tier.unlimited;
  if (plan === PLANS.MULTI_YEAR) return AIRLINE_MULTI_YEAR_PER_CERT;
  return tier.oneYear;
}

/** Price per certificate keyed by an explicit tier key (form-driven selects). */
function airlinePricePerCertByRange(plan, rangeKey) {
  const tier = AIRLINE_TIERS.find(t => t.key === rangeKey) || AIRLINE_TIERS[0];
  if (plan === PLANS.UNLIMITED)  return tier.unlimited;
  if (plan === PLANS.MULTI_YEAR) return AIRLINE_MULTI_YEAR_PER_CERT;
  return tier.oneYear;
}

// ── Term helpers ─────────────────────────────────────────────────────────────

/** Years billed for a plan. Unlimited = null (perpetual); 1-Year = 1. */
function billedYears(plan, multiYearCount) {
  if (plan === PLANS.UNLIMITED) return null;
  if (plan === PLANS.MULTI_YEAR) {
    const y = Number(multiYearCount);
    return Number.isFinite(y) && y > 1 ? y : INDIVIDUAL.multiYearMinYears;
  }
  return 1;
}

/**
 * Individual subscription price for a whole term.
 * `explicitPrice` (an admin override) always wins when supplied.
 */
function individualPrice(plan, multiYearCount, explicitPrice) {
  if (explicitPrice !== undefined && explicitPrice !== null && explicitPrice !== '') {
    return Number(explicitPrice);
  }
  if (plan === PLANS.UNLIMITED)  return INDIVIDUAL.unlimited;
  if (plan === PLANS.MULTI_YEAR) return INDIVIDUAL.multiYearPerYear * billedYears(plan, multiYearCount);
  return INDIVIDUAL.oneYear;
}

/**
 * Airline subscription total for a whole term:  perCert × holders × years.
 * Unlimited is a one-time per-certificate charge, so years collapses to 1.
 */
function airlineTotal({ plan, count, multiYearCount, pricePerCert }) {
  const holders = Math.max(1, Number(count) || 0);
  const ppc = pricePerCert != null && pricePerCert !== ''
    ? Number(pricePerCert)
    : airlinePricePerCert(plan, holders);
  const years = plan === PLANS.MULTI_YEAR ? billedYears(plan, multiYearCount) : 1;
  return ppc * holders * years;
}

/**
 * Recover the year count of an Individual multi-year plan from its stored price.
 * `price` is always written correctly ($55 × years) whereas `multiYearCount`
 * schema-defaults to 3, so price is the more trustworthy signal.
 * Returns null when the price is too low to be a multi-year term.
 */
function effectiveMultiYears(plan, price) {
  if (plan !== PLANS.MULTI_YEAR) return null;
  const dollars = Number(price);
  const floor = INDIVIDUAL.multiYearPerYear * INDIVIDUAL.multiYearMinYears;
  return dollars >= floor ? Math.round(dollars / INDIVIDUAL.multiYearPerYear) : null;
}

// ── Proration / upgrade credit ───────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Unused-time credit when upgrading a live plan mid-term.
 *
 *   credit = pricePaid × (daysRemaining / totalTermDays)
 *
 * A perpetual plan has no unused time to credit (it never lapses), and an
 * expired plan credits nothing — it must be renewed before it can be upgraded.
 * The result is clamped to [0, pricePaid] and rounded to whole cents.
 */
function proratedCredit({ pricePaid, subscriptionDate, expirationDate, asOf = new Date() }) {
  const paid = Number(pricePaid) || 0;
  if (paid <= 0 || !expirationDate || !subscriptionDate) return 0;

  const start = new Date(subscriptionDate).getTime();
  const end   = new Date(expirationDate).getTime();
  const now   = new Date(asOf).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  const totalDays = (end - start) / MS_PER_DAY;
  const daysLeft  = (end - now) / MS_PER_DAY;
  if (daysLeft <= 0) return 0;

  const credit = paid * (Math.min(daysLeft, totalDays) / totalDays);
  return Math.round(Math.max(0, Math.min(credit, paid)) * 100) / 100;
}

/**
 * Net charge for upgrading an in-force plan to a richer one.
 * Never negative — an over-credit becomes $0, not a refund.
 */
function upgradeCharge({ targetTotal, credit }) {
  const net = (Number(targetTotal) || 0) - (Number(credit) || 0);
  return Math.round(Math.max(0, net) * 100) / 100;
}

// ── Client-facing config ─────────────────────────────────────────────────────

/**
 * The exact payload served at `GET /api/pricing/config`.
 *
 * `version` changes whenever a price changes; the client caches on it, so a
 * price edit here propagates to every browser without a frontend deploy.
 * Bump it by hand when you edit any number above.
 */
const PRICING_VERSION = '2026-08-18.1';

function getPricingConfig() {
  return {
    version: PRICING_VERSION,
    plans: PLANS,
    individual: { ...INDIVIDUAL },
    airline: {
      tiers: AIRLINE_TIERS.map(t => ({ ...t })),
      multiYearPerCert: AIRLINE_MULTI_YEAR_PER_CERT,
      minHolders: AIRLINE_MIN_HOLDERS,
    },
  };
}

module.exports = {
  PLANS,
  INDIVIDUAL,
  AIRLINE_TIERS,
  AIRLINE_MULTI_YEAR_PER_CERT,
  AIRLINE_MIN_HOLDERS,
  PRICING_VERSION,

  airlineTierForCount,
  holderRangeFromCount,
  airlinePricePerCert,
  airlinePricePerCertByRange,
  billedYears,
  individualPrice,
  airlineTotal,
  effectiveMultiYears,
  proratedCredit,
  upgradeCharge,
  getPricingConfig,
};
