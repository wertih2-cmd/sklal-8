import type { AptType, NormType } from '@/lib/database.types'
import { HEADER_WORDS } from '@/i18n/importHeaders'

// ---------------------------------------------------------------- CSV

/** UTF-8 first (a BOM is dropped); a file that is not valid UTF-8 is read as Windows-1251, as Excel writes it in Russian. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1251').decode(bytes)
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? ''
  let inQuotes = false
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch in counts) counts[ch]++
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ';'
}

/** Rows of cells. Handles quotes, doubled quotes, line breaks inside quotes and any of ; , tab as the delimiter. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const endRow = () => {
    row.push(cell)
    cell = ''
    if (row.some((c) => c.trim() !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delimiter) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow() }
    else cell += ch
  }
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

// ---------------------------------------------------------------- Columns

export type Column = 'type' | 'apartment' | 'normType' | 'category' | 'item' | 'qty' | 'unit' | 'note'


const squash = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '')
const tidy = (s: string) => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()

export function mapHeader(header: string[]): Partial<Record<Column, number>> {
  const out: Partial<Record<Column, number>> = {}
  header.forEach((h, idx) => {
    const key = squash(h)
    if (!key) return
    for (const col of Object.keys(HEADER_WORDS) as Column[]) {
      if (out[col] === undefined && HEADER_WORDS[col].includes(key)) { out[col] = idx; break }
    }
  })
  return out
}

// ---------------------------------------------------------------- Rows

export interface ImportContext {
  apartments: Array<{ id: number; code: string; number: string; type: AptType }>
  items: Array<{ id: number; name: string; name_en: string | null; name_ar: string | null; category_id: number; active: boolean }>
  categories: Array<{ id: number; name: string; name_en: string | null; name_ar: string | null }>
  /** Every accepted spelling of a norm kind or apartment type (all interface languages). */
  normTypeNames: Record<NormType, string[]>
  aptTypeNames: Record<AptType, string[]>
}

export type Scope = { kind: 'type'; aptType: AptType } | { kind: 'apartment'; apartmentId: number }

export interface ImportRow {
  line: number
  scope: Scope
  normType: NormType
  itemId: number
  qty: number
  note: string | null
}

export type IssueCode =
  | 'no_scope' | 'both_scopes' | 'unknown_type' | 'unknown_apartment' | 'ambiguous_apartment'
  | 'unknown_norm_type' | 'unknown_category' | 'unknown_item' | 'ambiguous_item' | 'item_category_mismatch'
  | 'item_inactive' | 'bad_qty' | 'duplicate'

export interface ImportIssue { line: number; code: IssueCode; value: string }

export type MissingColumn = 'item' | 'qty' | 'normType' | 'scope'

export interface ParsedImport {
  missing: MissingColumn[]
  rows: ImportRow[]
  issues: ImportIssue[]
  /** Data lines read (empty lines are not counted). */
  lines: number
}

export function parseQty(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (s === '' || !/^\d+(\.\d+)?$/.test(s)) return null
  const v = Math.round(Number(s) * 1000) / 1000
  return Number.isFinite(v) && v <= 1_000_000 ? v : null
}

function lookup<T extends string>(names: Record<T, string[]>, raw: string): T | null {
  const key = tidy(raw)
  if (!key) return null
  for (const k of Object.keys(names) as T[]) {
    if (tidy(k) === key || names[k].some((n) => tidy(n) === key)) return k
  }
  return null
}

const norm = (s: string | null | undefined) => tidy(s ?? '')

