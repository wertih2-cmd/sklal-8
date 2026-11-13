import { describe, it, expect } from 'vitest'
import { normMode, countByApartment, buildAptNormRows, filterAptNormRows, summarize, readCount, ALL_NORM_TYPES } from './aptNormsModel'
import type { Apartment } from '@/lib/database.types'

const apt = (id: number, code: string, number: string, buildingId = 1): Apartment => ({
  id, building_id: buildingId, number, code, type: '1br', status: 'active', is_owner: false, created_at: '2026-01-01',
})
const buildings = [{ id: 1, name: 'Tower A' }, { id: 2, name: 'Villa' }]
const apartments = [apt(3, 'A-10', '10'), apt(1, 'A-2', '2'), apt(2, 'V-1', '1', 2)]

describe('normMode', () => {
  it('is individual as soon as the apartment has a rule of its own', () => {
    expect(normMode(0)).toBe('type')
    expect(normMode(1)).toBe('individual')
    expect(normMode(40)).toBe('individual')
  })
})

describe('countByApartment', () => {
  it('counts rules per apartment and skips templates', () => {
    const m = countByApartment([{ apartment_id: 1 }, { apartment_id: 1 }, { apartment_id: 2 }, { apartment_id: null }])
    expect([...m.entries()]).toEqual([[1, 2], [2, 1]])
    expect(countByApartment([]).size).toBe(0)
  })
})

describe('buildAptNormRows and filterAptNormRows', () => {
  const counts = new Map([[1, 12], [2, 0]])
  const rows = buildAptNormRows(apartments, buildings, counts)

  it('joins building names and modes, ordered by code with numbers in natural order', () => {
    expect(rows.map((r) => r.apartment.code)).toEqual(['A-2', 'A-10', 'V-1'])
    expect(rows.map((r) => [r.mode, r.count])).toEqual([['individual', 12], ['type', 0], ['type', 0]])
    expect(rows[2].buildingName).toBe('Villa')
  })

  it('filters by mode and by code, number or building', () => {
    expect(filterAptNormRows(rows, '', 'individual').map((r) => r.apartment.id)).toEqual([1])
    expect(filterAptNormRows(rows, '', 'type')).toHaveLength(2)
    expect(filterAptNormRows(rows, 'villa', 'all').map((r) => r.apartment.id)).toEqual([2])
    expect(filterAptNormRows(rows, ' a-1 ', 'all').map((r) => r.apartment.id)).toEqual([3])
    expect(filterAptNormRows(rows, 'zzz', 'all')).toHaveLength(0)
  })

  it('summarizes', () => {
    expect(summarize(rows)).toEqual({ total: 3, individual: 1 })
    expect(summarize([])).toEqual({ total: 0, individual: 0 })
  })
})

describe('readCount and norm types', () => {
  it('reads a number from a tool answer and falls back to 0', () => {
    expect(readCount({ materialized: 7 }, 'materialized')).toBe(7)
    expect(readCount({ reset: -1 }, 'reset')).toBe(0)
    expect(readCount({}, 'reset')).toBe(0)
    expect(readCount(null, 'reset')).toBe(0)
    expect(readCount('x', 'reset')).toBe(0)
  })

  it('covers all three kinds of norms', () => {
    expect(ALL_NORM_TYPES).toEqual(['asset_standing', 'turnover_replenish', 'cleaning_consumption'])
  })
})
