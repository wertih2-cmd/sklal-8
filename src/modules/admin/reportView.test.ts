import { describe, it, expect } from 'vitest'
import type { WarehouseValuationRow, StockTurnoverRow } from '@/lib/database.types'
import {
  joinValuation, filterValuation, valuationTotals, isBelowMin, hasNoGuestPrice,
  filterTurnover, turnoverTotals, hasTurnover, inclusiveEnd,
} from './reportView'

const val = (p: Partial<WarehouseValuationRow>): WarehouseValuationRow => ({
  scope: 'company', owner_apartment_id: null, item_id: 1, on_hand: 0, min_stock: null, avg_cost: null,
  guest_price: null, stock_value: null, potential_revenue: null, markup_pct: null, margin_pct: null, ...p,
})
const tov = (p: Partial<StockTurnoverRow>): StockTurnoverRow => ({
  item_id: 1, item_name: 'A', category: 'C', in_qty: 0, out_qty: 0, transfer_in_qty: 0, transfer_out_qty: 0,
  in_value: 0, out_value: 0, transfer_in_value: 0, transfer_out_value: 0, ...p,
})
const all = () => true

describe('joinValuation', () => {
  it('adds name and category, falls back to id', () => {
    const rows = joinValuation([val({ item_id: 1 }), val({ item_id: 2 })], new Map([[1, { name: 'Kettle', category: 'Kitchen' }]]))
    expect(rows[0]).toMatchObject({ name: 'Kettle', category: 'Kitchen' })
    expect(rows[1]).toMatchObject({ name: '#2', category: '' })
  })
})

describe('valuation predicates', () => {
  it('isBelowMin is strict and ignores missing minimum', () => {
    expect(isBelowMin({ on_hand: 1, min_stock: 2 })).toBe(true)
    expect(isBelowMin({ on_hand: 2, min_stock: 2 })).toBe(false)
    expect(isBelowMin({ on_hand: 0, min_stock: null })).toBe(false)
  })
  it('hasNoGuestPrice treats null and zero as not set', () => {
    expect(hasNoGuestPrice({ guest_price: null })).toBe(true)
    expect(hasNoGuestPrice({ guest_price: 0 })).toBe(true)
    expect(hasNoGuestPrice({ guest_price: 10 })).toBe(false)
  })
})

describe('filterValuation', () => {
  const rows = joinValuation(
    [
      val({ item_id: 1, on_hand: 0, min_stock: 2 }),
      val({ item_id: 2, on_hand: 5, guest_price: 0 }),
      val({ item_id: 3, on_hand: 5, guest_price: 9 }),
    ],
    new Map([[1, { name: 'A', category: 'X' }], [2, { name: 'B', category: 'X' }], [3, { name: 'C', category: 'Y' }]]),
  )
  it('filters by mode', () => {
    expect(filterValuation(rows, 'all', all)).toHaveLength(3)
    expect(filterValuation(rows, 'below_min', all).map((r) => r.item_id)).toEqual([1])
    expect(filterValuation(rows, 'with_stock', all).map((r) => r.item_id)).toEqual([2, 3])
    expect(filterValuation(rows, 'no_price', all).map((r) => r.item_id)).toEqual([2])
  })
  it('applies the search predicate on name and category', () => {
    expect(filterValuation(rows, 'all', (n, c) => c === 'Y').map((r) => r.item_id)).toEqual([3])
    expect(filterValuation(rows, 'all', (n) => n === 'A').map((r) => r.item_id)).toEqual([1])
  })
})

describe('valuationTotals', () => {
  it('sums values and counts uncosted stocked rows', () => {
    const t = valuationTotals([
      val({ on_hand: 2, avg_cost: 10, stock_value: 20, potential_revenue: 30 }),
      val({ on_hand: 3, avg_cost: null, stock_value: null, potential_revenue: 15 }),
      val({ on_hand: 0, avg_cost: null }),
    ])
    expect(t).toEqual({ count: 3, stockValue: 20, potentialRevenue: 45, uncosted: 1 })
  })
  it('handles empty input', () => {
    expect(valuationTotals([])).toEqual({ count: 0, stockValue: 0, potentialRevenue: 0, uncosted: 0 })
  })
})

describe('turnover helpers', () => {
  const rows = [tov({ item_id: 1, in_qty: 2, in_value: 10 }), tov({ item_id: 2 }), tov({ item_id: 3, item_name: 'Z', transfer_out_qty: 1, transfer_out_value: 7 })]
  it('hasTurnover detects any movement', () => {
    expect(hasTurnover(rows[0])).toBe(true)
    expect(hasTurnover(rows[1])).toBe(false)
  })
  it('filterTurnover hides rows without movement and applies search', () => {
    expect(filterTurnover(rows, true, all).map((r) => r.item_id)).toEqual([1, 3])
    expect(filterTurnover(rows, false, all)).toHaveLength(3)
    expect(filterTurnover(rows, false, (n) => n === 'Z').map((r) => r.item_id)).toEqual([3])
  })
  it('turnoverTotals sums values', () => {
    expect(turnoverTotals(rows)).toEqual({ inValue: 10, outValue: 0, transferInValue: 0, transferOutValue: 7 })
  })
})

describe('inclusiveEnd', () => {
  it('shifts back one day, across month and year', () => {
    expect(inclusiveEnd('2026-11-05')).toBe('2026-11-04')
    expect(inclusiveEnd('2026-12-01')).toBe('2026-11-30')
    expect(inclusiveEnd('2027-01-01')).toBe('2026-12-31')
  })
})
