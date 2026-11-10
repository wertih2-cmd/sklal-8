import { useCallback, useEffect, useState } from 'react'
import { fetchPendingCounts } from './api'
import { useLiveRefresh } from '@/lib/realtime'
import type { NavCounts } from './adminNavModel'

const UNKNOWN: NavCounts = { incidents: null, cleanings: null }

/**
 * Counters for the navigation. null means "not known" (still loading, or the last request failed):
 * the badge is then simply not drawn, instead of showing a false zero.
 */
export function useAdminBadges(): NavCounts {
  const [counts, setCounts] = useState<NavCounts>(UNKNOWN)

  const load = useCallback(() => {
    fetchPendingCounts()
      .then((c) => setCounts(c))
      .catch(() => setCounts(UNKNOWN))
  }, [])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['incidents', 'cleaning_events'], load)

  return counts
}
