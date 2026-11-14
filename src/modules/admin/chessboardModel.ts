import type { EventStatus, IncidentKind, IncidentStatus } from '@/lib/database.types'
import type { PostingStatus } from './cleaningFeed'

/** The board works in the Cairo calendar, like the rest of the app (see lib/format.ts). */
const TZ = 'Africa/Cairo'
const DAY_MS = 86_400_000

export type EventLayer = 'cleanings' | 'requests' | 'breakdowns'
export type BoardLayer = 'all' | EventLayer
export const BOARD_LAYERS: readonly BoardLayer[] = ['all', 'cleanings', 'requests', 'breakdowns']

export type PeriodDays = 14 | 30
export const PERIODS: readonly PeriodDays[] = [14, 30]

export interface BoardCleaningRow {
  id: string
  apartment_id: number
  cleaned_at: string
  status: EventStatus
  posting_status: PostingStatus
  note: string | null
}

export interface BoardIncidentRow {
  id: string
  apartment_id: number
  kind: IncidentKind
  status: IncidentStatus
  created_at: string
  free_text: string | null
  comment: string | null
}

export interface BoardEvent {
  id: string
  apartment_id: number
  /** Cairo calendar day, YYYY-MM-DD. */
  day: string
  layer: EventLayer
  /** The instant of the event (cleaned_at / created_at). */
  at: string
  /** Waits for a decision: a cleaning not approved yet, a request still "new". */
  pending: boolean
  /** Raw status: posting_status for a cleaning, incident status for a request or a breakdown. */
  state: string
  text: string | null
}

export interface BoardCell {
  count: number
  pending: number
  /** The earliest instant among the pending events of the cell. */
  oldestPending: string | null
  layers: Record<EventLayer, number>
  /** Oldest first. */
  events: BoardEvent[]
}

/** YYYY-MM-DD of the instant in Cairo; null for text that is not a date. */
export function cairoDay(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  const y = get('year'), m = get('month'), day = get('day')
  return y && m && day ? `${y}-${m}-${day}` : null
}

function dayToUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDays(day: string, n: number): string {
  return new Date(dayToUtc(day) + n * DAY_MS).toISOString().slice(0, 10)
}

export function buildDays(start: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => addDays(start, i))
}

/** First day of the window so that the last column is today. */
export function defaultStart(today: string, count: number): string {
  return addDays(today, -(count - 1))
}

export function shiftStart(start: string, weeks: number): string {
  return addDays(start, weeks * 7)
}

/** The window may not run into the future: there is nothing to show there. */
export function canShiftForward(start: string, count: number, today: string): boolean {
  return addDays(start, count - 1) < today
}

/**
 * Instants to ask the database for: one day of margin on each side, because a Cairo day does not start at 00:00 UTC.
 * The exact filter is by cairoDay afterwards.
 */
export function queryWindow(days: readonly string[]): { fromISO: string; toISO: string } | null {
  if (days.length === 0) return null
  return {
    fromISO: `${addDays(days[0], -1)}T00:00:00.000Z`,
    toISO: `${addDays(days[days.length - 1], 2)}T00:00:00.000Z`,
  }
}

/** Cleanings of the window. A reversed or rejected cleaning did not happen, so it is left out. */
export function cleaningEvents(rows: readonly BoardCleaningRow[], days: readonly string[]): BoardEvent[] {
  const inWindow = new Set(days)
  const out: BoardEvent[] = []
  for (const r of rows) {
    if (r.status === 'reversed' || r.posting_status === 'rejected') continue
    const day = cairoDay(r.cleaned_at)
    if (!day || !inWindow.has(day)) continue
    out.push({
      id: r.id, apartment_id: r.apartment_id, day, layer: 'cleanings', at: r.cleaned_at,
      pending: r.posting_status === 'pending', state: r.posting_status, text: r.note,
    })
  }
  return out
}

/** Breakdowns are kind "breakdown"; every other kind is a request. Rejected ones are left out. */
export function incidentEvents(rows: readonly BoardIncidentRow[], days: readonly string[]): BoardEvent[] {
  const inWindow = new Set(days)
  const out: BoardEvent[] = []
  for (const r of rows) {
    if (r.status === 'rejected') continue
    const day = cairoDay(r.created_at)
    if (!day || !inWindow.has(day)) continue
    out.push({
      id: r.id, apartment_id: r.apartment_id, day, layer: r.kind === 'breakdown' ? 'breakdowns' : 'requests', at: r.created_at,
      pending: r.status === 'new', state: r.status, text: r.free_text || r.comment || null,
    })
  }
  return out
}

export function filterByLayer(events: readonly BoardEvent[], layer: BoardLayer): BoardEvent[] {
  return layer === 'all' ? [...events] : events.filter((e) => e.layer === layer)
}

export function cellKey(apartmentId: number, day: string): string {
  return `${apartmentId}|${day}`
}

export function buildCells(events: readonly BoardEvent[]): Map<string, BoardCell> {
  const cells = new Map<string, BoardCell>()
  for (const e of events) {
    const key = cellKey(e.apartment_id, e.day)
    let c = cells.get(key)
    if (!c) {
      c = { count: 0, pending: 0, oldestPending: null, layers: { cleanings: 0, requests: 0, breakdowns: 0 }, events: [] }
      cells.set(key, c)
    }
    c.count += 1
    c.layers[e.layer] += 1
    c.events.push(e)
    if (e.pending) {
      c.pending += 1
      if (c.oldestPending === null || e.at < c.oldestPending) c.oldestPending = e.at
    }
  }
  for (const c of cells.values()) c.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return cells
}

/** The layer that colours a cell: the most urgent one present (breakdown, then request, then cleaning). */
export function dominantLayer(cell: Pick<BoardCell, 'layers'>): EventLayer | null {
  if (cell.layers.breakdowns > 0) return 'breakdowns'
  if (cell.layers.requests > 0) return 'requests'
  if (cell.layers.cleanings > 0) return 'cleanings'
  return null
}

/** Whole days an event has been waiting (0 when it is from today or from the future). */
export function waitingDays(atISO: string, nowISO: string): number {
  const diff = new Date(nowISO).getTime() - new Date(atISO).getTime()
  if (!Number.isFinite(diff) || diff <= 0) return 0
  return Math.floor(diff / DAY_MS)
}

export function apartmentIdsWithEvents(events: readonly BoardEvent[]): Set<number> {
  return new Set(events.map((e) => e.apartment_id))
}
