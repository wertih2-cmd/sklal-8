import type { ExpenseRow } from '@/modules/admin/reportRules'

export type ExpenseView = 'rows' | 'apartments' | 'buildings'
export const EXPENSE_VIEWS: ExpenseView[] = ['rows', 'apartments', 'buildings']

/** Placeholder code that groupExpense uses for moves without an apartment. */
export const NO_APARTMENT_CODE = '—'

export interface ExpenseGroup {
  key: string
  /** apartment code or building name; empty when unknown (the UI shows a localized placeholder) */
  label: string
  cost: number
  /** false when none of the lines has a purchase price, so `cost` is not a real amount */
  priced: boolean
  /** at least one line has no (or only a partial) purchase price: the cost is understated */
  partial: boolean
  lines: number
  children: ExpenseGroup[]
}

interface Acc {
  label: string
  cost: number
  priced: boolean
  partial: boolean
  lines: number
}

function newAcc(label: string): Acc {
  return { label, cost: 0, priced: false, partial: false, lines: 0 }
}

function add(acc: Acc, row: ExpenseRow): void {
  acc.lines++
  if (row.cost != null) {
    acc.cost += row.cost
    acc.priced = true
  }
  if (row.partial) acc.partial = true
}

function sortGroups(groups: ExpenseGroup[]): ExpenseGroup[] {
  return groups.sort((a, b) => {
    if (a.priced !== b.priced) return a.priced ? -1 : 1
    return b.cost - a.cost || a.label.localeCompare(b.label)
  })
}

function toGroup(key: string, acc: Acc, children: ExpenseGroup[] = []): ExpenseGroup {
  return { key, label: acc.label, cost: acc.cost, priced: acc.priced, partial: acc.partial, lines: acc.lines, children }
}

export function groupByApartment(rows: ExpenseRow[]): ExpenseGroup[] {
  const map = new Map<string, Acc>()
  for (const row of rows) {
    const known = row.apartment !== NO_APARTMENT_CODE
    const key = known ? row.apartment : 'none'
    const acc = map.get(key) ?? newAcc(known ? row.apartment : '')
    add(acc, row)
    map.set(key, acc)
  }
  return sortGroups(Array.from(map, ([key, acc]) => toGroup(key, acc)))
}

/**
 * Buildings with their apartments underneath. `buildingOf` maps an apartment code to a building name;
 * apartments it does not know (and moves without an apartment) go to one group with an empty label.
 */
export function groupByBuilding(
  rows: ExpenseRow[],
  buildingOf: (apartmentCode: string) => string | null | undefined,
): ExpenseGroup[] {
  const byBuilding = new Map<string, { acc: Acc; rows: ExpenseRow[] }>()
  for (const row of rows) {
    const building = row.apartment === NO_APARTMENT_CODE ? null : buildingOf(row.apartment) ?? null
    const key = building ?? 'none'
    const entry = byBuilding.get(key) ?? { acc: newAcc(building ?? ''), rows: [] }
    add(entry.acc, row)
    entry.rows.push(row)
    byBuilding.set(key, entry)
  }
  return sortGroups(
    Array.from(byBuilding, ([key, entry]) => toGroup(`b:${key}`, entry.acc, groupByApartment(entry.rows))),
  )
}

export interface ExpenseGroupTotals {
  cost: number
  priced: boolean
  partial: boolean
  lines: number
}

export function groupTotals(groups: ExpenseGroup[]): ExpenseGroupTotals {
  return groups.reduce<ExpenseGroupTotals>(
    (sum, g) => ({
      cost: sum.cost + g.cost,
      priced: sum.priced || g.priced,
      partial: sum.partial || g.partial,
      lines: sum.lines + g.lines,
    }),
    { cost: 0, priced: false, partial: false, lines: 0 },
  )
}
