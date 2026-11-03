import type { WarehouseStockRow, WarehouseValuationRow, OwnerStockRow, ItemKind } from '@/lib/database.types'

export interface MergedStockRow {
  item_id: number
  name: string
  category: string
  kind: ItemKind
  base_unit: WarehouseStockRow['base_unit']
  pack_size: number
  pack_label: string
  qty: number
  min_stock: number | null
  below_min: boolean
  avg_cost: number | null
  guest_price: number | null
  markup_pct: number | null
  margin_pct: number | null
  stock_value: number | null
}

export interface MergedOwnerRow extends MergedStockRow {
  apartment_id: number
  code: string
}

export function mergeCompany(stock: WarehouseStockRow[], valuation: WarehouseValuationRow[]): MergedStockRow[] {
  const valMap = new Map<number, WarehouseValuationRow>()
  for (const v of valuation) {
    if (v.scope === 'company') valMap.set(v.item_id, v)
  }
  return stock.map((s) => {
    const v = valMap.get(s.item_id)
    return {
      item_id: s.item_id,
      name: s.name,
      category: s.category,
      kind: s.kind,
      base_unit: s.base_unit,
      pack_size: s.pack_size,
      pack_label: s.pack_label,
      qty: s.qty,
      min_stock: s.min_stock,
      below_min: s.below_min,
      avg_cost: v?.avg_cost ?? null,
      guest_price: v?.guest_price ?? null,
      markup_pct: v?.markup_pct ?? null,
      margin_pct: v?.margin_pct ?? null,
      stock_value: v?.stock_value ?? null,
    }
  })
}

export function mergeOwner(
  ownerStock: OwnerStockRow[],
  valuation: WarehouseValuationRow[],
  itemMeta: Map<number, { category: string; kind: ItemKind }>,
): MergedOwnerRow[] {
  const valMap = new Map<string, WarehouseValuationRow>()
  for (const v of valuation) {
    if (v.scope === 'owner' && v.owner_apartment_id != null) {
      valMap.set(`${v.owner_apartment_id}:${v.item_id}`, v)
    }
  }
  return ownerStock.map((s) => {
    const v = valMap.get(`${s.apartment_id}:${s.item_id}`)
    const meta = itemMeta.get(s.item_id)
    return {
      item_id: s.item_id,
      name: s.name,
      category: meta?.category ?? '—',
      kind: meta?.kind ?? 'consumable',
      base_unit: s.base_unit,
      pack_size: 1,
      pack_label: '',
      qty: s.qty,
      min_stock: null,
      below_min: false,
      avg_cost: v?.avg_cost ?? null,
      guest_price: v?.guest_price ?? null,
      markup_pct: v?.markup_pct ?? null,
      margin_pct: v?.margin_pct ?? null,
      stock_value: v?.stock_value ?? null,
      apartment_id: s.apartment_id,
      code: s.code,
    }
  })
}