export function parseNormRows(table: string[][], ctx: ImportContext): ParsedImport {
  const out: ParsedImport = { missing: [], rows: [], issues: [], lines: 0 }
  if (table.length === 0) { out.missing = ['item', 'qty', 'normType', 'scope']; return out }
  const cols = mapHeader(table[0])
  if (cols.item === undefined) out.missing.push('item')
  if (cols.qty === undefined) out.missing.push('qty')
  if (cols.normType === undefined) out.missing.push('normType')
  if (cols.type === undefined && cols.apartment === undefined) out.missing.push('scope')
  if (out.missing.length > 0) return out

  const cell = (r: string[], c: Column) => (cols[c] === undefined ? '' : (r[cols[c] as number] ?? '').trim())
  const seen = new Set<string>()
  const byCode = new Map<string, number[]>()
  const byNumber = new Map<string, number[]>()
  ctx.apartments.forEach((a, i) => {
    byCode.set(norm(a.code), [...(byCode.get(norm(a.code)) ?? []), i])
    byNumber.set(norm(a.number), [...(byNumber.get(norm(a.number)) ?? []), i])
  })
  const catIdsByName = new Map<string, number[]>()
  for (const c of ctx.categories) {
    for (const nm of [c.name, c.name_en, c.name_ar]) {
      const k = norm(nm)
      if (k) catIdsByName.set(k, [...new Set([...(catIdsByName.get(k) ?? []), c.id])])
    }
  }
  const itemsByName = new Map<string, typeof ctx.items>()
  for (const it of ctx.items) {
    for (const nm of [it.name, it.name_en, it.name_ar]) {
      const k = norm(nm)
      if (!k) continue
      const list = itemsByName.get(k) ?? []
      if (!list.includes(it)) list.push(it)
      itemsByName.set(k, list)
    }
  }

  for (let r = 1; r < table.length; r++) {
    const line = r + 1
    const row = table[r]
    out.lines++
    const fail = (code: IssueCode, value = '') => { out.issues.push({ line, code, value }) }

    // Scope: exactly one of apartment type / apartment.
    const typeRaw = cell(row, 'type')
    const aptRaw = cell(row, 'apartment')
    let scope: Scope | null = null
    if (typeRaw && aptRaw) { fail('both_scopes'); continue }
    if (!typeRaw && !aptRaw) { fail('no_scope'); continue }
    if (typeRaw) {
      const aptType = lookup(ctx.aptTypeNames, typeRaw)
      if (!aptType) { fail('unknown_type', typeRaw); continue }
      scope = { kind: 'type', aptType }
    } else {
      let hits = byCode.get(norm(aptRaw)) ?? []
      if (hits.length === 0) hits = byNumber.get(norm(aptRaw)) ?? []
      if (hits.length === 0) { fail('unknown_apartment', aptRaw); continue }
      if (hits.length > 1) { fail('ambiguous_apartment', aptRaw); continue }
      scope = { kind: 'apartment', apartmentId: ctx.apartments[hits[0]].id }
    }

    const normType = lookup(ctx.normTypeNames, cell(row, 'normType'))
    if (!normType) { fail('unknown_norm_type', cell(row, 'normType')); continue }

    // Item, narrowed by the category when the file has one.
    const catRaw = cell(row, 'category')
    let catIds: number[] | null = null
    if (catRaw) {
      catIds = catIdsByName.get(norm(catRaw)) ?? []
      if (catIds.length === 0) { fail('unknown_category', catRaw); continue }
    }
    const itemRaw = cell(row, 'item')
    const named = itemsByName.get(norm(itemRaw)) ?? []
    if (named.length === 0) { fail('unknown_item', itemRaw); continue }
    const inCategory = catIds ? named.filter((it) => catIds!.includes(it.category_id)) : named
    if (inCategory.length === 0) { fail('item_category_mismatch', itemRaw); continue }
    if (inCategory.length > 1) { fail('ambiguous_item', itemRaw); continue }
    const item = inCategory[0]
    if (!item.active) { fail('item_inactive', itemRaw); continue }

    const qty = parseQty(cell(row, 'qty'))
    if (qty === null) { fail('bad_qty', cell(row, 'qty')); continue }

    const key = `${scope.kind === 'type' ? `t:${scope.aptType}` : `a:${scope.apartmentId}`}|${normType}|${item.id}`
    if (seen.has(key)) { fail('duplicate', itemRaw); continue }
    seen.add(key)

    out.rows.push({ line, scope, normType, itemId: item.id, qty, note: cell(row, 'note') || null })
  }
  return out
}

// ---------------------------------------------------------------- Plan

export interface RuleKey {
  norm_type: NormType
  apt_type: AptType | null
  apartment_id: number | null
  item_id: number
}
export interface NewRule extends RuleKey { qty: number; note: string | null }
export interface ExistingRule extends NewRule { id: number }
export type ImportMode = 'merge' | 'replace'

export interface ImportPlan {
  inserts: NewRule[]
  updates: ExistingRule[]
  deletes: number[]
  unchanged: number
  /** Scopes touched by the file: apartment types and apartments. */
  types: AptType[]
  apartments: number[]
}

const scopeKey = (apt_type: AptType | null, apartment_id: number | null) => (apartment_id != null ? `a:${apartment_id}` : `t:${apt_type}`)
const ruleKey = (r: RuleKey) => `${scopeKey(r.apt_type, r.apartment_id)}|${r.norm_type}|${r.item_id}`

/**
 * What to write so that the file is in force. "merge" adds and updates only. "replace" also deletes, in every scope the file
 * mentions, the rules the file does not list (an apartment then follows the template again for those items).
 * An empty note in the file keeps the existing one in "merge".
 */
