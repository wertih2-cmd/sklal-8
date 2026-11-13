import type { OwnerStockRow } from '@/lib/database.types'

export type LineSource = 'owner' | 'company' | null

export type MoveOp =
  | 'receipt'
  | 'issue_apartment'
  | 'return_apartment'
  | 'writeoff_apartment'
  | 'writeoff_warehouse'
  | 'issue_holder'
  | 'return_holder'
  | 'writeoff_holder'
  | 'transfer_apartment'
  | 'transfer_holder'

export type ItemKind = 'asset' | 'consumable'

/** Operations that take items out of the selected apartment, so the list must show what that apartment holds. */
export function isFromApartmentOp(op: MoveOp): boolean {
  return op === 'return_apartment' || op === 'writeoff_apartment' || op === 'transfer_apartment'
}

/** item_id -> quantity in one location, from stock_balance rows. Only positive quantities are kept. */
export function buildBalanceMap(rows: { item_id: number; qty: number | string }[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const r of rows) {
    const q = Number(r.qty)
    if (!(q > 0)) continue
    map.set(r.item_id, (map.get(r.item_id) ?? 0) + q)
  }
  return map
}

/**
 * Catalogue rows restricted to what a location holds, with qty replaced by that location's balance.
 * Items with nothing there are dropped; the order of the input is kept.
 */
export function rowsInLocation<T extends { item_id: number; qty: number }>(rows: T[], balances: Map<number, number>): T[] {
  const out: T[] = []
  for (const r of rows) {
    const q = balances.get(r.item_id) ?? 0
    if (q > 0) out.push({ ...r, qty: q })
  }
  return out
}

/**
 * Determines which stock shelf a line item is sourced from for a given operation.
 * - 'owner' for assets when issuing to / returning from an owner apartment
 * - 'company' for consumables or regular apartments
 * - null when the operation doesn't pull from stock (receipt, writeoff from apartment, transfers)
 */
export function lineSource(
  op: MoveOp,
  aptIsOwner: boolean,
  kind: ItemKind,
): LineSource {
  if (op === 'issue_apartment' || op === 'return_apartment') {
    if (aptIsOwner && kind === 'asset') return 'owner'
    return 'company'
  }
  return null
}

/**
 * Whether a transfer is blocked by the server for this item/kind.
 * Assets belonging to an owner apartment cannot be moved between apartments or to a holder.
 * Consumables are never blocked (they always belong to the company).
 */
export function isTransferBlocked(
  kind: ItemKind,
  fromAptIsOwner: boolean,
  toAptIsOwner: boolean,
): boolean {
  if (kind !== 'asset') return false
  return fromAptIsOwner || toAptIsOwner
}

/**
 * Returns the owner-stock balance for a given apartment+item, or 0 if not found.
 */
export function ownerAvailable(
  map: Map<string, number>,
  apartmentId: number,
  itemId: number,
): number {
  return map.get(`${apartmentId}:${itemId}`) ?? 0
}

/**
 * Builds a lookup map from owner stock rows, keyed by "apartmentId:itemId".
 */
export function buildOwnerStockMap(rows: OwnerStockRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(`${r.apartment_id}:${r.item_id}`, r.qty)
  }
  return map
}

/**
 * Which ends of a transfer are owner apartments.
 * transfer_apartment: from = selected apartment, to = target apartment.
 * transfer_holder: staff holder -> selected apartment (the holder's stock is company stock).
 */
export function transferOwnerFlags(
  op: 'transfer_apartment' | 'transfer_holder',
  selectedAptIsOwner: boolean,
  toAptIsOwner: boolean,
): { fromOwner: boolean; toOwner: boolean } {
  if (op === 'transfer_holder') return { fromOwner: false, toOwner: selectedAptIsOwner }
  return { fromOwner: selectedAptIsOwner, toOwner: toAptIsOwner }
}
