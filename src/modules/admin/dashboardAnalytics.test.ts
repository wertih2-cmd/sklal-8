import { describe, it, expect } from 'vitest'
import {
  cairoDay, shiftDay, lastDays, summarizeExpense, topBuckets, incidentsByDay, type Bucket,
} from './dashboardAnalytics'
import type { ReportStockMoveRow } from '@/lib/database.types'

function move(partial: Partial<ReportStockMoveRow>): ReportStockMoveRow {
  return {
    id: 1,
    item_id: 1,
    item_name: 'Towel',
    category: 'Linen',
    pack_size: 1,
    pack_label: 'pcs',
    qty: 2,
    unit_cost: 10,
    source_type: 'cleaning',
    apartment_id: 5,
    apartment_code: 'B1/101',
    sink_flow: 1,
    moved_at: '2026-11-05T10:00:00Z',
    owner_apartment_id: null,
    owner_code: null,
    ...partial,
  }
}

const DAYS = ['2026-11-04', '2026-11-05', '2026-11-06']

describe('days', () => {
  it('cairoDay uses the Africa/Cairo calendar day', () => {
    expect(cairoDay('2026-11-06T22:30:00Z')).toBe('2026-11-07')
    expect(cairoDay('2026-11-06T21:30:00Z')).toBe('2026-11-06')
  })

  it('cairoDay returns null for an invalid date', () => {
    expect(cairoDay('not-a-date')).toBeNull()
  })

  it('shiftDay crosses month boundaries', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01')
  })

  it('lastDays lists days oldest first, ending today', () => {
    expect(lastDays('2026-11-07', 3)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07'])
    expect(lastDays('2026-11-07', 1)).toEqual(['2026-11-07'])
  })
})

describe('summarizeExpense', () => {
  it('sums qty * unit_cost per day, category and apartment', () => {
    const s = summarizeExpense([
      move({ id: 1, qty: 2, unit_cost: 10 }),
      move({ id: 2, qty: 1, unit_cost: 5, category: 'Dishes', apartment_id: 6, apartment_code: 'B1/102', moved_at: '2026-11-06T09:00:00Z' }),
    ], DAYS)
    expect(s.total).toBe(25)
    expect(s.partial).toBe(false)
    expect(s.days.map((d) => d.value)).toEqual([0, 20, 5])
    expect(s.categories.map((b) => [b.label, b.value])).toEqual([['Linen', 20], ['Dishes', 5]])
    expect(s.apartments.map((b) => [b.label, b.id, b.value])).toEqual([['B1/101', 5, 20], ['B1/102', 6, 5]])
  })

  it('subtracts returns from the sink (sink_flow -1)', () => {
    const s = summarizeExpense([move({ qty: 5, unit_cost: 10 }), move({ id: 2, qty: 2, unit_cost: 10, sink_flow: -1 })], DAYS)
    expect(s.total).toBe(30)
  })

  it('ignores non-expense moves, owner moves and days outside the window', () => {
    const s = summarizeExpense([
      move({ id: 1, sink_flow: 0 }),
      move({ id: 2, owner_apartment_id: 9, owner_code: 'B2/1' }),
      move({ id: 3, moved_at: '2026-10-01T10:00:00Z' }),
    ], DAYS)
    expect(s.total).toBe(0)
    expect(s.categories).toEqual([])
    expect(s.apartments).toEqual([])
  })

  it('marks moves without a purchase price as partial and counts them', () => {
    const s = summarizeExpense([move({ id: 1, unit_cost: null }), move({ id: 2, unit_cost: 4, qty: 1 })], DAYS)
    expect(s.partial).toBe(true)
    expect(s.unpricedMoves).toBe(1)
    expect(s.total).toBe(4)
    expect(s.days[1].partial).toBe(true)
    expect(s.categories[0].partial).toBe(true)
  })

  it('keeps an unpriced-only bucket with value 0 but drops a fully netted-out one', () => {
    const s = summarizeExpense([
      move({ id: 1, category: 'Unpriced', unit_cost: null }),
      move({ id: 2, category: 'Netted', qty: 2, unit_cost: 10 }),
      move({ id: 3, category: 'Netted', qty: 2, unit_cost: 10, sink_flow: -1 }),
    ], DAYS)
    expect(s.categories.map((b) => b.label)).toEqual(['Unpriced'])
  })

  it('groups moves without an apartment under a null id', () => {
    const s = summarizeExpense([move({ apartment_id: null, apartment_code: null })], DAYS)
    expect(s.apartments).toHaveLength(1)
    expect(s.apartments[0].id).toBeNull()
    expect(s.apartments[0].label).toBe('')
  })

  it('uses the Cairo day for bucketing near midnight', () => {
    const s = summarizeExpense([move({ moved_at: '2026-11-05T22:30:00Z' })], DAYS)
    expect(s.days.map((d) => d.value)).toEqual([0, 0, 20])
  })
})

describe('topBuckets', () => {
  const mk = (n: number): Bucket[] =>
    Array.from({ length: n }, (_, i) => ({ key: `k${i}`, id: null, label: `L${i}`, value: 10 - i, partial: i === 4 }))

  it('returns the list unchanged when it fits', () => {
    expect(topBuckets(mk(3), 3)).toHaveLength(3)
  })

  it('folds the remainder into one "other" bucket', () => {
    const out = topBuckets(mk(6), 3)
    expect(out).toHaveLength(4)
    const other = out[3]
    expect(other.other).toBe(true)
    expect(other.value).toBe(7 + 6 + 5)
    expect(other.partial).toBe(true)
  })
})

describe('incidentsByDay', () => {
  it('counts incidents per day and status', () => {
    const rows = incidentsByDay([
      { created_at: '2026-11-05T10:00:00Z', status: 'new' },
      { created_at: '2026-11-05T11:00:00Z', status: 'confirmed' },
      { created_at: '2026-11-06T09:00:00Z', status: 'new' },
    ], DAYS)
    expect(rows.map((r) => r.total)).toEqual([0, 2, 1])
    expect(rows[1].counts).toEqual({ new: 1, in_progress: 0, confirmed: 1, rejected: 0 })
  })

  it('ignores incidents outside the window and with invalid dates', () => {
    const rows = incidentsByDay([
      { created_at: '2026-10-01T10:00:00Z', status: 'new' },
      { created_at: 'garbage', status: 'new' },
    ], DAYS)
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(0)
  })
})