export function planImport(rows: ImportRow[], existing: ExistingRule[], mode: ImportMode): ImportPlan {
  const byKey = new Map(existing.map((e) => [ruleKey(e), e]))
  const plan: ImportPlan = { inserts: [], updates: [], deletes: [], unchanged: 0, types: [], apartments: [] }
  const filed = new Set<string>()
  const scopes = new Set<string>()
  for (const r of rows) {
    const apt_type = r.scope.kind === 'type' ? r.scope.aptType : null
    const apartment_id = r.scope.kind === 'apartment' ? r.scope.apartmentId : null
    const rule: NewRule = { norm_type: r.normType, apt_type, apartment_id, item_id: r.itemId, qty: r.qty, note: r.note }
    const key = ruleKey(rule)
    filed.add(key)
    scopes.add(scopeKey(apt_type, apartment_id))
    const ex = byKey.get(key)
    if (!ex) { plan.inserts.push(rule); continue }
    const note = r.note ?? (mode === 'merge' ? ex.note : null)
    if (ex.qty === r.qty && (ex.note ?? null) === (note ?? null)) { plan.unchanged++; continue }
    plan.updates.push({ ...rule, note, id: ex.id })
  }
  if (mode === 'replace') {
    for (const e of existing) {
      if (scopes.has(scopeKey(e.apt_type, e.apartment_id)) && !filed.has(ruleKey(e))) plan.deletes.push(e.id)
    }
  }
  plan.types = [...scopes].filter((s) => s.startsWith('t:')).map((s) => s.slice(2) as AptType)
  plan.apartments = [...scopes].filter((s) => s.startsWith('a:')).map((s) => Number(s.slice(2)))
  return plan
}

/**
 * Emergency clear: every item the apartment would have, from its own rules and from the template of its type,
 * gets a quantity of 0 ("not needed"). Notes stay.
 */
export function planClearApartment(apartmentId: number, own: ExistingRule[], template: ExistingRule[]): { inserts: NewRule[]; updates: ExistingRule[] } {
  const ownKeys = new Set(own.map((o) => `${o.norm_type}|${o.item_id}`))
  const inserts: NewRule[] = template
    .filter((t) => !ownKeys.has(`${t.norm_type}|${t.item_id}`))
    .map((t) => ({ norm_type: t.norm_type, apt_type: null, apartment_id: apartmentId, item_id: t.item_id, qty: 0, note: t.note }))
  const updates = own.filter((o) => o.qty !== 0).map((o) => ({ ...o, qty: 0 }))
  return { inserts, updates }
}

/** The norms an apartment has now (own rules over the template), as a file to bring them back. */
export function effectiveRules(own: ExistingRule[], template: ExistingRule[]): ExistingRule[] {
  const ownKeys = new Set(own.map((o) => `${o.norm_type}|${o.item_id}`))
  return [...own, ...template.filter((t) => !ownKeys.has(`${t.norm_type}|${t.item_id}`))]
}

// ---------------------------------------------------------------- File

export interface FileLabels {
  type: string; apartment: string; normType: string; category: string; item: string; qty: string; unit: string; note: string
  normTypeNames: Record<NormType, string>
  aptTypeNames: Record<AptType, string>
}

export interface CatalogRow { id: number; name: string; category: string; unit: string }

/** Header plus one row per rule, in the language of the interface. Importing the file back restores the rules. */
export function buildNormsTable(rules: NewRule[], catalog: Map<number, CatalogRow>, apartments: Map<number, string>, labels: FileLabels): string[][] {
  const header = [labels.type, labels.apartment, labels.normType, labels.category, labels.item, labels.qty, labels.unit, labels.note]
  const body = rules.map((r) => {
    const it = catalog.get(r.item_id)
    return [
      r.apt_type ? labels.aptTypeNames[r.apt_type] : '',
      r.apartment_id != null ? apartments.get(r.apartment_id) ?? String(r.apartment_id) : '',
      labels.normTypeNames[r.norm_type],
      it?.category ?? '',
      it?.name ?? String(r.item_id),
      String(r.qty),
      it?.unit ?? '',
      r.note ?? '',
    ]
  })
  return [header, ...body]
}

/** Example rows for the blank template: one by type and one by apartment. */
export function buildTemplateTable(labels: FileLabels, sample: { apartment: string; item: string; category: string; unit: string }): string[][] {
  return [
    [labels.type, labels.apartment, labels.normType, labels.category, labels.item, labels.qty, labels.unit, labels.note],
    [labels.aptTypeNames.studio, '', labels.normTypeNames.asset_standing, sample.category, sample.item, '2', sample.unit, ''],
    ['', sample.apartment, labels.normTypeNames.asset_standing, sample.category, sample.item, '4', sample.unit, ''],
  ]
}
