/**
 * pricing.js, the browser's ONLY source of prices.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  There are no price constants in this file, and there must be none anywhere
 *  else in the frontend. Every number is fetched from `GET /api/pricing/config`,
 *  which serves backend/shared/pricing.js, the same module that prices the
 *  Stripe PaymentIntent.
 *
 *  This is the fix for the drift that made this refactor necessary: the tier
 *  tables used to be copy-pasted into five components, so an edit to the server
 *  tables left the UI quoting $60 while the customer was charged $55.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two levels of guarantee:
 *
 *   getPricing() , the shared tables, for instant UI feedback while the user
 *                   moves a holder-count slider. Same numbers as the server.
 *
 *   quote()      , asks the server to price a scenario outright. Use this for
 *                   any amount the customer is about to be charged: it is
 *                   computed by the server, so it cannot disagree with the
 *                   charge. Airline renewals and add-ons in particular depend on
 *                   stacked coverage the browser cannot see.
 */
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
const CACHE_KEY = 'ifoa_pricing_config'

let config = null
let inflight = null

/**
 * Last-known-good tables, persisted in localStorage (not sessionStorage) so they
 * survive a tab close and a browser restart.
 *
 * This is the resilience that stops one endpoint from taking the app down: after
 * a single successful load, a backend blip, or a frontend deployed slightly
 * ahead of its backend, falls back to the last tables the server served instead
 * of blocking every page. Prices change rarely; a few-minutes-stale table is far
 * better than an unusable app, and the next successful fetch replaces it.
 */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && parsed.airline?.tiers?.length ? parsed : null
  } catch {
    return null
  }
}

function writeCache(cfg) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cfg))
  } catch { /* private mode / quota, not critical */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetch the price tables once. Concurrent callers share one request.
 *
 * Retries a few times with backoff, because the usual cause of failure is a
 * transient one (cold-start on the host, a redeploy in flight) rather than a
 * permanent one. Falls back to the cached tables if every attempt fails, and
 * only rejects when there is nothing cached at all, i.e. a first-ever visit
 * while the backend is unreachable, at which point nothing else in the app
 * would work either.
 */
export function loadPricing({ attempts = 3 } = {}) {
  if (config) return Promise.resolve(config)
  if (inflight) return inflight

  inflight = (async () => {
    let lastErr = null
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await axios.get(`${BASE_URL}/pricing/config`, { timeout: 10000 })
        const data = res.data?.data || res.data
        if (!data?.airline?.tiers?.length) throw new Error('Malformed pricing config')
        config = data
        writeCache(config)
        return config
      } catch (err) {
        lastErr = err
        if (i < attempts - 1) await sleep(400 * 2 ** i)   // 400ms, 800ms
      }
    }

    const cached = readCache()
    if (cached) {
      config = cached
      // Visible on purpose: the app is running on last-known-good prices.
      console.warn('[pricing] server unreachable, using last known tables', lastErr?.message)
      return config
    }
    throw lastErr
  })().finally(() => { inflight = null })

  return inflight
}

