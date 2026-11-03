import type { BaseUnit, ItemKind, TransferLine } from '@/lib/database.types'

export interface TransferUnit {
  base_unit: BaseUnit
  pack_size: number
  pack_label: string
}

export interface TransferCandidate {
  key: string
  item_id: number
  name: string
  kind: ItemKind
  qty: number
  apartment_id: number | null
  unit: TransferUnit
}

export interface TransferSelectionEntry {
  row: TransferCandidate
  qty: number
}

export type TransferSelection = TransferSelectionEntry[]

export type IneligibleReason = 'consumable' | 'noStock' | 'otherApartment'

export type TransferValidation =
  | { ok: true; lines: TransferLine[] }
  | { ok: false; error: 'empty' | 'qty' | 'exceeds' }

const MAX_DECIMALS = 3

export function getIneligibleReason(selection: TransferSelection, row: TransferCandidate): IneligibleReason | null {
  if (row.kind !== 'asset') return 'consumable'
  if (row.qty <= 0) return 'noStock'
  if (selection.length > 0 && selection[0].row.apartment_id !== row.apartment_id) return 'otherApartment'
  return null
}

export function canAddToSelection(selection: TransferSelection, row: TransferCandidate): boolean {
  if (getIneligibleReason(selection, row) !== null) return false
  return !selection.some((entry) => entry.row.key === row.key)
}

function hasAtMostDecimals(value: number, decimals: number): boolean {
  const scaled = value * 10 ** decimals
  return Math.abs(scaled - Math.round(scaled)) < 1e-9
}

export function validateLines(selection: TransferSelection): TransferValidation {
  if (selection.length === 0) return { ok: false, error: 'empty' }

  const lines: TransferLine[] = []
  for (const { row, qty } of selection) {
    if (!Number.isFinite(qty) || qty <= 0 || !hasAtMostDecimals(qty, MAX_DECIMALS)) {
      return { ok: false, error: 'qty' }
    }
    if (qty > row.qty) return { ok: false, error: 'exceeds' }
    lines.push({ item_id: row.item_id, qty })
  }
  return { ok: true, lines }
}
