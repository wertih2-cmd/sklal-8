import { describe, it, expect } from 'vitest'
import type { ItemUnit } from '@/lib/database.types'
import { unitSource, candidateUnits, effectiveSelection, toggleUnit, isUnitOpSupported, type UnitLocation, type UnitSourceCtx } from './unitSelection'

const ctx = (p: Partial<UnitSourceCtx>): UnitSourceCtx => ({
  op: 'issue_apartment', apartmentId: null, staffId: null, ownerApartmentId: null, ownerMode: false, aptIsOwner: false, isAsset: true, ...p,
})

const locs = new Map<number, UnitLocation>([
  [1, { id: 1, type: 'warehouse', apartment_id: null, staff_id: null }],
  [2, { id: 2, type: 'owner_stock', apartment_id: null, staff_id: null }],
  [3, { id: 3, type: 'apartment', apartment_id: 10, staff_id: null }],
  [4, { id: 4, type: 'holder', apartment_id: null, staff_id: 7 }],
  [5, { id: 5, type: 'apartment', apartment_id: 11, staff_id: null }],
])

const unit = (id: string, loc: number, status: ItemUnit['status'], owner: number | null = null, item = 1, code = id): ItemUnit => ({
  id, item_id: item, code, status, location_id: loc, owner_apartment_id: owner, unit_cost: null, created_at: '2026-01-01T00:00:00Z',
})

const units: ItemUnit[] = [
  unit('w1', 1, 'in_stock', null, 1, 'U-1-10'),
  unit('w2', 1, 'in_stock', null, 1, 'U-1-9'),
  unit('w3', 1, 'in_stock', null, 2),
  unit('o1', 2, 'in_stock', 20),
  unit('o2', 2, 'in_stock', 21),
  unit('a1', 3, 'issued'),
  unit('a2', 5, 'issued'),
  unit('h1', 4, 'issued'),
  unit('x1', 1, 'written_off'),
]

describe('unitSource', () => {
  it('issue to regular apartment comes from warehouse', () => {
    expect(unitSource(ctx({ apartmentId: 10 }))).toEqual({ kind: 'warehouse' })
  })
  it('issue of asset to owner apartment comes from owner stock', () => {
    expect(unitSource(ctx({ apartmentId: 20, aptIsOwner: true }))).toEqual({ kind: 'owner_stock', apartmentId: 20 })
  })
  it('issue to owner apartment without apartment chosen has no source', () => {
    expect(unitSource(ctx({ aptIsOwner: true }))).toBeNull()
  })
  it('return and writeoff from apartment use the apartment', () => {
    expect(unitSource(ctx({ op: 'return_apartment', apartmentId: 10 }))).toEqual({ kind: 'apartment', apartmentId: 10 })
    expect(unitSource(ctx({ op: 'writeoff_apartment', apartmentId: 10 }))).toEqual({ kind: 'apartment', apartmentId: 10 })
    expect(unitSource(ctx({ op: 'return_apartment' }))).toBeNull()
  })
  it('warehouse writeoff: company or owner stock', () => {
    expect(unitSource(ctx({ op: 'writeoff_warehouse' }))).toEqual({ kind: 'warehouse' })
    expect(unitSource(ctx({ op: 'writeoff_warehouse', ownerMode: true, ownerApartmentId: 20 }))).toEqual({ kind: 'owner_stock', apartmentId: 20 })
    expect(unitSource(ctx({ op: 'writeoff_warehouse', ownerMode: true }))).toBeNull()
  })
  it('holder operations', () => {
    expect(unitSource(ctx({ op: 'issue_holder' }))).toEqual({ kind: 'warehouse' })
    expect(unitSource(ctx({ op: 'return_holder', staffId: 7 }))).toEqual({ kind: 'holder', staffId: 7 })
    expect(unitSource(ctx({ op: 'writeoff_holder' }))).toBeNull()
  })
  it('receipt and transfers need no unit choice', () => {
    expect(unitSource(ctx({ op: 'receipt' }))).toBeNull()
    expect(unitSource(ctx({ op: 'transfer_apartment', apartmentId: 10 }))).toBeNull()
  })
})

describe('isUnitOpSupported', () => {
  it('rejects transfers only', () => {
    expect(isUnitOpSupported('transfer_apartment')).toBe(false)
    expect(isUnitOpSupported('transfer_holder')).toBe(false)
    expect(isUnitOpSupported('issue_apartment')).toBe(true)
    expect(isUnitOpSupported('receipt')).toBe(true)
  })
})

describe('candidateUnits', () => {
  it('warehouse: only in_stock units of the item, natural code order', () => {
    expect(candidateUnits(units, locs, 1, { kind: 'warehouse' }).map((u) => u.id)).toEqual(['w2', 'w1'])
  })
  it('owner stock: filtered by owner apartment', () => {
    expect(candidateUnits(units, locs, 1, { kind: 'owner_stock', apartmentId: 20 }).map((u) => u.id)).toEqual(['o1'])
  })
  it('apartment: only units located in that apartment', () => {
    expect(candidateUnits(units, locs, 1, { kind: 'apartment', apartmentId: 10 }).map((u) => u.id)).toEqual(['a1'])
  })
  it('holder: only units of that staff member', () => {
    expect(candidateUnits(units, locs, 1, { kind: 'holder', staffId: 7 }).map((u) => u.id)).toEqual(['h1'])
  })
  it('unknown location or no source gives empty list', () => {
    expect(candidateUnits([unit('z', 99, 'in_stock')], locs, 1, { kind: 'warehouse' })).toEqual([])
    expect(candidateUnits(units, locs, 1, null)).toEqual([])
  })
})

describe('effectiveSelection / toggleUnit', () => {
  const cands = candidateUnits(units, locs, 1, { kind: 'warehouse' })
  it('drops units that are no longer candidates and duplicates', () => {
    expect(effectiveSelection(['w1', 'a1', 'w1', 'w2'], cands)).toEqual(['w1', 'w2'])
  })
  it('toggles', () => {
    expect(toggleUnit(['w1'], 'w2')).toEqual(['w1', 'w2'])
    expect(toggleUnit(['w1', 'w2'], 'w1')).toEqual(['w2'])
  })
})