/** Discard the cached tables and refetch. */
export function reloadPricing() {
  config = null
  inflight = null
  try { localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
  return loadPricing()
}

/** The loaded config. Throws if called before loadPricing() resolved. */
export function getPricing() {
  if (!config) {
    throw new Error('Pricing config not loaded, render inside <PricingProvider>.')
  }
  return config
}

export function isPricingLoaded() {
  return !!config
}

// ── Mirrors of shared/pricing.js, driven entirely by the fetched tables ───────
// These functions hold no numbers of their own; they only walk the server's data.

/** The tier object covering `count` holders. */
export function airlineTierForCount(count) {
  const { tiers } = getPricing().airline
  const n = Number(count) || 0
  return tiers.find(t => t.maxCount === null || n <= t.maxCount) || tiers[tiers.length - 1]
}

/** Tier key: "3 to 5" | "5 to 10" | "More than 10". */
export function holderRangeFromCount(count) {
  return airlineTierForCount(count).key
}

/** Price per certificate for an airline plan at a cumulative holder count. */
export function airlinePricePerCert(plan, count) {
  const cfg = getPricing()
  const tier = airlineTierForCount(count)
  if (plan === cfg.plans.UNLIMITED) return tier.unlimited
  if (plan === cfg.plans.MULTI_YEAR) return cfg.airline.multiYearPerCert
  return tier.oneYear
}

/** Price per certificate keyed by an explicit tier key (form selects). */
export function airlinePricePerCertByRange(plan, rangeKey) {
  const cfg = getPricing()
  const tier = cfg.airline.tiers.find(t => t.key === rangeKey) || cfg.airline.tiers[0]
  if (plan === cfg.plans.UNLIMITED) return tier.unlimited
  if (plan === cfg.plans.MULTI_YEAR) return cfg.airline.multiYearPerCert
  return tier.oneYear
}

/** Years billed for a plan. Unlimited → null (perpetual). */
export function billedYears(plan, multiYearCount) {
  const cfg = getPricing()
  if (plan === cfg.plans.UNLIMITED) return null
  if (plan === cfg.plans.MULTI_YEAR) {
    const y = Number(multiYearCount)
    return Number.isFinite(y) && y > 1 ? y : cfg.individual.multiYearMinYears
  }
  return 1
}

/** Individual subscription price for a whole term. */
export function individualPrice(plan, multiYearCount) {
  const cfg = getPricing()
  if (plan === cfg.plans.UNLIMITED) return cfg.individual.unlimited
  if (plan === cfg.plans.MULTI_YEAR) {
    return cfg.individual.multiYearPerYear * billedYears(plan, multiYearCount)
  }
  return cfg.individual.oneYear
}

/** Airline total for a whole term: perCert × holders × years. */
export function airlineTotal({ plan, count, multiYearCount, pricePerCert }) {
  const cfg = getPricing()
  const holders = Math.max(1, Number(count) || 0)
  const ppc = pricePerCert != null && pricePerCert !== ''
    ? Number(pricePerCert)
    : airlinePricePerCert(plan, holders)
  const years = plan === cfg.plans.MULTI_YEAR ? billedYears(plan, multiYearCount) : 1
  return ppc * holders * years
}

/** Recover the year count of a multi-year individual plan from its price. */
export function effectiveMultiYears(plan, price) {
  const cfg = getPricing()
  if (plan !== cfg.plans.MULTI_YEAR) return null
  const dollars = Number(price)
  const floor = cfg.individual.multiYearPerYear * cfg.individual.multiYearMinYears
  return dollars >= floor ? Math.round(dollars / cfg.individual.multiYearPerYear) : null
}

/** Minimum holders on an airline account. */
export function airlineMinHolders() {
  return getPricing().airline.minHolders
}

/** Tier rows for display (FAQ table, plan pickers). */
export function airlineTiers() {
  return getPricing().airline.tiers
}

/** Plan name constants, so components never hard-code the strings either. */
export function plans() {
  return getPricing().plans
}

/**
 * Ask the server for the authoritative amount.
 *
 * Prefer this over the local helpers for anything the customer is about to pay.
 * Pass registrationId for an airline renewal or add-on so the server prices it
 * at the tier the whole account has reached.
 *
 * @returns {Promise<{holders,years,pricePerCert,total,tier,anchor}>}
 */
export async function quote({
  kind,
  plan,
  multiYearCount = null,
  count = null,
  registrationId = null,
  registrationModel = 'Airlines',
  excludeBase = false,
  excludeGroupId = null,
}) {
  const token = localStorage.getItem('ifoa_token')
  const res = await axios.post(
    `${BASE_URL}/pricing/quote`,
    { kind, plan, multiYearCount, count, registrationId, registrationModel, excludeBase, excludeGroupId },
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  )
  return res.data?.data
}
