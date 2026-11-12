import type { IncidentKind, IncidentStatus, ItemKind } from '@/lib/database.types'

export type DigestPeriod = '24h' | '7d'
export type Severity = 'red' | 'amber'
export type ApartmentLabel = 'urgent' | 'attention' | 'normal'

export type AlertCode =
  | 'incident_overdue'
  | 'shortage_unprocessed'
  | 'cleaning_waiting'
  | 'incident_repeat'
  | 'below_min'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Thresholds from the approved specification. */
export const DIGEST_RULES = {
  incidentOverdueHours: 48,
  shortageUnprocessedHours: 24,
  cleaningWaitingHours: 24,
  repeatWindowDays: 7,
  repeatMinCount: 2,
} as const

/** Kinds that count as "lost or broken" for the red rule. */
const SERIOUS_KINDS: IncidentKind[] = ['lost', 'broken', 'breakdown', 'damaged']

export interface DigestIncident {
  apartment_id: number
  kind: IncidentKind
  status: IncidentStatus
  created_at: string
}

export interface DigestCleaning {
  apartment_id: number
  cleaned_at: string
  status: 'done' | 'reversed'
  posting_status: 'pending' | 'posted' | 'rejected'
}

/** apartment_id is null for a shortage that is not tied to an apartment (company warehouse stocktake). */
export interface DigestShortage {
  apartment_id: number | null
  created_at: string
}

export interface DigestStockRow {
  kind: ItemKind
  below_min: boolean
}

export interface DigestInput {
  now: number
  period: DigestPeriod
  incidents: DigestIncident[]
  cleanings: DigestCleaning[]
  /** Unprocessed shortage events only. */
  shortages: DigestShortage[]
  stock: DigestStockRow[]
  spend: { current: number; previous: number | null }
  apartmentCode: (apartmentId: number) => string | undefined
}

export interface DigestAlert {
  code: AlertCode
  severity: Severity
  /** null = warehouse as a whole */
  apartmentId: number | null
  count: number
  /** age in hours of the oldest record behind the alert, null when not applicable */
  oldestHours: number | null
}

export interface ApartmentDigest {
  apartmentId: number
  code: string
  newIncidents: number
  newCleanings: number
  incidentsIn7d: number
  repeat: boolean
  oldestWaitingHours: number | null
  alerts: DigestAlert[]
  label: ApartmentLabel
}

export interface WarehouseDigest {
  belowMinAssets: number
  belowMinConsumables: number
  /** all unprocessed shortages, with and without an apartment */
  unprocessedShortages: number
  /** unprocessed shortages that are not tied to an apartment */
  unassignedShortages: number
  spendCurrent: number
  spendPrevious: number | null
  /** percent change against the previous period, null when there is nothing to compare with */
  spendChangePct: number | null
  alerts: DigestAlert[]
}

export interface Digest {
  period: DigestPeriod
  apartments: ApartmentDigest[]
  warehouse: WarehouseDigest
  redCount: number
  amberCount: number
}

export function periodMs(period: DigestPeriod): number {
  return period === '24h' ? DAY : 7 * DAY
}

function ageHours(now: number, iso: string): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, (now - t) / HOUR)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function maxOrNull(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values)
}

function isOpen(status: IncidentStatus): boolean {
  return status === 'new' || status === 'in_progress'
}

function isWaitingCleaning(c: DigestCleaning): boolean {
  return c.status === 'done' && c.posting_status === 'pending'
}

function labelOf(alerts: DigestAlert[]): ApartmentLabel {
  if (alerts.some((a) => a.severity === 'red')) return 'urgent'
  if (alerts.length > 0) return 'attention'
  return 'normal'
}

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const map = new Map<number, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

