import type { Incident, IncidentStatus, ReportStockMoveRow } from '@/lib/database.types'

export type PeriodDays = 7 | 30 | 90
export const PERIOD_OPTIONS: PeriodDays[] = [7, 30, 90]

const cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Calendar day (YYYY-MM-DD) of an instant in Africa/Cairo; null for an invalid date. */
export function cairoDay(input: string | Date): string | null {
  const date = typeof input === 'string' ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return null
  const values = new Map(cairoFmt.formatToParts(date).map((p) => [p.type, p.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

export function shiftDay(day: string, delta: number): string {
  const shifted = new Date(`${day}T12:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + delta)
  return shifted.toISOString().slice(0, 10)
}

/** Last `count` days ending at `today`, oldest first. */
export function lastDays(today: string, count: number): string[] {
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(shiftDay(today, -i))
  return out
}

export interface DayPoint {
  day: string
  value: number
  partial: boolean
}

export interface Bucket {
  key: string
  /** apartment id for apartment buckets, otherwise null */
  id: number | null
  /** base (unlocalized) name: category name or apartment code; empty when unknown */
  label: string
  value: number
  partial: boolean
  /** true for the aggregated remainder produced by topBuckets */
  other?: boolean
}

export interface ExpenseSummary {
  total: number
  /** at least one expense move has no purchase price, so totals are understated */
  partial: boolean
  unpricedMoves: number
  days: DayPoint[]
  categories: Bucket[]
  apartments: Bucket[]
}

interface Acc { value: number; partial: boolean }

function add(map: Map<string, Acc>, key: string, value: number, partial: boolean): void {
  const cur = map.get(key) ?? { value: 0, partial: false }
  cur.value += value
  if (partial) cur.partial = true
  map.set(key, cur)
}

function sortBuckets(list: Bucket[]): Bucket[] {
  return list
    .filter((b) => b.partial || Math.abs(b.value) > 0.005)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

/**
 * Company-stock expense (moves into the write-off sink, minus returns from it),
 * valued like the "Expense" report: sign * qty * unit_cost. Owner moves are excluded.
 */
export function summarizeExpense(moves: ReportStockMoveRow[], days: string[]): ExpenseSummary {
  const daySet = new Set(days)
  const byDay = new Map<string, Acc>()
  const byCategory = new Map<string, Acc>()
  const byApartment = new Map<string, Acc>()
  const aptMeta = new Map<string, { id: number | null; label: string }>()
  let unpricedMoves = 0

  for (const move of moves) {
    if (move.sink_flow === 0 || move.owner_apartment_id != null) continue
    const day = cairoDay(move.moved_at)
    if (day == null || !daySet.has(day)) continue
    const unpriced = move.unit_cost == null
    if (unpriced) unpricedMoves++
    const value = unpriced ? 0 : move.sink_flow * move.qty * (move.unit_cost as number)
    add(byDay, day, value, unpriced)
    add(byCategory, move.category, value, unpriced)
    const aptKey = move.apartment_id == null ? 'none' : String(move.apartment_id)
    add(byApartment, aptKey, value, unpriced)
    if (!aptMeta.has(aptKey)) aptMeta.set(aptKey, { id: move.apartment_id, label: move.apartment_code ?? '' })
  }

  const dayPoints: DayPoint[] = days.map((day) => {
    const acc = byDay.get(day)
    return { day, value: acc?.value ?? 0, partial: acc?.partial ?? false }
  })

  const categories = sortBuckets(
    Array.from(byCategory, ([key, acc]) => ({ key, id: null, label: key, value: acc.value, partial: acc.partial })),
  )
  const apartments = sortBuckets(
    Array.from(byApartment, ([key, acc]) => {
      const meta = aptMeta.get(key) ?? { id: null, label: '' }
      return { key, id: meta.id, label: meta.label, value: acc.value, partial: acc.partial }
    }),
  )

  return {
    total: dayPoints.reduce((s, d) => s + d.value, 0),
    partial: unpricedMoves > 0,
    unpricedMoves,
    days: dayPoints,
    categories,
    apartments,
  }
}

/** First `limit` buckets plus one aggregated "other" bucket for the rest (if any). */
export function topBuckets(buckets: Bucket[], limit: number): Bucket[] {
  if (buckets.length <= limit) return buckets
  const head = buckets.slice(0, limit)
  const rest = buckets.slice(limit)
  head.push({
    key: '__other',
    id: null,
    label: '',
    value: rest.reduce((s, b) => s + b.value, 0),
    partial: rest.some((b) => b.partial),
    other: true,
  })
  return head
}

export const INCIDENT_STATUSES: IncidentStatus[] = ['new', 'in_progress', 'confirmed', 'rejected']

export interface IncidentDay {
  day: string
  counts: Record<IncidentStatus, number>
  total: number
}

export function incidentsByDay(
  incidents: Array<Pick<Incident, 'created_at' | 'status'>>,
  days: string[],
): IncidentDay[] {
  const map = new Map<string, IncidentDay>(
    days.map((day) => [day, { day, counts: { new: 0, in_progress: 0, confirmed: 0, rejected: 0 }, total: 0 }]),
  )
  for (const inc of incidents) {
    const day = cairoDay(inc.created_at)
    const entry = day == null ? undefined : map.get(day)
    if (!entry || !(inc.status in entry.counts)) continue
    entry.counts[inc.status]++
    entry.total++
  }
  return days.map((day) => map.get(day) as IncidentDay)
}
