import type { WarehouseValuationRow, StockTurnoverRow } from '@/lib/database.types'

export interface ItemInfo {
  name: string
  category: string
}

export interface ValuationView extends WarehouseValuationRow {
  name: string
  category: string
}

export type ValuationFilter = 'all' | 'below_min' | 'with_stock' | 'no_price'

export function joinValuation(rows: WarehouseValuationRow[], info: Map<number, ItemInfo>): ValuationView[] {
  return rows.map((r) => {
    const i = info.get(r.item_id)
    return { ...r, name: i?.name ?? `#${r.item_id}`, category: i?.category ?? '' }
  })
}

export function isBelowMin(r: Pick<WarehouseValuationRow, 'on_hand' | 'min_stock'>): boolean {
  return r.min_stock != null && r.on_hand < r.min_stock
}

export function hasNoGuestPrice(r: Pick<WarehouseValuationRow, 'guest_price'>): boolean {
  return r.guest_price == null || r.guest_price === 0
}

export function filterValuation(
  rows: ValuationView[],
  filter: ValuationFilter,
  matchesQuery: (name: string, category: string) => boolean,
): ValuationView[] {
  return rows.filter((r) => {
    if (!matchesQuery(r.name, r.category)) return false
    switch (filter) {
      case 'below_min': return isBelowMin(r)
      case 'with_stock': return r.on_hand > 0
      case 'no_price': return r.on_hand > 0 && hasNoGuestPrice(r)
      default: return true
    }
  })
}

export interface ValuationTotals {
  count: number
  stockValue: number
  potentialRevenue: number
  uncosted: number
}

export function valuationTotals(rows: WarehouseValuationRow[]): ValuationTotals {
  let stockValue = 0
  let potentialRevenue = 0
  let uncosted = 0
  for (const r of rows) {
    stockValue += r.stock_value ?? 0
    potentialRevenue += r.potential_revenue ?? 0
    if (r.on_hand > 0 && r.avg_cost == null) uncosted += 1
  }
  return { count: rows.length, stockValue, potentialRevenue, uncosted }
}

export function hasTurnover(r: StockTurnoverRow): boolean {
  return r.in_qty !== 0 || r.out_qty !== 0 || r.transfer_in_qty !== 0 || r.transfer_out_qty !== 0
}

export function filterTurnover(
  rows: StockTurnoverRow[],
  onlyMovement: boolean,
  matchesQuery: (name: string, category: string) => boolean,
): StockTurnoverRow[] {
  return rows.filter((r) => (!onlyMovement || hasTurnover(r)) && matchesQuery(r.item_name, r.category))
}

export interface TurnoverTotals {
  inValue: number
  outValue: number
  transferInValue: number
  transferOutValue: number
}

export function turnoverTotals(rows: StockTurnoverRow[]): TurnoverTotals {
  const t: TurnoverTotals = { inValue: 0, outValue: 0, transferInValue: 0, transferOutValue: 0 }
  for (const r of rows) {
    t.inValue += r.in_value
    t.outValue += r.out_value
    t.transferInValue += r.transfer_in_value
    t.transferOutValue += r.transfer_out_value
  }
  return t
}

/** Включительный конец периода: для диапазона с исключающей правой границей. */
export function inclusiveEnd(exclusiveEnd: string): string {
  const d = new Date(`${exclusiveEnd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
