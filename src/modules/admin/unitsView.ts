import type { ItemUnit, UnitStatus } from '@/lib/database.types'

export type UnitStatusFilter = 'all' | UnitStatus

export interface UnitRowView {
  id: string
  code: string
  itemId: number
  name: string
  status: UnitStatus
  locationId: number
  location: string
  ownerApartmentId: number | null
  unitCost: number | null
}

export type EventLabelKey =
  | 'evInitial' | 'evReceipt' | 'evIssueApartment' | 'evReturnApartment' | 'evWriteoffApartment'
  | 'evWriteoffWarehouse' | 'evIssueHolder' | 'evReturnHolder' | 'evWriteoffHolder'
  | 'evTransfer' | 'evOwnerTransfer' | 'evVoid'

/** Известные события журнала единиц. Остальные показываются как есть. */
export const EVENT_LABEL_KEYS: Record<string, EventLabelKey> = {
  initial: 'evInitial',
  receipt: 'evReceipt',
  issue_apartment: 'evIssueApartment',
  return_apartment: 'evReturnApartment',
  writeoff_apartment: 'evWriteoffApartment',
  writeoff_warehouse: 'evWriteoffWarehouse',
  issue_holder: 'evIssueHolder',
  return_holder: 'evReturnHolder',
  writeoff_holder: 'evWriteoffHolder',
  transfer: 'evTransfer',
  owner_transfer: 'evOwnerTransfer',
  void: 'evVoid',
}

export function buildUnitRows(
  units: ItemUnit[],
  locationNames: Map<number, string>,
  itemNames: Map<number, string>,
): UnitRowView[] {
  return units
    .map((u) => ({
      id: u.id,
      code: u.code,
      itemId: u.item_id,
      name: itemNames.get(u.item_id) ?? `#${u.item_id}`,
      status: u.status,
      locationId: u.location_id,
      location: locationNames.get(u.location_id) ?? `#${u.location_id}`,
      ownerApartmentId: u.owner_apartment_id,
      unitCost: u.unit_cost,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code, undefined, { numeric: true }))
}

export function filterUnitRows(
  rows: UnitRowView[],
  status: UnitStatusFilter,
  matches: (row: UnitRowView) => boolean,
): UnitRowView[] {
  return rows.filter((r) => (status === 'all' || r.status === status) && matches(r))
}

export function statusCounts(rows: UnitRowView[]): Record<UnitStatusFilter, number> {
  const counts: Record<UnitStatusFilter, number> = { all: rows.length, in_stock: 0, issued: 0, written_off: 0, lost: 0 }
  for (const r of rows) counts[r.status] += 1
  return counts
}

/** Совпадение строки поиска с кодом или расположением (без учёта регистра). Название проверяется отдельно с учётом переводов. */
export function matchesCodeOrLocation(row: UnitRowView, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return row.code.toLowerCase().includes(q) || row.location.toLowerCase().includes(q)
}
