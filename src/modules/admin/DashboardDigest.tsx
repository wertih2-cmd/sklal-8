import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchCleaningFeed, fetchPendingCleanings, fetchShortageEvents, fetchWarehouseStock } from '@/modules/admin/api'
import type { Apartment, Incident, WarehouseStockRow } from '@/lib/database.types'
import { useLiveRefresh } from '@/lib/realtime'
import { fetchAiDigest, type AiDigestResult } from '@/modules/admin/aiDigestClient'
import { AiDigestError } from '@/modules/admin/aiDigestErrors'
import {
  buildDigest, mergeCleanings, toAiPayload,
  type AlertCode, type ApartmentLabel, type DigestAlert, type DigestCleaning, type DigestPeriod, type DigestShortage, type Severity,
} from '@/modules/admin/digest'

const CACHE_MS = 3 * 60 * 1000
const SHORTAGE_LIMIT = 200
const FEED_DAYS = 7
const PAGE_SIZE = 6
// The AI text stays on screen this long; it is dropped earlier when the period or the language changes.
const AI_KEEP_MS = 15 * 60 * 1000

interface Loaded {
  shortages: DigestShortage[]
  cleanings: DigestCleaning[]
  stock: WarehouseStockRow[]
  at: number
}

// Kept outside the component so that coming back to the home screen within a few minutes does not refetch.
let cache: Loaded | null = null
let aiCache: { scope: string; key: string; result: AiDigestResult; at: number } | null = null

function restoreAi(scope: string): { result: AiDigestResult; key: string } | null {
  return aiCache && aiCache.scope === scope && Date.now() - aiCache.at < AI_KEEP_MS ? { result: aiCache.result, key: aiCache.key } : null
}

