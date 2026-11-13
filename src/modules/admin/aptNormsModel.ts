import type { Apartment, Building, NormType } from '@/lib/database.types'

export const ALL_NORM_TYPES: NormType[] = ['asset_standing', 'turnover_replenish', 'cleaning_consumption']

/** "type": the apartment follows the template of its type. "individual": it has norms of its own. */
export type NormMode = 'type' | 'individual'
export type ModeFilter = 'all' | NormMode

/** Any rule of the apartment itself (a zero quantity too: it excludes an item) makes its norms individual. */
export function normMode(ownRules: number): NormMode {
  return ownRules > 0 ? 'individual' : 'type'
}

export function countByApartment(rows: Array<{ apartment_id: number | null }>): Map<number, number> {
  const out = new Map<number, number>()
  for (const r of rows) {
    if (r.apartment_id == null) continue
    out.set(r.apartment_id, (out.get(r.apartment_id) ?? 0) + 1)
  }
  return out
}

export interface AptNormRow {
  apartment: Apartment
  buildingName: string
  count: number
  mode: NormMode
}

export function buildAptNormRows(apartments: Apartment[], buildings: Building[], counts: Map<number, number>): AptNormRow[] {
  const names = new Map(buildings.map((b) => [b.id, b.name]))
  return apartments
    .map((apartment) => {
      const count = counts.get(apartment.id) ?? 0
      return { apartment, buildingName: names.get(apartment.building_id) ?? '', count, mode: normMode(count) }
    })
    .sort((a, b) => a.apartment.code.localeCompare(b.apartment.code, undefined, { numeric: true }))
}

export function filterAptNormRows(rows: AptNormRow[], query: string, mode: ModeFilter): AptNormRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => {
    if (mode !== 'all' && r.mode !== mode) return false
    if (!q) return true
    return [r.apartment.code, r.apartment.number, r.buildingName].some((s) => s.toLowerCase().includes(q))
  })
}

export function summarize(rows: AptNormRow[]): { total: number; individual: number } {
  return { total: rows.length, individual: rows.filter((r) => r.mode === 'individual').length }
}

/** A count from the jsonb answer of a norm tool function; 0 when the field is missing. */
export function readCount(data: unknown, key: string): number {
  if (typeof data !== 'object' || data === null) return 0
  const v = (data as Record<string, unknown>)[key]
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}