export function buildDigest(input: DigestInput): Digest {
  const { now, period } = input
  const since = now - periodMs(period)
  const repeatSince = now - DIGEST_RULES.repeatWindowDays * DAY

  const incidentsBy = groupBy(input.incidents, (r) => r.apartment_id)
  const cleaningsBy = groupBy(input.cleanings, (r) => r.apartment_id)
  const shortagesBy = groupBy(
    input.shortages.filter((s): s is DigestShortage & { apartment_id: number } => s.apartment_id != null),
    (r) => r.apartment_id,
  )

  const ids = new Set<number>([...incidentsBy.keys(), ...cleaningsBy.keys(), ...shortagesBy.keys()])
  const apartments: ApartmentDigest[] = []

  for (const apartmentId of ids) {
    const incidents = incidentsBy.get(apartmentId) ?? []
    const cleanings = cleaningsBy.get(apartmentId) ?? []
    const shortages = shortagesBy.get(apartmentId) ?? []
    const alerts: DigestAlert[] = []

    const overdue = incidents
      .filter((i) => isOpen(i.status) && SERIOUS_KINDS.includes(i.kind))
      .map((i) => ageHours(now, i.created_at))
      .filter((h): h is number => h != null && h > DIGEST_RULES.incidentOverdueHours)
    if (overdue.length > 0) {
      alerts.push({ code: 'incident_overdue', severity: 'red', apartmentId, count: overdue.length, oldestHours: round1(Math.max(...overdue)) })
    }

    const staleShortages = shortages
      .map((s) => ageHours(now, s.created_at))
      .filter((h): h is number => h != null && h > DIGEST_RULES.shortageUnprocessedHours)
    if (staleShortages.length > 0) {
      alerts.push({ code: 'shortage_unprocessed', severity: 'red', apartmentId, count: staleShortages.length, oldestHours: round1(Math.max(...staleShortages)) })
    }

    const waitingCleanings = cleanings
      .filter(isWaitingCleaning)
      .map((c) => ageHours(now, c.cleaned_at))
      .filter((h): h is number => h != null && h > DIGEST_RULES.cleaningWaitingHours)
    if (waitingCleanings.length > 0) {
      alerts.push({ code: 'cleaning_waiting', severity: 'amber', apartmentId, count: waitingCleanings.length, oldestHours: round1(Math.max(...waitingCleanings)) })
    }

    const in7d = incidents.filter((i) => i.status !== 'rejected' && Date.parse(i.created_at) >= repeatSince && Date.parse(i.created_at) <= now)
    const repeat = in7d.length >= DIGEST_RULES.repeatMinCount
    if (repeat) {
      alerts.push({ code: 'incident_repeat', severity: 'amber', apartmentId, count: in7d.length, oldestHours: null })
    }

    const waiting = [
      ...incidents.filter((i) => isOpen(i.status)).map((i) => ageHours(now, i.created_at)),
      ...cleanings.filter(isWaitingCleaning).map((c) => ageHours(now, c.cleaned_at)),
      ...shortages.map((s) => ageHours(now, s.created_at)),
    ].filter((h): h is number => h != null)
    const oldest = maxOrNull(waiting)

    apartments.push({
      apartmentId,
      code: input.apartmentCode(apartmentId) ?? `#${apartmentId}`,
      newIncidents: incidents.filter((i) => { const t = Date.parse(i.created_at); return t >= since && t <= now }).length,
      newCleanings: cleanings.filter((c) => { const t = Date.parse(c.cleaned_at); return c.status === 'done' && t >= since && t <= now }).length,
      incidentsIn7d: in7d.length,
      repeat,
      oldestWaitingHours: oldest == null ? null : round1(oldest),
      alerts,
      label: labelOf(alerts),
    })
  }

  const rank: Record<ApartmentLabel, number> = { urgent: 0, attention: 1, normal: 2 }
  apartments.sort((a, b) =>
    rank[a.label] - rank[b.label]
    || (b.oldestWaitingHours ?? -1) - (a.oldestWaitingHours ?? -1)
    || a.code.localeCompare(b.code),
  )

  const unassigned = input.shortages.filter((s) => s.apartment_id == null)
  const unassignedStale = unassigned
    .map((s) => ageHours(now, s.created_at))
    .filter((h): h is number => h != null && h > DIGEST_RULES.shortageUnprocessedHours)
  const belowMinAssets = input.stock.filter((r) => r.below_min && r.kind === 'asset').length
  const belowMinConsumables = input.stock.filter((r) => r.below_min && r.kind === 'consumable').length

  const warehouseAlerts: DigestAlert[] = []
  if (unassignedStale.length > 0) {
    warehouseAlerts.push({ code: 'shortage_unprocessed', severity: 'red', apartmentId: null, count: unassignedStale.length, oldestHours: round1(Math.max(...unassignedStale)) })
  }
  if (belowMinAssets + belowMinConsumables > 0) {
    warehouseAlerts.push({ code: 'below_min', severity: 'amber', apartmentId: null, count: belowMinAssets + belowMinConsumables, oldestHours: null })
  }

  const { current, previous } = input.spend
  const spendChangePct = previous != null && previous > 0 ? round1(((current - previous) / previous) * 100) : null

  const all = [...apartments.flatMap((a) => a.alerts), ...warehouseAlerts]
  return {
    period,
    apartments,
    warehouse: {
      belowMinAssets,
      belowMinConsumables,
      unprocessedShortages: input.shortages.length,
      unassignedShortages: unassigned.length,
      spendCurrent: current,
      spendPrevious: previous,
      spendChangePct,
      alerts: warehouseAlerts,
    },
    redCount: all.filter((a) => a.severity === 'red').length,
    amberCount: all.filter((a) => a.severity === 'amber').length,
  }
}

/** What would be sent to a language model: apartment codes, statuses, ages and numbers only. */
export interface AiPayload {
  period: DigestPeriod
  apartments: Array<{
    code: string
    label: ApartmentLabel
    new_incidents: number
    new_cleanings: number
    repeat: boolean
    oldest_waiting_hours: number | null
    alerts: Array<{ code: AlertCode; severity: Severity; count: number; oldest_hours: number | null }>
  }>
  warehouse: {
    below_min_assets: number
    below_min_consumables: number
    unprocessed_shortages: number
    unassigned_shortages: number
    spend_change_pct: number | null
    alerts: Array<{ code: AlertCode; severity: Severity; count: number; oldest_hours: number | null }>
  }
}

function aiAlert(a: DigestAlert) {
  return { code: a.code, severity: a.severity, count: a.count, oldest_hours: a.oldestHours }
}

export function toAiPayload(digest: Digest): AiPayload {
  return {
    period: digest.period,
    apartments: digest.apartments
      .filter((a) => a.label !== 'normal' || a.newIncidents > 0 || a.newCleanings > 0)
      .map((a) => ({
        code: a.code,
        label: a.label,
        new_incidents: a.newIncidents,
        new_cleanings: a.newCleanings,
        repeat: a.repeat,
        oldest_waiting_hours: a.oldestWaitingHours,
        alerts: a.alerts.map(aiAlert),
      })),
    warehouse: {
      below_min_assets: digest.warehouse.belowMinAssets,
      below_min_consumables: digest.warehouse.belowMinConsumables,
      unprocessed_shortages: digest.warehouse.unprocessedShortages,
      unassigned_shortages: digest.warehouse.unassignedShortages,
      spend_change_pct: digest.warehouse.spendChangePct,
      alerts: digest.warehouse.alerts.map(aiAlert),
    },
  }
}
