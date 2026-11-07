import { describe, it, expect } from 'vitest'
import {
  searchRows, expenseFields, stockFields, moveFields, chargeFields, SEARCH_TABS, type SearchContext,
} from './reportSearch'
import type { ExpenseRow } from './reportRules'

const NAMES: Record<string, string[]> = {
  Kettle: ['kettle', 'чайник', 'غلاية'],
  Towel: ['towel', 'полотенце', 'منشفة'],
  Linen: ['linen', 'текстиль', 'مفروشات'],
}

const ctx: SearchContext = {
  itemMatches: (token, base) => (NAMES[base] ?? [base.toLowerCase()]).some((n) => n.includes(token)),
  categoryMatches: (token, base) => (NAMES[base] ?? [base.toLowerCase()]).some((n) => n.includes(token)),
}

function expense(partial: Partial<ExpenseRow>): ExpenseRow {
  return {
    apartment: 'B1/101', item: 'Kettle', category: 'Appliances', qtyPacks: 1, cost: 10,
    partial: false, isOwner: false, ownerCode: null, ...partial,
  }
}

describe('searchRows', () => {
  const rows = [
    expense({ apartment: 'B1/101', item: 'Kettle', category: 'Appliances' }),
    expense({ apartment: 'B2/202', item: 'Towel', category: 'Linen' }),
    expense({ apartment: 'B2/203', item: 'Towel', category: 'Linen', isOwner: true, ownerCode: 'A18/202' }),
  ]

  it('returns the same list for an empty or blank query', () => {
    expect(searchRows(rows, '', ctx, expenseFields)).toBe(rows)
    expect(searchRows(rows, '   ', ctx, expenseFields)).toBe(rows)
  })

  it('matches the apartment code, case-insensitively', () => {
    expect(searchRows(rows, 'b2/', ctx, expenseFields)).toHaveLength(2)
    expect(searchRows(rows, 'B1/101', ctx, expenseFields)).toHaveLength(1)
  })

  it('matches item and category names in any language through the context', () => {
    expect(searchRows(rows, 'чайник', ctx, expenseFields)).toHaveLength(1)
    expect(searchRows(rows, 'منشفة', ctx, expenseFields)).toHaveLength(2)
    expect(searchRows(rows, 'текстиль', ctx, expenseFields)).toHaveLength(2)
  })

  it('matches the owner code', () => {
    expect(searchRows(rows, 'a18', ctx, expenseFields)).toHaveLength(1)
  })

  it('requires every token to match (AND)', () => {
    expect(searchRows(rows, 'b2 towel', ctx, expenseFields)).toHaveLength(2)
    expect(searchRows(rows, 'b1 towel', ctx, expenseFields)).toHaveLength(0)
  })

  it('does not apply item matching to apartment-only text', () => {
    // "linen" must not match an apartment code or an item name; only the category
    expect(searchRows(rows, 'linen', ctx, expenseFields)).toHaveLength(2)
    expect(searchRows(rows, 'kettle linen', ctx, expenseFields)).toHaveLength(0)
  })
})

describe('field builders', () => {
  it('stock rows search item and category', () => {
    const stock = [{ name: 'Kettle', category: 'Appliances' }, { name: 'Towel', category: 'Linen' }]
    expect(searchRows(stock, 'kettle', ctx, stockFields)).toHaveLength(1)
    expect(searchRows(stock, 'linen', ctx, stockFields)).toHaveLength(1)
  })

  it('move rows search apartment, source and null-safe fields', () => {
    const moves = [
      { item_name: 'Kettle', category: 'Appliances', apartment_code: null, source_type: 'manual', owner_code: null },
      { item_name: 'Towel', category: 'Linen', apartment_code: 'B2/202', source_type: 'cleaning', owner_code: null },
    ]
    expect(searchRows(moves, 'cleaning', ctx, moveFields)).toHaveLength(1)
    expect(searchRows(moves, 'b2', ctx, moveFields)).toHaveLength(1)
    expect(searchRows(moves, 'manual', ctx, moveFields)).toHaveLength(1)
  })

  it('charge rows search apartment, item, tenant note and kind', () => {
    const charges = [
      { apartment_code: 'B1/101', item_name: 'Kettle', tenant_note: 'Ahmed', kind: 'broken', owner_code: null },
      { apartment_code: 'B2/202', item_name: 'Towel', tenant_note: null, kind: 'lost', owner_code: null },
    ]
    expect(searchRows(charges, 'ahmed', ctx, chargeFields)).toHaveLength(1)
    expect(searchRows(charges, 'lost', ctx, chargeFields)).toHaveLength(1)
    expect(searchRows(charges, 'towel', ctx, chargeFields)).toHaveLength(1)
  })
})

describe('SEARCH_TABS', () => {
  it('lists the four table tabs', () => {
    expect(SEARCH_TABS).toEqual(['expense', 'stock', 'moves', 'charges'])
  })
})
