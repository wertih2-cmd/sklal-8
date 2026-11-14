import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader as Loader2, Search } from 'lucide-react'
import { useI18n } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useLiveRefresh } from '@/lib/realtime'
import { ErrorState } from '@/components/ErrorState'
import { Modal } from '@/components/Modal'
import type { Apartment } from '@/lib/database.types'
import { fetchApartmentsAdmin } from './api'
import { filterApartments } from './apartmentSearch'
import { fetchBoardCleanings, fetchBoardIncidents } from './chessboardApi'
import {
  BOARD_LAYERS, PERIODS, apartmentIdsWithEvents, buildCells, buildDays, canShiftForward, cairoDay,
  cellKey, cleaningEvents, defaultStart, dominantLayer, filterByLayer, incidentEvents, queryWindow, shiftStart,
  waitingDays, type BoardEvent, type BoardLayer, type EventLayer, type PeriodDays,
} from './chessboardModel'

const LAYER_TONE: Record<EventLayer, string> = {
  cleanings: 'bg-accent-soft text-accent',
  requests: 'bg-warn-soft text-warn',
  breakdowns: 'bg-bad-soft text-bad',
}

export function Chessboard() {
  const { t, n, lang } = useI18n()
  const c = t.admin.chessboard
  const navigate = useNavigate()
  const today = cairoDay(new Date().toISOString()) ?? ''

  const [layer, setLayer] = useState<BoardLayer>('all')
  const [period, setPeriod] = useState<PeriodDays>(14)
  const [start, setStart] = useState(() => defaultStart(today, 14))
  const [query, setQuery] = useState('')
  const [onlyActive, setOnlyActive] = useState(false)
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [events, setEvents] = useState<BoardEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<{ apartmentId: number; day: string } | null>(null)

  const days = useMemo(() => buildDays(start, period), [start, period])

  const load = useCallback((silent?: boolean) => {
    const win = queryWindow(days)
    if (!win) return
    if (silent !== true) { setLoading(true); setFailed(false) }
    Promise.all([
      fetchApartmentsAdmin(),
      fetchBoardCleanings(win.fromISO, win.toISO),
      fetchBoardIncidents(win.fromISO, win.toISO),
    ])
      .then(([apts, cleanings, incidents]) => {
        setApartments(apts)
        setEvents([...cleaningEvents(cleanings, days), ...incidentEvents(incidents, days)])
        setFailed(false)
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [days])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['incidents', 'cleaning_events', 'apartments'], () => { load(true) })

  const layerEvents = useMemo(() => filterByLayer(events, layer), [events, layer])
  const cells = useMemo(() => buildCells(layerEvents), [layerEvents])
  const withEvents = useMemo(() => apartmentIdsWithEvents(layerEvents), [layerEvents])

  const rows = useMemo(() => {
    const found = filterApartments(apartments, query, apartments.length)
    return onlyActive ? found.filter((a) => withEvents.has(a.id)) : found
  }, [apartments, query, onlyActive, withEvents])

  const nowISO = new Date().toISOString()
  const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(lang, { weekday: 'short', timeZone: 'UTC' })

  const layerLabel: Record<BoardLayer, string> = {
    all: c.layerAll, cleanings: c.layerCleanings, requests: c.layerRequests, breakdowns: c.layerBreakdowns,
  }
  const stateLabel: Record<string, string> = {
    new: c.stateNew, in_progress: c.stateInProgress, confirmed: c.stateConfirmed, rejected: c.stateRejected,
    pending: c.statePending, posted: c.statePosted,
  }

  const changePeriod = (p: PeriodDays) => { setPeriod(p); setStart(defaultStart(today, p)) }
  const selectedApt = selected ? apartments.find((a) => a.id === selected.apartmentId) : undefined
  const selectedCell = selected ? cells.get(cellKey(selected.apartmentId, selected.day)) : undefined

  const segment = (active: boolean) =>
    `px-3 min-h-[40px] rounded-xl text-sm transition-colors ${active ? 'bg-accent-soft text-accent font-semibold' : 'text-muted hover:text-ink'}`

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{c.title}</h1>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="well rounded-2xl p-1 flex" role="group" aria-label={c.title}>
          {BOARD_LAYERS.map((l) => (
            <button key={l} type="button" aria-pressed={layer === l} onClick={() => setLayer(l)} className={segment(layer === l)}>
              {layerLabel[l]}
            </button>
          ))}
        </div>
        <div className="well rounded-2xl p-1 flex">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => changePeriod(p)} className={segment(period === p)}>
              {p === 14 ? c.period14 : c.period30}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setStart(shiftStart(start, -1))} aria-label={c.prevWeek} title={c.prevWeek}
            className="well rounded-xl min-w-[40px] min-h-[40px] flex items-center justify-center">
            <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <button type="button" onClick={() => setStart(defaultStart(today, period))} className="well rounded-xl px-3 min-h-[40px] text-sm text-ink">
            {c.today}
          </button>
          <button type="button" disabled={!canShiftForward(start, period, today)} onClick={() => setStart(shiftStart(start, 1))}
            aria-label={c.nextWeek} title={c.nextWeek}
            className="well rounded-xl min-w-[40px] min-h-[40px] flex items-center justify-center disabled:opacity-40">
            <ChevronRight className="w-4 h-4 rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="well rounded-xl px-3 min-h-[44px] flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <Search className="w-[18px] h-[18px] text-muted flex-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.search}
            aria-label={c.search}
            className="bg-transparent outline-none text-sm text-ink w-full"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink min-h-[44px]">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          {c.onlyWithEvents}
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-muted animate-spin" /></div>
      ) : failed ? (
        <ErrorState onRetry={() => load()} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted text-center py-10">{c.empty}</p>
      ) : (
        <div className="tile rounded-[20px] overflow-x-auto max-w-full">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky start-0 z-10 bg-app text-start text-xs font-medium text-muted px-3 py-2 min-w-[96px]">{c.apartment}</th>
                {days.map((d) => (
                  <th key={d} className={`px-1 py-2 text-center text-xs font-medium min-w-[48px] ${d === today ? 'text-accent font-semibold' : 'text-muted'}`}>
                    <div>{n(d.slice(8))}</div>
                    <div className="font-normal">{weekday(d)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <th scope="row" className="sticky start-0 z-10 bg-app text-start text-sm font-medium text-ink px-3 py-1 whitespace-nowrap">
                    {a.code}
                  </th>
                  {days.map((d) => {
                    const cell = cells.get(cellKey(a.id, d))
                    const top = cell ? dominantLayer(cell) : null
                    if (!cell || !top) return <td key={d} className="px-0.5 py-0.5"><div className="h-[44px] w-[44px] mx-auto" /></td>
                    return (
                      <td key={d} className="px-0.5 py-0.5">
                        <button
                          type="button"
                          onClick={() => setSelected({ apartmentId: a.id, day: d })}
                          aria-label={`${a.code}, ${d}: ${cell.count}`}
                          className={`h-[44px] w-[44px] mx-auto rounded-lg flex flex-col items-center justify-center leading-tight ${LAYER_TONE[top]} ${cell.pending > 0 ? 'ring-1 ring-warn' : ''}`}
                        >
                          <span className="text-sm font-semibold">{n(String(cell.count))}</span>
                          {cell.oldestPending && (
                            <span className="text-[10px]">{n(String(waitingDays(cell.oldestPending, nowISO)))}{c.dayShort}</span>
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={selected !== null}
        title={selectedApt && selected ? `${selectedApt.code} · ${selected.day}` : c.title}
        onClose={() => setSelected(null)}
        size="md"
      >
        <div className="space-y-2">
          {(selectedCell?.events ?? []).map((e) => (
            <div key={`${e.layer}-${e.id}`} className="well rounded-xl px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-medium rounded-md px-2 py-0.5 ${LAYER_TONE[e.layer]}`}>{layerLabel[e.layer]}</span>
                <span className="text-xs text-muted">{formatDateTime(e.at)}</span>
              </div>
              <p className={`text-xs mt-1 ${e.pending ? 'text-warn' : 'text-muted'}`}>{stateLabel[e.state] ?? e.state}</p>
              {e.text && <p className="text-sm text-ink mt-1">{e.text}</p>}
            </div>
          ))}
          {selectedApt && (
            <button
              type="button"
              onClick={() => { const id = selectedApt.id; setSelected(null); navigate(`/admin/apartments/${id}`) }}
              className="w-full bg-accent text-on-accent rounded-xl min-h-[44px] text-sm font-medium"
            >
              {c.openApartment}
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}