async function loadAll(): Promise<Loaded> {
  const since = new Date(Date.now() - FEED_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const [shortages, feed, pending, stock] = await Promise.all([
    fetchShortageEvents(SHORTAGE_LIMIT),
    fetchCleaningFeed(since),
    fetchPendingCleanings(),
    fetchWarehouseStock(),
  ])
  return {
    shortages: shortages.map((s) => ({ apartment_id: s.apartment_id, created_at: s.created_at })),
    cleanings: mergeCleanings(feed, pending),
    stock,
    at: Date.now(),
  }
}

const SEVERITY_CLASS: Record<Severity, string> = {
  red: 'bg-bad-soft text-bad',
  amber: 'bg-warn-soft text-warn',
}

const LABEL_CLASS: Record<ApartmentLabel, string> = {
  urgent: 'bg-bad-soft text-bad',
  attention: 'bg-warn-soft text-warn',
  normal: 'bg-ok-soft text-ok',
}

export function DashboardDigest({ incidents, apartments }: { incidents: Incident[]; apartments: Apartment[] }) {
  const { t, n, lang } = useI18n()
  const d = t.admin.dashboard.digest
  const navigate = useNavigate()
  const [period, setPeriod] = useState<DigestPeriod>('24h')
  const [data, setData] = useState<Loaded | null>(cache && Date.now() - cache.at < CACHE_MS ? cache : null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [ai, setAi] = useState<{ result: AiDigestResult; key: string } | null>(() => restoreAi(`${lang}|24h`))
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiDetail, setAiDetail] = useState('')
  const alive = useRef(true)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const next = await loadAll()
      cache = next
      if (alive.current) { setData(next); setFailed(false) }
    } catch {
      if (alive.current) setFailed(true)
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    if (!data) void load()
    return () => { alive.current = false }
    // first load only: later reloads come from the button and from live updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLiveRefresh(['events', 'cleaning_events', 'stock_moves', 'items'], () => { void load() })

  const codes = useMemo(() => new Map(apartments.map((a) => [a.id, a.code])), [apartments])

  const digest = useMemo(() => {
    if (!data) return null
    return buildDigest({
      now: Date.now(),
      period,
      incidents,
      cleanings: data.cleanings,
      shortages: data.shortages,
      stock: data.stock,
      // spend is not part of this card yet
      spend: { current: 0, previous: null },
      apartmentCode: (id) => codes.get(id),
    })
  }, [data, incidents, period, codes])

  // Facts the text was written from. Ages in hours drift every few minutes, so they are left out:
  // only a change in counts or in who is affected marks the text as out of date.
  const aiKey = useMemo(
    () => (digest ? JSON.stringify(toAiPayload(digest), (k, v) => (k === 'oldest_hours' || k === 'oldest_waiting_hours' ? undefined : v)) : ''),
    [digest],
  )
  const aiScope = `${lang}|${period}`
  // The text belongs to one period and one language: another period or language drops it.
  useEffect(() => {
    setAi(restoreAi(aiScope))
    setAiError(null)
    setAiDetail('')
  }, [aiScope])
  const aiStale = ai != null && aiKey !== '' && ai.key !== aiKey

  const askAi = async () => {
    if (!digest || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    setAiDetail('')
    try {
      const result = await fetchAiDigest(toAiPayload(digest), lang)
      aiCache = { scope: aiScope, key: aiKey, result, at: Date.now() }
      if (alive.current) setAi({ result, key: aiKey })
    } catch (e) {
      const code = e instanceof AiDigestError ? e.code : 'unavailable'
      if (alive.current) {
        setAiError(code === 'not_configured' ? d.aiErrNotConfigured : code === 'rate_limited' ? d.aiErrRateLimited : d.aiErrFailed)
        setAiDetail(e instanceof AiDigestError ? e.detail : '')
      }
    } finally {
      if (alive.current) setAiBusy(false)
    }
  }

  const alertText: Record<AlertCode, string> = {
    incident_overdue: d.alertIncidentOverdue,
    shortage_unprocessed: d.alertShortageUnprocessed,
    cleaning_waiting: d.alertCleaningWaiting,
    incident_repeat: d.alertIncidentRepeat,
    below_min: d.alertBelowMin,
  }
  const labelText: Record<ApartmentLabel, string> = { urgent: d.labelUrgent, attention: d.labelAttention, normal: d.labelNormal }
  const hours = (h: number) => `${n(String(Math.round(h)))} ${d.hoursShort}`

  const renderAlert = (a: DigestAlert) => (
    <li key={`${a.code}-${a.apartmentId ?? 'w'}`} className="flex items-start gap-2 text-xs">
      <span className={`mt-1 inline-block w-2 h-2 rounded-full shrink-0 ${a.severity === 'red' ? 'bg-bad' : 'bg-warn'}`} aria-hidden="true" />
      <span className="text-ink">
        {alertText[a.code]}: {n(String(a.count))}
        {a.oldestHours != null && <span className="text-muted"> · {hours(a.oldestHours)}</span>}
      </span>
    </li>
  )

  const rows = digest?.apartments.filter((a) => a.label !== 'normal' || a.newIncidents > 0 || a.newCleanings > 0) ?? []
  const shown = rows.slice(0, visible)
  const nothing = digest != null && rows.length === 0 && digest.warehouse.alerts.length === 0

  return (
    <section className="panel rounded-[20px] p-4 mb-5" data-testid="dash-digest">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-accent shrink-0" />
            {d.title}
          </h2>
          <p className="text-muted text-[11px] mt-0.5">{d.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="well rounded-xl p-0.5 flex" role="group" aria-label={d.title}>
            {(['24h', '7d'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => { setPeriod(p); setVisible(PAGE_SIZE) }}
                aria-pressed={period === p}
                className={`px-2.5 py-1 rounded-[10px] text-xs font-medium ${period === p ? 'bg-accent text-on-accent' : 'text-muted'}`}
              >
                {p === '24h' ? d.period24h : d.period7d}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            aria-label={d.refresh}
            title={d.refresh}
            className="well rounded-xl p-2 text-muted hover:text-accent disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {failed && <p className="text-bad text-xs mb-2">{d.loadFailed}</p>}

      {digest && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SEVERITY_CLASS.red}`}>{d.red}: {n(String(digest.redCount))}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${SEVERITY_CLASS.amber}`}>{d.amber}: {n(String(digest.amberCount))}</span>
          </div>

          {nothing && <p className="text-muted text-sm">{d.allClear}</p>}

          {!nothing && (
            <div className="mb-3">
              <button
                type="button"
                onClick={() => void askAi()}
                disabled={aiBusy}
                className="well rounded-xl px-3 py-2 text-xs font-medium text-accent flex items-center gap-1.5 min-h-[44px] disabled:opacity-60"
              >
                <Sparkles className={`w-4 h-4 ${aiBusy ? 'animate-pulse' : ''}`} />
                {aiBusy ? d.aiGenerating : d.aiButton}
              </button>
              {aiError && <p className="text-bad text-xs mt-2">{aiError}</p>}
              {aiError && aiDetail && <p className="text-muted text-[11px] mt-1 break-all" dir="ltr">{d.aiErrDetail}: {aiDetail}</p>}
              {ai && (
                <div className="well rounded-xl px-3 py-2.5 mt-2" data-testid="dash-digest-ai">
                  <b className="text-sm text-ink flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-accent shrink-0" />{d.aiTitle}</b>
                  <p className="text-ink text-sm mt-1">{ai.result.headline}</p>
                  <ul className="mt-1.5 space-y-1 list-disc ps-4">
                    {ai.result.bullets.map((b, i) => <li key={i} className="text-xs text-ink">{b}</li>)}
                  </ul>
                  {aiStale && <p className="text-warn text-[11px] mt-2">{d.aiStale}</p>}
                  <p className="text-muted text-[11px] mt-2">{d.aiNote}</p>
                </div>
              )}
            </div>
          )}

          {shown.length > 0 && (
            <ul className="space-y-2">
              {shown.map((a) => (
                <li key={a.apartmentId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/apartments/${a.apartmentId}`)}
                    className="well rounded-xl w-full px-3 py-2.5 text-start hover:border-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-sm text-ink">{a.code}</b>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${LABEL_CLASS[a.label]}`}>{labelText[a.label]}</span>
                    </div>
                    <div className="text-muted text-[11px] mt-0.5">
                      {d.newIncidents}: {n(String(a.newIncidents))} · {d.newCleanings}: {n(String(a.newCleanings))}
                      {a.oldestWaitingHours != null && <> · {d.oldestWaiting}: {hours(a.oldestWaitingHours)}</>}
                    </div>
                    {a.alerts.length > 0 && <ul className="mt-1.5 space-y-1">{a.alerts.map(renderAlert)}</ul>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {rows.length > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setVisible(visible >= rows.length ? PAGE_SIZE : rows.length)}
              className="mt-2 text-xs text-accent font-medium"
            >
              {visible >= rows.length ? d.showLess : `${d.showMore} (${n(String(rows.length - visible))})`}
            </button>
          )}

          {(digest.warehouse.alerts.length > 0 || digest.warehouse.belowMinAssets + digest.warehouse.belowMinConsumables > 0) && (
            <div className="well rounded-xl px-3 py-2.5 mt-3">
              <b className="text-sm text-ink">{d.warehouse}</b>
              <div className="text-muted text-[11px] mt-0.5">
                {d.belowMinAssets}: {n(String(digest.warehouse.belowMinAssets))} · {d.belowMinConsumables}: {n(String(digest.warehouse.belowMinConsumables))}
                {digest.warehouse.unassignedShortages > 0 && <> · {d.unassignedShortages}: {n(String(digest.warehouse.unassignedShortages))}</>}
              </div>
              {digest.warehouse.alerts.length > 0 && <ul className="mt-1.5 space-y-1">{digest.warehouse.alerts.map(renderAlert)}</ul>}
            </div>
          )}
        </>
      )}

      {!digest && !failed && <p className="text-muted text-sm">{t.app.loading}</p>}
    </section>
  )
}
