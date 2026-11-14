import type { Incident } from '@/lib/database.types'
import { cleaningState, type CleaningFeedRow } from '@/modules/admin/cleaningFeed'
import { coveredPct, type ApartmentNorms } from '@/modules/admin/completeness'

export type ManagerPeriod = 7 | 30
export const MANAGER_PERIODS: readonly ManagerPeriod[] = [7, 30]

export interface ApartmentStat {
  apartmentId: number
  code: string
  /** Cleanings of the period that are posted or still waiting for a decision (rejected and reversed do not count). */
  cleanings: number
  /** Incidents of the period other than breakdowns; rejected ones do not count. */
  incidents: number
  breakdowns: number
  /** Incidents of the period beyond the first one of the same kind in the same apartment. */
  repeats: number
  /** Cleanings waiting for a decision, whatever their age. */
  pendingCleanings: number
  /** Incidents that are new or in progress, whatever their age. */
  openIncidents: number
  /** Share of covered norm lines; null when the completeness could not be loaded. */
  completenessPct: number | null
}

export interface ApartmentStatInput {
  apartments: ReadonlyArray<{ id: number; code: string }>
  cleanings: readonly CleaningFeedRow[]
  incidents: readonly Incident[]
  /** Norm lines per apartment; an apartment missing from the map has no norms. null = not loaded. */
  completeness: ReadonlyMap<number, ApartmentNorms> | null
  /** Start of the period, ms since epoch. */
  sinceMs: number
}

export function buildApartmentStats(input: ApartmentStatInput): ApartmentStat[] {
  const stats = new Map<number, ApartmentStat>()
  for (const a of input.apartments) {
    const norms = input.completeness ? input.completeness.get(a.id) : undefined
    stats.set(a.id, {
      apartmentId: a.id,
      code: a.code,
      cleanings: 0,
      incidents: 0,
      breakdowns: 0,
      repeats: 0,
      pendingCleanings: 0,
      openIncidents: 0,
      completenessPct: input.completeness ? coveredPct(norms?.total ?? 0, norms?.missing ?? 0) : null,
    })
  }

  for (const c of input.cleanings) {
    const s = stats.get(c.apartment_id)
    if (!s) continue
    const state = cleaningState(c)
    if (state === 'pending') s.pendingCleanings++
    if ((state === 'pending' || state === 'posted') && Date.parse(c.cleaned_at) >= input.sinceMs) s.cleanings++
  }

  const kinds = new Map<string, number>()
  for (const i of input.incidents) {
    const s = stats.get(i.apartment_id)
    if (!s) continue
    if (i.status === 'new' || i.status === 'in_progress') s.openIncidents++
    if (i.status === 'rejected' || Date.parse(i.created_at) < input.sinceMs) continue
    if (i.kind === 'breakdown') s.breakdowns++
    else s.incidents++
    const key = `${i.apartment_id}:${i.kind}`
    const seen = kinds.get(key) ?? 0
    if (seen >= 1) s.repeats++
    kinds.set(key, seen + 1)
  }

  return [...stats.values()]
}

/** Something to look at: a decision is waiting, an incident is open, a problem repeated, or the norms are not covered. */
export function needsAttention(s: ApartmentStat): boolean {
  return s.pendingCleanings > 0 || s.openIncidents > 0 || s.repeats > 0 || (s.completenessPct != null && s.completenessPct < 100)
}

/** Most urgent first: waiting decisions and open incidents, then repeats, then the least complete, then by code. */
export function sortByAttention(list: readonly ApartmentStat[]): ApartmentStat[] {
  return [...list].sort((a, b) => {
    const wait = b.pendingCleanings + b.openIncidents - (a.pendingCleanings + a.openIncidents)
    if (wait !== 0) return wait
    if (b.repeats !== a.repeats) return b.repeats - a.repeats
    const ap = a.completenessPct ?? 101
    const bp = b.completenessPct ?? 101
    if (ap !== bp) return ap - bp
    return a.code.localeCompare(b.code, 'en', { numeric: true })
  })
}
