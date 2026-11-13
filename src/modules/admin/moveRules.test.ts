import { describe, it, expect } from 'vitest'
import { lineSource, isTransferBlocked, ownerAvailable, buildOwnerStockMap, transferOwnerFlags, isFromApartmentOp, buildBalanceMap, rowsInLocation } from './moveRules'
import type { OwnerStockRow } from '@/lib/database.types'

describe('lineSource', () => {
  it('returns "owner" for asset issued to owner apartment', () => {
    expect(lineSource('issue_apartment', true, 'asset')).toBe('owner')
  })

  it('returns "owner" for asset returned from owner apartment', () => {
    expect(lineSource('return_apartment', true, 'asset')).toBe('owner')
  })

  it('returns "company" for consumable in owner apartment', () => {
    expect(lineSource('issue_apartment', true, 'consumable')).toBe('company')
  })

  it('returns "company" for asset in regular apartment', () => {
    expect(lineSource('issue_apartment', false, 'asset')).toBe('company')
  })

  it('returns null for receipt (no stock source)', () => {
    expect(lineSource('receipt', false, 'asset')).toBe(null)
  })

  it('returns null for writeoff_warehouse (source determined by owner mode, not operation alone)', () => {
    expect(lineSource('writeoff_warehouse', false, 'asset')).toBe(null)
  })
})

describe('isTransferBlocked', () => {
  it('blocks asset transfer from owner apartment', () => {
    expect(isTransferBlocked('asset', true, false)).toBe(true)
  })

  it('blocks asset transfer to owner apartment', () => {
    expect(isTransferBlocked('asset', false, true)).toBe(true)
  })

  it('does not block asset transfer between regular apartments', () => {
    expect(isTransferBlocked('asset', false, false)).toBe(false)
  })

  it('does not block consumable transfer even from owner apartment', () => {
    expect(isTransferBlocked('consumable', true, false)).toBe(false)
  })

  it('does not block consumable transfer to owner apartment', () => {
    expect(isTransferBlocked('consumable', false, true)).toBe(false)
  })
})

describe('ownerAvailable', () => {
  const map = new Map<string, number>([
    ['1:10', 5],
    ['1:20', 0],
    ['2:10', 3],
  ])

  it('returns balance when apartment+item exists', () => {
    expect(ownerAvailable(map, 1, 10)).toBe(5)
  })

  it('returns 0 when balance is explicitly 0', () => {
    expect(ownerAvailable(map, 1, 20)).toBe(0)
  })

  it('returns 0 when apartment+item not found', () => {
    expect(ownerAvailable(map, 99, 99)).toBe(0)
  })

  it('returns 0 for empty map', () => {
    expect(ownerAvailable(new Map(), 1, 1)).toBe(0)
  })
})

describe('buildOwnerStockMap', () => {
  it('builds map keyed by apartmentId:itemId', () => {
    const rows: OwnerStockRow[] = [
      { apartment_id: 1, code: 'A/1', item_id: 10, name: 'Chair', base_unit: 'pcs', qty: 5 },
      { apartment_id: 2, code: 'B/2', item_id: 10, name: 'Chair', base_unit: 'pcs', qty: 3 },
    ]
    const map = buildOwnerStockMap(rows)
    expect(map.get('1:10')).toBe(5)
    expect(map.get('2:10')).toBe(3)
  })

  it('handles empty array', () => {
    const map = buildOwnerStockMap([])
    expect(map.size).toBe(0)
  })
})

describe('transferOwnerFlags', () => {
  it('transfer_holder: destination is the selected apartment, holder is never owner', () => {
    const f = transferOwnerFlags('transfer_holder', true, false)
    expect(f).toEqual({ fromOwner: false, toOwner: true })
    expect(isTransferBlocked('asset', f.fromOwner, f.toOwner)).toBe(true)
  })

  it('transfer_holder to a regular apartment is not blocked', () => {
    const f = transferOwnerFlags('transfer_holder', false, true)
    expect(f).toEqual({ fromOwner: false, toOwner: false })
    expect(isTransferBlocked('asset', f.fromOwner, f.toOwner)).toBe(false)
  })

  it('transfer_apartment uses selected as source and target as destination', () => {
    expect(transferOwnerFlags('transfer_apartment', true, false)).toEqual({ fromOwner: true, toOwner: false })
    expect(transferOwnerFlags('transfer_apartment', false, true)).toEqual({ fromOwner: false, toOwner: true })
  })

  it('consumables are never blocked even into an owner apartment', () => {
    const f = transferOwnerFlags('transfer_holder', true, false)
    expect(isTransferBlocked('consumable', f.fromOwner, f.toOwner)).toBe(false)
  })
})

describe('isFromApartmentOp', () => {
  it('is true for the operations that take items out of an apartment', () => {
    expect(isFromApartmentOp('return_apartment')).toBe(true)
    expect(isFromApartmentOp('writeoff_apartment')).toBe(true)
    expect(isFromApartmentOp('transfer_apartment')).toBe(true)
  })
  it('is false for the others', () => {
    for (const op of ['receipt', 'issue_apartment', 'writeoff_warehouse', 'issue_holder', 'return_holder', 'writeoff_holder', 'transfer_holder'] as const) {
      expect(isFromApartmentOp(op)).toBe(false)
    }
  })
})

describe('buildBalanceMap', () => {
  it('keeps positive quantities and converts numeric strings', () => {
    const m = buildBalanceMap([{ item_id: 1, qty: '2.5' }, { item_id: 2, qty: 3 }])
    expect(m.get(1)).toBe(2.5)
    expect(m.get(2)).toBe(3)
  })
  it('drops zero, negative and non-numeric quantities', () => {
    const m = buildBalanceMap([{ item_id: 1, qty: 0 }, { item_id: 2, qty: -1 }, { item_id: 3, qty: 'x' }])
    expect(m.size).toBe(0)
  })
  it('sums repeated rows for one item', () => {
    expect(buildBalanceMap([{ item_id: 1, qty: 1 }, { item_id: 1, qty: 2 }]).get(1)).toBe(3)
  })
})

describe('rowsInLocation', () => {
  const rows = [
    { item_id: 1, name: 'A', qty: 50 },
    { item_id: 2, name: 'B', qty: 0 },
    { item_id: 3, name: 'C', qty: 7 },
  ]
  it('keeps only items the location holds and uses its quantity', () => {
    const out = rowsInLocation(rows, new Map([[2, 4], [3, 1]]))
    expect(out.map((r) => [r.item_id, r.qty])).toEqual([[2, 4], [3, 1]])
  })
  it('keeps the input order and does not mutate the input', () => {
    const out = rowsInLocation(rows, new Map([[3, 1], [1, 2]]))
    expect(out.map((r) => r.item_id)).toEqual([1, 3])
    expect(rows[0].qty).toBe(50)
  })
  it('returns nothing for an empty location', () => {
    expect(rowsInLocation(rows, new Map())).toEqual([])
  })
})
