import { describe, it, expect } from 'vitest'
import {
  groupBySupplier, purchaseTotals, buildDeficit, deficitTotals, purchaseDocFields, deficitFields,
  type PurchaseDoc,
} from './purchaseReport'
import type { ToOrderRow } from '@/lib/database.types'

function doc(partial: Partial<PurchaseDoc>): PurchaseDoc {
  return { id: 'd1', number: 'R-1', doc_date: '2026-11-05', supplier_id: 1, total_cost: 100, note: null, ...partial }
}

describe('groupBySupplier', () => {
  it('sums receipts per supplier, biggest first', () => {
    const groups = groupBySupplier([
      doc({ id: 'a', supplier_id: 1, total_cost: 100 }),
      doc({ id: 'b', supplier_id: 2, total_cost: 300 }),
      doc({ id: 'c', supplier_id: 1, total_cost: 50 }),
    ])
    expect(groups.map((g) => [g.supplierId, g.total, g.docs.length])).toEqual([[2, 300, 1], [1, 150, 2]])
  })

  it('puts receipts without a supplier last, even when they are the biggest', () => {
    const groups = groupBySupplier([
      doc({ id: 'a', supplier_id: null, total_cost: 999 }),
      doc({ id: 'b', supplier_id: 5, total_cost: 1 }),
    ])
    expect(groups.map((g) => g.supplierId)).toEqual([5, null])
  })

  it('counts receipts without a total instead of treating them as zero spend', () => {
    const [g] = groupBySupplier([doc({ total_cost: null }), doc({ id: 'b', total_cost: 20 })])
    expect(g.total).toBe(20)
    expect(g.unpriced).toBe(1)
    expect(g.docs).toHaveLength(2)
  })

  it('lists the documents of a supplier newest first', () => {
    const [g] = groupBySupplier([
      doc({ id: 'a', number: 'R-1', doc_date: '2026-11-01' }),
      doc({ id: 'b', number: 'R-2', doc_date: '2026-11-06' }),
      doc({ id: 'c', number: 'R-3', doc_date: '2026-11-06' }),
    ])
    expect(g.docs.map((d) => d.number)).toEqual(['R-3', 'R-2', 'R-1'])
  })
})

describe('purchaseTotals', () => {
  it('adds up all groups', () => {
    const t = purchaseTotals(groupBySupplier([doc({}), doc({ id: 'b', supplier_id: 2, total_cost: null })]))
    expect(t).toEqual({ total: 100, docs: 2, unpriced: 1 })
  })

  it('is zero for no receipts', () => {
    expect(purchaseTotals([])).toEqual({ total: 0, docs: 0, unpriced: 0 })
  })
})

function toOrder(partial: Partial<ToOrderRow>): ToOrderRow {
  return {
    item_id: 1, name: 'Detergent', category: 'Cleaning', base_unit: 'pcs', pack_size: 6, pack_label: 'box',
    qty: 4, min_stock: 10, shortage: 6, ...partial,
  } as ToOrderRow
}

describe('buildDeficit', () => {
  const none = new Map<number, number | null>()

  it('orders up to the minimum, rounded up to whole packs', () => {
    const [r] = buildDeficit([toOrder({})], none, new Map([[1, 2]]), none)
    expect(r.target).toBe(10)
    expect(r.orderPacks).toBe(1)
    expect(r.orderQty).toBe(6)
    expect(r.estCost).toBe(12)
  })

  it('rounds a partial pack up', () => {
    const [r] = buildDeficit([toOrder({ qty: 0, min_stock: 10, shortage: 10 })], none, none, none)
    expect(r.orderPacks).toBe(2)
    expect(r.orderQty).toBe(12)
  })

  it('refills to the target stock when it is above the minimum', () => {
    const [r] = buildDeficit([toOrder({ qty: 4 })], new Map([[1, 28]]), none, none)
    expect(r.target).toBe(28)
    expect(r.orderPacks).toBe(4)
  })

  it('ignores a target below the minimum', () => {
    const [r] = buildDeficit([toOrder({ qty: 4 })], new Map([[1, 5]]), none, none)
    expect(r.target).toBe(10)
  })

  it('leaves the cost unknown without an average purchase price', () => {
    const [r] = buildDeficit([toOrder({})], none, new Map([[1, null]]), none)
    expect(r.avgCost).toBeNull()
    expect(r.estCost).toBeNull()
  })

  it('does not lose exact pack multiples to rounding noise', () => {
    const [r] = buildDeficit([toOrder({ qty: 4, min_stock: 10, pack_size: 3 })], new Map([[1, 10.000000001]]), none, none)
    expect(r.orderPacks).toBe(2)
  })

  it('treats a missing pack size as 1', () => {
    const [r] = buildDeficit([toOrder({ pack_size: 0, qty: 4, min_stock: 10 })], none, none, none)
    expect(r.packSize).toBe(1)
    expect(r.orderQty).toBe(6)
  })

  it('carries the supplier of the item', () => {
    const [r] = buildDeficit([toOrder({})], none, none, new Map([[1, 7]]))
    expect(r.supplierId).toBe(7)
  })
})

describe('deficitTotals', () => {
  it('sums known costs and counts rows without a price', () => {
    const rows = buildDeficit(
      [toOrder({ item_id: 1 }), toOrder({ item_id: 2 })],
      new Map(), new Map([[1, 2]]), new Map(),
    )
    expect(deficitTotals(rows)).toEqual({ count: 2, estTotal: 12, uncosted: 1 })
  })
})

describe('search fields', () => {
  it('document fields expose number, supplier name, note and date', () => {
    const fields = purchaseDocFields(doc({ note: 'Order 5' }), 'ACME')
    expect(fields.map((f) => f.text)).toEqual(['R-1', 'ACME', 'Order 5', '2026-11-05'])
  })

  it('deficit fields mark item and category for catalog matching', () => {
    const [row] = buildDeficit([toOrder({})], new Map(), new Map(), new Map())
    const fields = deficitFields(row, null)
    expect(fields[0]).toEqual({ text: 'Detergent', kind: 'item' })
    expect(fields[1]).toEqual({ text: 'Cleaning', kind: 'category' })
  })
})
