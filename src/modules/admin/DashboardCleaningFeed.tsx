import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, Search, Sparkles } from 'lucide-react'
import { useI18n } from '@/i18n'
import { CLEANING_FEED_LIMIT, fetchCleaningFeed } from '@/modules/admin/api'
import type { Apartment } from '@/lib/database.types'
import { relativeTime } from '@/lib/format'
import { errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { ErrorState } from '@/components/ErrorState'
import {
  CLEANING_FILTERS, cleaningState, countByState, filterCleanings,
  type CleaningFeedRow, type CleaningFilter, type CleaningState,
} from '@/modules/admin/cleaningFeed'

const PAGE_SIZE = 8
const FEED_DAYS = 30

const STATE_CLASS: Record<CleaningState, string> = {
  pending: 'bg-warn-soft text-warn',
  posted: 'bg-ok-soft text-ok',
  rejected: 'bg-bad-soft text-bad',
  reversed: 'bg-app text-muted',
}

export function DashboardCleaningFeed({
  apartments,
  approvalsPath = '/admin/more/cleaning-approvals',
  apartmentPath = (id: number) => `/admin/apartments/${id}`,
}: {
  apartments: Apartment[]
  /** Where the list of cleanings waiting for a decision lives. */
  approvalsPath?: string
  apartmentPath?: (apartmentId: number) => string
}) {
  const { t, n } = useI18n()
  const f = t.admin.dashboard.cleaningFeed
  const navigate = useNavigate()
  const [rows, setRows] = useState<CleaningFeedRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<CleaningFilter>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = useCallback(() => {
    const since = new Date(Date.now() - FEED_DAYS * 24 * 60 * 60 * 1000).toISOString()
    return fetchCleaningFeed(since)
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    load()
      .then((next) => { if (!cancelled) setRows(next) })
      .catch((e: unknown) => { if (!cancelled) setError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [load, reloadToken])

  // quiet refresh: keep showing the current list until the new one arrives
  useLiveRefresh(['cleaning_events'], () => {
    load().then(setRows).catch(() => { /* the next manual reload reports the error */ })
  })

  const aptCodes = useMemo(() => new Map(apartments.map((a) => [a.id, a.code])), [apartments])
  const counts = useMemo(() => countByState(rows ?? []), [rows])
  const filtered = useMemo(
    () => filterCleanings(rows ?? [], { state, query }, (id) => aptCodes.get(id)),
    [rows, state, query, aptCodes],
  )
  const shown = filtered.slice(0, visible)

  const stateLabel: Record<CleaningState, string> = {
    pending: f.statePending,
    posted: f.statePosted,
    rejected: f.stateRejected,
    reversed: f.stateReversed,
  }
  const filterLabel = (value: CleaningFilter) =>
    value === 'all' ? f.stateAll : `${stateLabel[value]} (${n(String(counts[value]))})`

  const open = (row: CleaningFeedRow) =>
    navigate(cleaningState(row) === 'pending' ? approvalsPath : apartmentPath(row.apartment_id))

  return (
    <section className="panel rounded-[20px] p-4 mb-5" data-testid="dash-cleaning-feed">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-ink">{f.title}</h2>
        <span className="text-xs text-muted">{f.period}</span>
        <button
          type="button"
          onClick={() => navigate(approvalsPath)}
          className="ms-auto text-xs text-accent hover:underline"
        >
          {f.openApprovals}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE) }}
            placeholder={f.searchPlaceholder}
            aria-label={f.searchPlaceholder}
            data-testid="dash-cleaning-search"
            className="w-full bg-app rounded-lg ps-9 pe-3 py-2 text-sm text-ink border border-line focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={state}
          onChange={(e) => { setState(e.target.value as CleaningFilter); setVisible(PAGE_SIZE) }}
          aria-label={f.stateLabel}
          data-testid="dash-cleaning-state"
          className="bg-app rounded-lg px-2.5 py-2 text-sm text-ink border border-line focus:outline-none focus:border-accent"
        >
          {CLEANING_FILTERS.map((value) => <option key={value} value={value}>{filterLabel(value)}</option>)}
        </select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => setReloadToken((k) => k + 1)} />
      ) : rows == null ? (
        <p className="text-sm text-muted">{t.app.loading}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{f.none}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">{f.empty}</p>
      ) : (
        <>
          <p className="text-xs text-muted mb-1">{f.found}: {n(String(filtered.length))}</p>
          <ul>
            {shown.map((row) => {
              const current = cleaningState(row)
              return (
                <li key={row.id} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    onClick={() => open(row)}
                    className="w-full flex items-start gap-3 py-2.5 text-start hover:bg-app rounded-lg px-1"
                  >
                    <span className="w-8 h-8 bg-app rounded-lg flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-muted" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">{aptCodes.get(row.apartment_id) ?? `#${n(String(row.apartment_id))}`}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATE_CLASS[current]}`}>{stateLabel[current]}</span>
                        {row.media_count > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-muted"><Camera className="w-3 h-3" />{n(String(row.media_count))}</span>
                        )}
                      </span>
                      <span className="block text-sm text-ink truncate">{row.staff_names.length > 0 ? row.staff_names.join(', ') : '—'}</span>
                      <span className="block text-xs text-muted truncate">
                        {n(relativeTime(row.cleaned_at))}{row.note ? ` · ${row.note}` : ''}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted shrink-0 mt-1 rtl:rotate-180" />
                  </button>
                </li>
              )
            })}
          </ul>
          {filtered.length > shown.length && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="mt-2 w-full bg-app rounded-lg py-2 text-sm text-ink hover:bg-accent-soft"
            >
              {f.showMore} ({n(String(filtered.length - shown.length))})
            </button>
          )}
          {rows.length >= CLEANING_FEED_LIMIT && <p className="text-[11px] text-muted mt-2">{f.limitNote}</p>}
        </>
      )}
    </section>
  )
}
