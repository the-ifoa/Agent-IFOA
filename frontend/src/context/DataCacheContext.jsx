/**
 * DataCacheContext
 * ─────────────────
 * A lightweight in-memory cache shared across all dashboard pages.
 * Pages call `getOrFetch(key, fetchFn)` instead of raw API calls.
 * The result is stored for the session, navigating back to a page
 * shows the cached data instantly (no spinner, no flicker).
 *
 * Cache is invalidated by calling `invalidate(key)` or `invalidateAll()`.
 * Auth changes (logout / user switch) wipe the whole cache automatically.
 */
import { createContext, useContext, useRef, useCallback, useEffect } from 'react'
import { useAuth } from './AuthContext'

const DataCacheContext = createContext(null)

export function DataCacheProvider({ children }) {
  // cache: Map<key, { data, ts }>
  const cache = useRef(new Map())
  const { user } = useAuth()
  const prevUserId = useRef(user?.id)

  // Wipe cache whenever the logged-in user changes (logout / switch account)
  useEffect(() => {
    if (prevUserId.current !== user?.id) {
      cache.current.clear()
      prevUserId.current = user?.id
    }
  }, [user?.id])

  /**
   * Return cached data for `key` if it exists and is younger than `maxAgeMs`.
   * Otherwise call `fetchFn()`, cache the result, and return it.
   */
  const getOrFetch = useCallback(async (key, fetchFn, maxAgeMs = 60 * 1000) => {
    const entry = cache.current.get(key)
    if (entry && Date.now() - entry.ts < maxAgeMs) {
      return entry.data
    }
    const data = await fetchFn()
    cache.current.set(key, { data, ts: Date.now() })
    return data
  }, [])

  /** Get cached data immediately (synchronously) without fetching. */
  const get = useCallback((key) => {
    return cache.current.get(key)?.data
  }, [])

  /** Write a value into the cache directly (e.g. after a mutation). */
  const set = useCallback((key, data) => {
    cache.current.set(key, { data, ts: Date.now() })
  }, [])

  /** Remove a single cache entry (force next read to re-fetch). */
  const invalidate = useCallback((key) => {
    cache.current.delete(key)
  }, [])

  /** Remove all cache entries. */
  const invalidateAll = useCallback(() => {
    cache.current.clear()
  }, [])

  return (
    <DataCacheContext.Provider value={{ getOrFetch, get, set, invalidate, invalidateAll }}>
      {children}
    </DataCacheContext.Provider>
  )
}

export const useDataCache = () => useContext(DataCacheContext)

