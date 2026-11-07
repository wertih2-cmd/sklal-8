import type { ChargesReportRow, ReportStockMoveRow, WarehouseStockRow } from '@/lib/database.types'
import type { ExpenseRow } from '@/modules/admin/reportRules'
import type { ReportTab } from '@/modules/admin/reportLinks'
import { queryTokens } from '@/modules/admin/incidentFilter'

/** Tabs whose table can be searched. */
export const SEARCH_TABS: ReportTab[] = ['expense', 'stock', 'moves', 'charges']

export interface SearchContext {
  /** true when the (lowercased) token matches the item's name in any language */
  itemMatches(token: string, baseName: string): boolean
  /** true when the (lowercased) token matches the category's name in any language */
  categoryMatches(token: string, baseName: string): boolean
}

export interface SearchField {
  text: string | null | undefined
  /** item / category names are matched through the catalog (all languages); plain text by substring */
  kind?: 'item' | 'category'
}

function fieldMatches(field: SearchField, token: string, ctx: SearchContext): boolean {
  if (field.text == null || field.text === '') return false
  if (field.kind === 'item') return ctx.itemMatches(token, field.text)
  if (field.kind === 'category') return ctx.categoryMatches(token, field.text)
  return field.text.toLowerCase().includes(token)
}

/** Every token of the query must match at least one field of the row (AND across tokens). */
export function searchRows<T>(
  rows: T[],
  query: string,
  ctx: SearchContext,
  fieldsOf: (row: T) => SearchField[],
): T[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return rows
  return rows.filter((row) => {
    const fields = fieldsOf(row)
    return tokens.every((token) => fields.some((field) => fieldMatches(field, token, ctx)))
  })
}

export const expenseFields = (row: ExpenseRow): SearchField[] => [
  { text: row.apartment },
  { text: row.item, kind: 'item' },
  { text: row.category, kind: 'category' },
  { text: row.ownerCode },
]

export const stockFields = (row: Pick<WarehouseStockRow, 'name' | 'category'>): SearchField[] => [
  { text: row.name, kind: 'item' },
  { text: row.category, kind: 'category' },
]

export const moveFields = (
  row: Pick<ReportStockMoveRow, 'item_name' | 'category' | 'apartment_code' | 'source_type' | 'owner_code'>,
): SearchField[] => [
  { text: row.item_name, kind: 'item' },
  { text: row.category, kind: 'category' },
  { text: row.apartment_code },
  { text: row.source_type },
  { text: row.owner_code },
]

export const chargeFields = (
  row: Pick<ChargesReportRow, 'apartment_code' | 'item_name' | 'tenant_note' | 'kind' | 'owner_code'>,
): SearchField[] => [
  { text: row.apartment_code },
  { text: row.item_name, kind: 'item' },
  { text: row.tenant_note },
  { text: row.kind },
  { text: row.owner_code },
]
