import { describe, it, expect } from 'vitest'
import { mergeCompany, mergeOwner } from './stockRows'
import type { WarehouseStockRow, WarehouseValuationRow, OwnerStockRow, ItemKind } from '@/lib/database.types'

function stockRow(overrides: Partial<WarehouseStockRow> = {}): WarehouseStockRow {
  return {
    item_id: 1,
    name: 'Towel',
    category: 'Linen',
    kind: 'asset' as ItemKind,
    base_unit: 'pcs',
    pack_size: 1,
    pack_label: '',
    qty: 10,
    min_stock: 5,
    below_min: false,
    ...overrides,
  }
}

function valRow(overrides: Partial<WarehouseValuationRow> = {}): WarehouseValuationRow {
  return {
    scope: 'company',
    owner_apartment_id: null,
    item_id: 1,
    on_hand: 10,
    min_stock: 5,
    avg_cost: 50,
    guest_price: 80,
    stock_value: 500,
    potential_revenue: 800,
    markup_pct: 60,
    margin_pct: 37.5,
    ...overrides,
  }
}

function ownerRow(overrides: Partial<OwnerStockRow> = {}): OwnerStockRow {
  return {
    apartment_id: 1,
    code: 'A/1',
    item_id: 1,
    name: 'Towel',
    base_unit: 'pcs',
    qty: 5,
    ...overrides,
  }
}

describe('mergeCompany', () => {
  it('merges stock with matching valuation', () => {
    const rows = mergeCompany(
      [stockRow({ item_id: 1 })],
      [valRow({ item_id: 1, avg_cost: 50, guest_price: 80, stock_value: 500 })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].avg_cost).toBe(50)
    expect(rows[0].guest_price).toBe(80)
    expect(rows[0].stock_value).toBe(500)
    expect(rows[0].markup_pct).toBe(60)
  })

  it('returns null price fields when no valuation exists', () => {
    const rows = mergeCompany([stockRow({ item_id: 1 })], [])
    expect(rows[0].avg_cost).toBeNull()
    expect(rows[0].guest_price).toBeNull()
    expect(rows[0].stock_value).toBeNull()
    expect(rows[0].markup_pct).toBeNull()
    expect(rows[0].margin_pct).toBeNull()
  })

  it('ignores owner-scope valuation rows for company scope', () => {
    const rows = mergeCompany(
      [stockRow({ item_id: 1 })],
      [valRow({ scope: 'owner', owner_apartment_id: 5, item_id: 1, avg_cost: 30 })],
    )
    expect(rows[0].avg_cost).toBeNull()
  })

  it('handles empty arrays', () => {
    expect(mergeCompany([], [])).toEqual([])
  })

  it('preserves stock fields', () => {
    const rows = mergeCompany(
      [stockRow({ item_id: 2, name: 'Soap', category: 'Cleaning', qty: 100, min_stock: 20, below_min: true })],
      [valRow({ item_id: 2 })],
    )
    expect(rows[0].name).toBe('Soap')
    expect(rows[0].category).toBe('Cleaning')
    expect(rows[0].qty).toBe(100)
    expect(rows[0].below_min).toBe(true)
  })
})

describe('mergeOwner', () => {
  it('merges owner stock with matching valuation by apartment+item', () => {
    const meta = new Map([[1, { category: 'Linen', kind: 'asset' as ItemKind }]])
    const rows = mergeOwner(
      [ownerRow({ apartment_id: 1, item_id: 1 })],
      [valRow({ scope: 'owner', owner_apartment_id: 1, item_id: 1, avg_cost: 40, guest_price: 70, stock_value: 200 })],
      meta,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].avg_cost).toBe(40)
    expect(rows[0].guest_price).toBe(70)
    expect(rows[0].stock_value).toBe(200)
    expect(rows[0].apartment_id).toBe(1)
    expect(rows[0].code).toBe('A/1')
  })

  it('returns null price fields when no valuation exists', () => {
    const meta = new Map<number, { category: string; kind: ItemKind }>()
    const rows = mergeOwner([ownerRow()], [], meta)
    expect(rows[0].avg_cost).toBeNull()
    expect(rows[0].guest_price).toBeNull()
    expect(rows[0].stock_value).toBeNull()
  })

  it('handles same item in two apartments with separate valuations', () => {
    const meta = new Map([[1, { category: 'Linen', kind: 'asset' as ItemKind }]])
    const rows = mergeOwner(
      [
        ownerRow({ apartment_id: 1, item_id: 1, code: 'A/1' }),
        ownerRow({ apartment_id: 2, item_id: 1, code: 'B/2' }),
      ],
      [
        valRow({ scope: 'owner', owner_apartment_id: 1, item_id: 1, avg_cost: 10, stock_value: 100 }),
        valRow({ scope: 'owner', owner_apartment_id: 2, item_id: 1, avg_cost: 20, stock_value: 200 }),
      ],
      meta,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].avg_cost).toBe(10)
    expect(rows[0].stock_value).toBe(100)
    expect(rows[0].code).toBe('A/1')
    expect(rows[1].avg_cost).toBe(20)
    expect(rows[1].stock_value).toBe(200)
    expect(rows[1].code).toBe('B/2')
  })

  it('handles empty arrays', () => {
    expect(mergeOwner([], [], new Map())).toEqual([])
  })

  it('uses itemMeta for category and kind', () => {
    const meta = new Map([[5, { category: 'Furniture', kind: 'asset' as ItemKind }]])
    const rows = mergeOwner(
      [ownerRow({ item_id: 5, name: 'Chair' })],
      [],
      meta,
    )
    expect(rows[0].category).toBe('Furniture')
    expect(rows[0].kind).toBe('asset')
  })

  it('defaults category and kind when meta is missing', () => {
    const rows = mergeOwner([ownerRow({ item_id: 99 })], [], new Map())
    expect(rows[0].category).toBe('—')
    expect(rows[0].kind).toBe('consumable')
  })
})
