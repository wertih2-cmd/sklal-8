import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BadgeCheck, Wrench, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useLiveRefresh } from '@/lib/realtime'
import { ErrorState } from '@/components/ErrorState'
import { useAdminBadges } from '@/modules/admin/useAdminBadges'
import {
  fetchApartmentsAdmin, fetchAllIncidents, fetchCleaningFeed, fetchApartmentCompleteness, fetchItemNames,
} from '@/modules/admin/api'
import type { Apartment, Incident } from '@/lib/database.types'
import type { CleaningFeedRow } from '@/modules/admin/cleaningFeed'
import type { ApartmentNorms } from '@/modules/admin/completeness'
import { summarizeCompleteness } from '@/modules/admin/completeness'
import { CompletenessRing } from '@/modules/admin/CompletenessRing'
import { DashboardIncidentFeed } from '@/modules/admin/DashboardIncidentFeed'
import { DashboardCleaningFeed } from '@/modules/admin/DashboardCleaningFeed'
import { ManagerApartmentTable } from './ManagerApartmentTable'
import { buildApartmentStats, type ManagerPeriod } from './managerStats'

const DAY_MS = 24 * 60 * 60 * 1000
// The cleanings are loaded once for the longest period of the table.
const CLEANINGS_DAYS = 30

const APPROVALS_PATH = '/manager/cleaning-approvals'
const INCIDENTS_PATH = '/manager/incidents'
const apartmentPath = (id: number) => `/sv/apartments/${id}`

/**
 * Start page of the manager: what waits for a decision, how complete the apartments are, which apartments need a look,
 * and the feeds. No warehouse data: the manager has no access to it (completeness comes without quantities).
 */
export function ManagerHome() {
  const { t, n } = useI18n()
  const m = t.admin.manager
  const counts = useAdminBadges()
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  // null = that request failed: the table and the ring say so instead of showing false zeros
  const [cleanings, setCleanings] = useState<CleaningFeedRow[] | null>(null)
  const [completeness, setCompleteness] = useState<Map<number, ApartmentNorms> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [period, setPeriod] = useState<ManagerPeriod>(7)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) { setLoading(true); setLoadError(false) }
    try {
      const since = new Date(Date.now() - CLEANINGS_DAYS * DAY_MS).toISOString()
      const [apts, incs, cl, comp] = await Promise.all([
        fetchApartmentsAdmin(),
        fetchAllIncidents(),
        fetchCleaningFeed(since).catch(() => null),
        fetchApartmentCompleteness().catch(() => null),
      ])
      setApartments(apts)
      setIncidents(incs)
      setCleanings(cl)
      setCompleteness(comp)
      setNow(Date.now())
    } catch {
      if (!silent) setLoadError(true)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['incidents', 'apartments', 'cleaning_events', 'norm_rules'], () => { load(true) })

  const stats = useMemo(
    () => buildApartmentStats({
      apartments, cleanings: cleanings ?? [], incidents, completeness, sinceMs: now - period * DAY_MS,
    }),
    [apartments, cleanings, incidents, completeness, now, period],
  )

  const ring = useMemo(
    () => (completeness ? summarizeCompleteness(apartments.map((a) => a.id), completeness) : null),
    [apartments, completeness],
  )

  const tiles = [
    { to: APPROVALS_PATH, icon: BadgeCheck, label: m.pendingCleanings, count: counts.cleanings },
    { to: INCIDENTS_PATH, icon: Wrench, label: m.newIncidents, count: counts.incidents },
  ]

  return (
    <div className="px-4 pt-6 pb-28 lg:px-0 lg:pt-0">
      <h1 className="text-xl font-semibold text-ink mb-4">{m.title}</h1>

      <div className="grid gap-3 sm:grid-cols-2 mb-5">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <NavLink key={tile.to} to={tile.to} className="tile rounded-[20px] p-4 flex items-center gap-3 min-h-[72px]">
              <div className="w-10 h-10 well rounded-xl flex items-center justify-center flex-none">
                <Icon className="w-5 h-5 text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-semibold text-ink leading-none">{tile.count == null ? '—' : n(String(tile.count))}</p>
                <p className="text-sm text-muted mt-1 truncate">{tile.label}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted flex-none rtl:rotate-180" />
            </NavLink>
          )
        })}
      </div>

      {loading ? (
        <p className="text-sm text-muted text-center py-8">{t.app.loading}</p>
      ) : loadError ? (
        <ErrorState onRetry={() => load()} />
      ) : (
        <>
          <section className="panel rounded-[20px] p-4 mb-5">
            <h2 className="text-base font-semibold text-ink mb-3">{t.admin.dashboard.ringTitle}</h2>
            {ring ? (
              <CompletenessRing
                summary={ring}
                fmt={n}
                labels={{
                  complete: t.admin.dashboard.ringComplete,
                  almost: t.admin.dashboard.ringAlmost,
                  low: t.admin.dashboard.ringLow,
                  noNorms: t.admin.dashboard.ringNoNorms,
                  empty: t.admin.dashboard.ringEmpty,
                }}
              />
            ) : (
              <p className="text-sm text-muted">{m.completenessFailed}</p>
            )}
          </section>

          <ManagerApartmentTable
            stats={stats}
            period={period}
            onPeriod={setPeriod}
            cleaningsKnown={cleanings != null}
            apartmentPath={apartmentPath}
          />

          <DashboardIncidentFeed
            incidents={incidents}
            apartments={apartments}
            incidentsPath={INCIDENTS_PATH}
            loadItemNames={fetchItemNames}
          />
          <DashboardCleaningFeed apartments={apartments} approvalsPath={APPROVALS_PATH} apartmentPath={apartmentPath} />
        </>
      )}
    </div>
  )
}
