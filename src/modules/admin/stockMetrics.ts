import type { WarehouseValuationRow } from '@/lib/database.types'

export interface StockSummary {
  positions: number
  totalStockValue: number
  totalPotentialRevenue: number
  weightedMarkupPct: number | null
  weightedMarginPct: number | null
}

export function summarize(rows: WarehouseValuationRow[]): StockSummary {
  const positions = rows.length
  const totalStockValue = rows.reduce((sum, r) => sum + (r.stock_value ?? 0), 0)
  const totalPotentialRevenue = rows.reduce((sum, r) => sum + (r.potential_revenue ?? 0), 0)

  const valid = rows.filter((r) => r.on_hand > 0 && r.avg_cost != null && r.avg_cost > 0 && r.guest_price != null && r.guest_price > 0)
  if (valid.length === 0) {
    return { positions, totalStockValue, totalPotentialRevenue, weightedMarkupPct: null, weightedMarginPct: null }
  }

  let costSum = 0
  let revenueSum = 0
  for (const r of valid) {
    const w = r.on_hand
    costSum += (r.avg_cost as number) * w
    revenueSum += (r.guest_price as number) * w
  }
  const numerator = revenueSum - costSum
  const weightedMarkupPct = costSum > 0 ? (numerator / costSum) * 100 : null
  const weightedMarginPct = revenueSum > 0 ? (numerator / revenueSum) * 100 : null

  return { positions, totalStockValue, totalPotentialRevenue, weightedMarkupPct, weightedMarginPct }
}

export interface FilterOptions {
  search?: string
  belowMinOnly?: boolean
  noGuestPriceOnly?: boolean
  namePredicate?: (row: WarehouseValuationRow) => boolean
}

export function filterRows(rows: WarehouseValuationRow[], opts: FilterOptions): WarehouseValuationRow[] {
  const search = opts.search?.trim().toLowerCase()
  return rows.filter((r) => {
    if (opts.belowMinOnly) {
      if (r.min_stock == null || r.on_hand >= r.min_stock) return false
    }
    if (opts.noGuestPriceOnly) {
      if (r.guest_price != null && r.guest_price > 0) return false
    }
    if (search) {
      if (opts.namePredicate) {
        if (!opts.namePredicate(r)) return false
      } else {
        if (!String(r.item_id).includes(search)) return false
      }
    } else if (opts.namePredicate) {
      if (!opts.namePredicate(r)) return false
    }
    return true
  })
}

export function formatPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(1)}%`
}
