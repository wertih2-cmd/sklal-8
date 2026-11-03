import { describe, it, expect } from 'vitest'
import {
  canAddToSelection,
  getIneligibleReason,
  validateLines,
  type TransferCandidate,
  type TransferSelection,
} from './transferSelection'

const asset = (over: Partial<TransferCandidate> = {}): TransferCandidate => ({
  key: 'a1',
  item_id: 1,
  name: 'Item',
  kind: 'asset',
  qty: 5,
  apartment_id: null,
  unit: { base_unit: 'pcs', pack_size: 1, pack_label: '' },
  ...over,
})

describe('getIneligibleReason', () => {
  it('rejects consumables in both scopes', () => {
    expect(getIneligibleReason([], asset({ kind: 'consumable' }))).toBe('consumable')
    expect(getIneligibleReason([], asset({ kind: 'consumable', apartment_id: 3 }))).toBe('consumable')
  })

  it('rejects zero stock', () => {
    expect(getIneligibleReason([], asset({ qty: 0 }))).toBe('noStock')
  })

  it('rejects a second owner apartment', () => {
    const selection: TransferSelection = [{ row: asset({ key: 'o1', apartment_id: 10 }), qty: 1 }]
    expect(getIneligibleReason(selection, asset({ key: 'o2', apartment_id: 11 }))).toBe('otherApartment')
  })

  it('accepts eligible assets', () => {
    expect(getIneligibleReason([], asset())).toBeNull()
  })
})

describe('canAddToSelection', () => {
  it('allows only one owner apartment in the selection', () => {
    const selection: TransferSelection = [{ row: asset({ key: 'o1', apartment_id: 10 }), qty: 1 }]
    expect(canAddToSelection(selection, asset({ key: 'o2', apartment_id: 10 }))).toBe(true)
    expect(canAddToSelection(selection, asset({ key: 'o3', apartment_id: 11 }))).toBe(false)
  })

  it('does not add the same row twice', () => {
    const row = asset()
    expect(canAddToSelection([{ row, qty: 1 }], row)).toBe(false)
  })

  it('rejects ineligible rows', () => {
    expect(canAddToSelection([], asset({ kind: 'consumable' }))).toBe(false)
  })
})

describe('validateLines', () => {
  it('reports an empty selection', () => {
    expect(validateLines([])).toEqual({ ok: false, error: 'empty' })
  })

  it('rejects quantity above the available stock', () => {
    expect(validateLines([{ row: asset({ qty: 2 }), qty: 3 }])).toEqual({ ok: false, error: 'exceeds' })
  })

  it('rejects non-positive quantities', () => {
    expect(validateLines([{ row: asset(), qty: 0 }])).toEqual({ ok: false, error: 'qty' })
  })

  it('rejects more than three decimal places', () => {
    expect(validateLines([{ row: asset({ qty: 5 }), qty: 1.2345 }])).toEqual({ ok: false, error: 'qty' })
  })

  it('accepts fractional quantities with up to three decimals', () => {
    expect(validateLines([{ row: asset({ item_id: 7, qty: 5 }), qty: 1.125 }])).toEqual({
      ok: true,
      lines: [{ item_id: 7, qty: 1.125 }],
    })
  })
})
