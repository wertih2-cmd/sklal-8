import type { ToOrderRow } from '@/lib/database.types'
import type { SearchField } from '@/modules/admin/reportSearch'

/** A posted receipt document (an incoming delivery). */
export interface PurchaseDoc {
  id: string
  number: string
  doc_date: string
  supplier_id: number | null
  /** total at posting time; null when no line had a purchase price */
  total_cost: number | null
  note: string | null
}

export interface SupplierGroup {
  key: string
  supplierId: number | null
  total: number
  /** documents without a total: their value is unknown, not zero */
  unpriced: number
  docs: PurchaseDoc[]
}

/** Receipts grouped by supplier: biggest spend first, "no supplier" last. */
export function groupBySupplier(docs: PurchaseDoc[]): SupplierGroup[] {
  const map = new Map<string, SupplierGroup>()
  for (const doc of docs) {
    const key = doc.supplier_id == null ? 'none' : String(doc.supplier_id)
    const group = map.get(key) ?? { key, supplierId: doc.supplier_id, total: 0, unpriced: 0, docs: [] }
    if (doc.total_cost == null) group.unpriced++
    else group.total += doc.total_cost
    group.docs.push(doc)
    map.set(key, group)
  }
  const groups = Array.from(map.values())
  for (const g of groups) {
    g.docs.sort((a, b) => b.doc_date.localeCompare(a.doc_date) || b.number.localeCompare(a.number))
  }
  return groups.sort((a, b) => {
    if ((a.supplierId == null) !== (b.supplierId == null)) return a.supplierId == null ? 1 : -1
    return b.total - a.total || (a.supplierId ?? 0) - (b.supplierId ?? 0)
  })
}

export interface PurchaseTotals {
  total: number
  docs: number
  unpriced: number
}

export function purchaseTotals(groups: SupplierGroup[]): PurchaseTotals {
  return groups.reduce<PurchaseTotals>(
    (sum, g) => ({ total: sum.total + g.total, docs: sum.docs + g.docs.length, unpriced: sum.unpriced + g.unpriced }),
    { total: 0, docs: 0, unpriced: 0 },
  )
}

export const purchaseDocFields = (doc: PurchaseDoc, supplierName: string | null): SearchField[] => [
  { text: doc.number },
  { text: supplierName },
  { text: doc.note },
  { text: doc.doc_date },
]

export interface DeficitRow {
  itemId: number
  name: string
  category: string
  baseUnit: ToOrderRow['base_unit']
  packSize: number
  packLabel: string
  onHand: number
  minStock: number
  /** the level an order refills to: the target stock if it is set and not below the minimum, else the minimum */
  target: number
  shortage: number
  orderPacks: number
  /** order quantity in base units, a whole number of packs */
  orderQty: number
  avgCost: number | null
  estCost: number | null
  supplierId: number | null
}

/**
 * Items below their minimum with the quantity to order, computed like the order generator:
 * refill to max(target, minimum), rounded up to whole packs. Cost uses the average purchase price per base unit.
 */
export function buildDeficit(
  rows: ToOrderRow[],
  targets: ReadonlyMap<number, number | null>,
  avgCosts: ReadonlyMap<number, number | null>,
  suppliers: ReadonlyMap<number, number | null>,
): DeficitRow[] {
  return rows.map((row) => {
    const minStock = Number(row.min_stock)
    const onHand = Number(row.qty)
    const packSize = Number(row.pack_size) || 1
    const target = Math.max(targets.get(row.item_id) ?? minStock, minStock)
    const orderPacks = Math.max(0, Math.ceil((target - onHand) / packSize - 1e-9))
    const orderQty = orderPacks * packSize
    const avgCost = avgCosts.get(row.item_id) ?? null
    return {
      itemId: row.item_id,
      name: row.name,
      category: row.category,
      baseUnit: row.base_unit,
      packSize,
      packLabel: row.pack_label,
      onHand,
      minStock,
      target,
      shortage: Number(row.shortage),
      orderPacks,
      orderQty,
      avgCost,
      estCost: avgCost == null ? null : orderQty * avgCost,
      supplierId: suppliers.get(row.item_id) ?? null,
    }
  })
}

export interface DeficitTotals {
  count: number
  estTotal: number
  /** rows whose cost is unknown because the item has no average purchase price */
  uncosted: number
}

export function deficitTotals(rows: DeficitRow[]): DeficitTotals {
  return rows.reduce<DeficitTotals>(
    (sum, r) => ({
      count: sum.count + 1,
      estTotal: sum.estTotal + (r.estCost ?? 0),
      uncosted: sum.uncosted + (r.estCost == null ? 1 : 0),
    }),
    { count: 0, estTotal: 0, uncosted: 0 },
  )
}

export const deficitFields = (row: DeficitRow, supplierName: string | null): SearchField[] => [
  { text: row.name, kind: 'item' },
  { text: row.category, kind: 'category' },
  { text: supplierName },
]
