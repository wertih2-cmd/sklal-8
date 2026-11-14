import { describe, it, expect } from 'vitest'
import type { Incident } from '@/lib/database.types'
import type { CleaningFeedRow } from '@/modules/admin/cleaningFeed'
import { buildApartmentStats, needsAttention, sortByAttention } from './managerStats'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-14T12:00:00Z')
const SINCE = NOW - 7 * DAY
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const apartments = [{ id: 1, code: 'A1' }, { id: 2, code: 'A2' }, { id: 3, code: 'A10' }]

function cleaning(over: Partial<CleaningFeedRow>): CleaningFeedRow {
  return { id: 'c', apartment_id: 1, cleaned_at: iso(DAY), status: 'done', posting_status: 'posted', note: null, media_count: 0, staff_names: [], ...over }
}
function incident(over: Partial<Incident>): Incident {
  return {
    id: 'i', apartment_id: 1, item_id: null, free_text: null, kind: 'broken', qty: 1, status: 'confirmed', photo_paths: [],
    comment: null, created_by: null, created_at: iso(DAY), resolved_by: null, resolved_at: null, resolution_note: null,
    writeoff_move_id: null, client_op_id: null, ...over,
  }
}
const stat = (list: ReturnType<typeof buildApartmentStats>, id: number) => list.find((s) => s.apartmentId === id)!

describe('buildApartmentStats: cleanings', () => {
  it('counts posted and pending cleanings of the period, not rejected or reversed ones', () => {
    const list = buildApartmentStats({
      apartments, completeness: null, incidents: [], sinceMs: SINCE,
      cleanings: [
        cleaning({ id: '1' }),
        cleaning({ id: '2', posting_status: 'pending' }),
        cleaning({ id: '3', posting_status: 'rejected' }),
        cleaning({ id: '4', status: 'reversed' }),
        cleaning({ id: '5', cleaned_at: iso(10 * DAY) }),
      ],
    })
    expect(stat(list, 1).cleanings).toBe(2)
  })
  it('a pending cleaning counts as waiting even when it is older than the period', () => {
    const list = buildApartmentStats({
      apartments, completeness: null, incidents: [], sinceMs: SINCE,
      cleanings: [cleaning({ posting_status: 'pending', cleaned_at: iso(20 * DAY) })],
    })
    expect(stat(list, 1).pendingCleanings).toBe(1)
    expect(stat(list, 1).cleanings).toBe(0)
  })
  it('ignores cleanings of unknown apartments', () => {
    const list = buildApartmentStats({ apartments, completeness: null, incidents: [], sinceMs: SINCE, cleanings: [cleaning({ apartment_id: 99 })] })
    expect(list).toHaveLength(3)
    expect(list.every((s) => s.cleanings === 0)).toBe(true)
  })
})

describe('buildApartmentStats: incidents', () => {
  it('splits breakdowns from other incidents and skips rejected and old ones', () => {
    const list = buildApartmentStats({
      apartments, completeness: null, cleanings: [], sinceMs: SINCE,
      incidents: [
        incident({ id: '1', kind: 'breakdown' }),
        incident({ id: '2', kind: 'broken' }),
        incident({ id: '3', kind: 'lost', status: 'rejected' }),
        incident({ id: '4', kind: 'other', created_at: iso(10 * DAY) }),
      ],
    })
    const s = stat(list, 1)
    expect(s.breakdowns).toBe(1)
    expect(s.incidents).toBe(1)
  })
  it('open incidents count whatever their age', () => {
    const list = buildApartmentStats({
      apartments, completeness: null, cleanings: [], sinceMs: SINCE,
      incidents: [incident({ status: 'new', created_at: iso(30 * DAY) }), incident({ id: '2', status: 'in_progress' }), incident({ id: '3', status: 'confirmed' })],
    })
    expect(stat(list, 1).openIncidents).toBe(2)
  })
  it('a repeat is an incident beyond the first of the same kind in the apartment', () => {
    const list = buildApartmentStats({
      apartments, completeness: null, cleanings: [], sinceMs: SINCE,
      incidents: [
        incident({ id: '1', kind: 'breakdown' }), incident({ id: '2', kind: 'breakdown' }), incident({ id: '3', kind: 'breakdown' }),
        incident({ id: '4', kind: 'broken' }),
        incident({ id: '5', kind: 'breakdown', apartment_id: 2 }),
      ],
    })
    expect(stat(list, 1).repeats).toBe(2)
    expect(stat(list, 2).repeats).toBe(0)
  })
})

describe('buildApartmentStats: completeness', () => {
  it('null when the completeness is not loaded', () => {
    const list = buildApartmentStats({ apartments, completeness: null, cleanings: [], incidents: [], sinceMs: SINCE })
    expect(list.every((s) => s.completenessPct === null)).toBe(true)
  })
  it('an apartment without norm lines is 0, a full one 100, a short one below', () => {
    const list = buildApartmentStats({
      apartments, cleanings: [], incidents: [], sinceMs: SINCE,
      completeness: new Map([[1, { total: 10, missing: 0 }], [2, { total: 10, missing: 5 }]]),
    })
    expect(stat(list, 1).completenessPct).toBe(100)
    expect(stat(list, 2).completenessPct).toBe(50)
    expect(stat(list, 3).completenessPct).toBe(0)
  })
})

describe('needsAttention and sortByAttention', () => {
  const base = { apartmentId: 1, code: 'A1', cleanings: 0, incidents: 0, breakdowns: 0, repeats: 0, pendingCleanings: 0, openIncidents: 0, completenessPct: 100 }
  it('quiet and complete apartment needs nothing', () => {
    expect(needsAttention(base)).toBe(false)
    expect(needsAttention({ ...base, completenessPct: null })).toBe(false)
  })
  it('each reason raises attention', () => {
    expect(needsAttention({ ...base, pendingCleanings: 1 })).toBe(true)
    expect(needsAttention({ ...base, openIncidents: 1 })).toBe(true)
    expect(needsAttention({ ...base, repeats: 1 })).toBe(true)
    expect(needsAttention({ ...base, completenessPct: 99 })).toBe(true)
  })
  it('waiting decisions first, then repeats, then least complete, then code in natural order', () => {
    const list = [
      { ...base, apartmentId: 1, code: 'A10', completenessPct: 80 },
      { ...base, apartmentId: 2, code: 'A2', completenessPct: 80 },
      { ...base, apartmentId: 3, code: 'B1', completenessPct: 40 },
      { ...base, apartmentId: 4, code: 'C1', repeats: 2 },
      { ...base, apartmentId: 5, code: 'D1', openIncidents: 1, pendingCleanings: 1 },
    ]
    expect(sortByAttention(list).map((s) => s.code)).toEqual(['D1', 'C1', 'B1', 'A2', 'A10'])
  })
})
