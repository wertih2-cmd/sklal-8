import { describe, it, expect } from 'vitest'
import { summarize, filterRows, formatPct } from './stockMetrics'
import type { WarehouseValuationRow } from '@/lib/database.types'

function row(overrides: Partial<WarehouseValuationRow> = {}): WarehouseValuationRow {
  return {
    scope: 'company',
    owner_apartment_id: null,
    item_id: 1,
    on_hand: 0,
    min_stock: null,
    avg_cost: null,
    guest_price: null,
    stock_value: null,
    potential_revenue: null,
    markup_pct: null,
    margin_pct: null,
    ...overrides,
  }
}

describe('summarize', () => {
  it('returns zeros and null weighted metrics for empty array', () => {
    const s = summarize([])
    expect(s).toEqual({ positions: 0, totalStockValue: 0, totalPotentialRevenue: 0, weightedMarkupPct: null, weightedMarginPct: null })
  })

  it('returns null weighted metrics when all prices are null', () => {
    const s = summarize([row({ item_id: 1, stock_value: 100, potential_revenue: 200 })])
    expect(s.positions).toBe(1)
    expect(s.totalStockValue).toBe(100)
    expect(s.totalPotentialRevenue).toBe(200)
    expect(s.weightedMarkupPct).toBeNull()
    expect(s.weightedMarginPct).toBeNull()
  })

  it('returns null weighted metrics when on_hand is 0 even if prices set', () => {
    const s = summarize([row({ item_id: 1, on_hand: 0, avg_cost: 10, guest_price: 20 })])
    expect(s.weightedMarkupPct).toBeNull()
    expect(s.weightedMarginPct).toBeNull()
  })

  it('computes weighted markup and margin correctly on 3 rows', () => {
    const rows = [
      row({ item_id: 1, on_hand: 10, avg_cost: 10, guest_price: 15 }),
      row({ item_id: 2, on_hand: 5, avg_cost: 20, guest_price: 30 }),
      row({ item_id: 3, on_hand: 2, avg_cost: 50, guest_price: 80 }),
    ]
    const s = summarize(rows)
    // costSum = 10*10 + 5*20 + 2*50 = 100+100+100 = 300
    // revenueSum = 10*15 + 5*30 + 2*80 = 150+150+160 = 460
    // numerator = 460 - 300 = 160
    // markup = 160/300 * 100 = 53.333...
    // margin = 160/460 * 100 = 34.782...
    expect(s.positions).toBe(3)
    expect(s.weightedMarkupPct).toBeCloseTo(53.333, 1)
    expect(s.weightedMarginPct).toBeCloseTo(34.782, 1)
  })

  it('skips rows with zero or null avg_cost or guest_price in weighting', () => {
    const rows = [
      row({ item_id: 1, on_hand: 10, avg_cost: 10, guest_price: 15 }),
      row({ item_id: 2, on_hand: 5, avg_cost: 0, guest_price: 30 }),
      row({ item_id: 3, on_hand: 2, avg_cost: 50, guest_price: null }),
    ]
    const s = summarize(rows)
    // only row 1 counts: costSum=100, revenueSum=150, num=50
    // markup = 50/100*100 = 50, margin = 50/150*100 = 33.333
    expect(s.weightedMarkupPct).toBeCloseTo(50, 1)
    expect(s.weightedMarginPct).toBeCloseTo(33.333, 1)
  })

  it('sums stock_value and potential_revenue including rows with null prices', () => {
    const rows = [
      row({ item_id: 1, stock_value: 100, potential_revenue: 200 }),
      row({ item_id: 2, stock_value: null, potential_revenue: null }),
      row({ item_id: 3, stock_value: 50, potential_revenue: 75 }),
    ]
    const s = summarize(rows)
    expect(s.totalStockValue).toBe(150)
    expect(s.totalPotentialRevenue).toBe(275)
  })
})

describe('filterRows', () => {
  const rows: WarehouseValuationRow[] = [
    row({ item_id: 1, on_hand: 5, min_stock: 10, guest_price: 20 }),
    row({ item_id: 2, on_hand: 15, min_stock: 10, guest_price: null }),
    row({ item_id: 3, on_hand: 3, min_stock: 5, guest_price: 0 }),
  ]

  it('returns all rows when no filters', () => {
    expect(filterRows(rows, {})).toHaveLength(3)
  })

  it('filters below min only', () => {
    const result = filterRows(rows, { belowMinOnly: true })
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.item_id)).toEqual([1, 3])
  })

  it('filters no guest price only (null or 0)', () => {
    const result = filterRows(rows, { noGuestPriceOnly: true })
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.item_id)).toEqual([2, 3])
  })

  it('filters by item_id search string', () => {
    const result = filterRows(rows, { search: '2' })
    expect(result).toHaveLength(1)
    expect(result[0].item_id).toBe(2)
  })

  it('uses namePredicate when search is empty', () => {
    const result = filterRows(rows, { namePredicate: (r) => r.item_id > 1 })
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.item_id)).toEqual([2, 3])
  })

  it('combines belowMinOnly and noGuestPriceOnly', () => {
    const result = filterRows(rows, { belowMinOnly: true, noGuestPriceOnly: true })
    expect(result).toHaveLength(1)
    expect(result[0].item_id).toBe(3)
  })

  it('does not mutate original array', () => {
    const original = [...rows]
    filterRows(rows, { belowMinOnly: true })
    expect(rows).toEqual(original)
  })
})

describe('formatPct', () => {
  it('formats a positive number with one decimal and %', () => {
    expect(formatPct(53.333)).toBe('53.3%')
  })

  it('formats a negative number', () => {
    expect(formatPct(-10.5)).toBe('-10.5%')
  })

  it('returns dash for null', () => {
    expect(formatPct(null)).toBe('—')
  })

  it('returns dash for NaN', () => {
    expect(formatPct(NaN)).toBe('—')
  })

  it('formats zero', () => {
    expect(formatPct(0)).toBe('0.0%')
  })
})
