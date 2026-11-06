import type { ItemUnit } from '@/lib/database.types'

/** Расположение единицы (строка таблицы locations). */
export interface UnitLocation {
  id: number
  type: string
  apartment_id: number | null
  staff_id: number | null
}

export interface UnitSourceCtx {
  op: string
  apartmentId: number | null
  staffId: number | null
  ownerApartmentId: number | null
  ownerMode: boolean
  aptIsOwner: boolean
  isAsset: boolean
}

export type UnitSource =
  | { kind: 'warehouse' }
  | { kind: 'owner_stock'; apartmentId: number }
  | { kind: 'apartment'; apartmentId: number }
  | { kind: 'holder'; staffId: number }

/**
 * Откуда брать единицы: зеркало логики post_move.
 * null — единицы выбирать не нужно (приход) или не хватает данных (квартира/сотрудник не выбраны).
 */
export function unitSource(ctx: UnitSourceCtx): UnitSource | null {
  switch (ctx.op) {
    case 'issue_apartment':
      if (ctx.aptIsOwner && ctx.isAsset) return ctx.apartmentId != null ? { kind: 'owner_stock', apartmentId: ctx.apartmentId } : null
      return { kind: 'warehouse' }
    case 'return_apartment':
    case 'writeoff_apartment':
      return ctx.apartmentId != null ? { kind: 'apartment', apartmentId: ctx.apartmentId } : null
    case 'writeoff_warehouse':
      if (ctx.ownerMode) return ctx.ownerApartmentId != null ? { kind: 'owner_stock', apartmentId: ctx.ownerApartmentId } : null
      return { kind: 'warehouse' }
    case 'issue_holder':
      return { kind: 'warehouse' }
    case 'transfer_apartment':
      return ctx.apartmentId != null ? { kind: 'apartment', apartmentId: ctx.apartmentId } : null
    case 'transfer_holder':
      return ctx.staffId != null ? { kind: 'holder', staffId: ctx.staffId } : null
    case 'return_holder':
    case 'writeoff_holder':
      return ctx.staffId != null ? { kind: 'holder', staffId: ctx.staffId } : null
    default:
      return null
  }
}

/** Единицы товара, доступные в источнике. Окончательную проверку делает база. */
export function candidateUnits(
  units: ItemUnit[],
  locs: Map<number, UnitLocation>,
  itemId: number,
  source: UnitSource | null,
): ItemUnit[] {
  if (!source) return []
  return units
    .filter((u) => {
      if (u.item_id !== itemId) return false
      const loc = locs.get(u.location_id)
      if (!loc) return false
      switch (source.kind) {
        case 'warehouse':
          return loc.type === 'warehouse' && u.status === 'in_stock'
        case 'owner_stock':
          return loc.type === 'owner_stock' && u.status === 'in_stock' && u.owner_apartment_id === source.apartmentId
        case 'apartment':
          return loc.type === 'apartment' && loc.apartment_id === source.apartmentId && u.status === 'issued'
        case 'holder':
          return loc.type === 'holder' && loc.staff_id === source.staffId && u.status === 'issued'
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
}

/** Выбор, оставшийся допустимым после смены операции, квартиры или сотрудника. */
export function effectiveSelection(selected: string[], candidates: ItemUnit[]): string[] {
  const ok = new Set(candidates.map((u) => u.id))
  return selected.filter((id, i) => ok.has(id) && selected.indexOf(id) === i)
}

export function toggleUnit(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
}
