/**
 * PricingContext
 * ──────────────
 * Loads the server's price tables once, before any pricing UI renders.
 *
 * Pricing components call the synchronous helpers in services/pricing.js, which
 * require the config to be present. Gating render here means those helpers can
 * stay simple and can never quote a stale or missing price — and, because the
 * tables come from the server, can never quote a price the server disagrees with.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { loadPricing, isPricingLoaded } from '../services/pricing'

const PricingContext = createContext({ ready: false, error: null })

export function PricingProvider({ children }) {
  const [ready, setReady] = useState(isPricingLoaded())
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadPricing()
      .then(() => { if (!cancelled) setReady(true) })
      .catch((err) => { if (!cancelled) setError(err) })
    return () => { cancelled = true }
  }, [])

  // Only reached when the server is unreachable AND no tables have ever been
  // cached — a first-ever visit against a down backend, where nothing else in the
  // app (login, dashboard, payments) would work either. Once a single successful
  // load has happened, loadPricing() falls back to the cached tables instead and
  // the app keeps running, so one endpoint can never blank the whole UI.
  if (error && !ready) {
    const offline = !navigator.onLine
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-bold text-slate-800">Can’t reach the server</p>
          <p className="mt-1 text-xs text-slate-500">
            {offline
              ? 'You appear to be offline. Reconnect and try again.'
              : 'The application server is not responding, so plan prices could not be loaded. It may be starting up — try again in a moment.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-blue-600 animate-spin" />
      </div>
    )
  }

  return (
    <PricingContext.Provider value={{ ready, error }}>
      {children}
    </PricingContext.Provider>
  )
}

export const usePricing = () => useContext(PricingContext)
