import type { AptType } from '@/lib/database.types'
import { cleaningState, type CleaningFeedRow } from './cleaningFeed'
import type { TaskRole, TaskStatus } from './tasksModel'

export const CHECKLIST_MAX_ITEMS = 60
export const CHECKLIST_TEXT_MAX = 200
export const PHOTO_MAX = 6
export const NOTE_MAX = 500
export const APT_TYPES: readonly AptType[] = ['studio', '1br', '2br']

export interface ChecklistItem {
  id: number
  apt_type: AptType
  position: number
  body: string
}

export type InspectionStatus = 'passed' | 'needs_rework'

export interface InspectionItem {
  id: number
  inspection_id: number
  position: number
  body: string
  ok: boolean
  note: string | null
  photo_paths: string[]
  task_id: number | null
  resolved_at: string | null
  resolved_by_name: string | null
  recheck_note: string | null
  recheck_count: number
  recheck_photo_paths: string[]
}

export interface Inspection {
  id: number
  cleaning_event_id: string
  apartment_id: number
  status: InspectionStatus
  inspector_name: string | null
  inspected_at: string
  items: InspectionItem[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function parseChecklistItem(r: Record<string, unknown>): ChecklistItem | null {
  if (!APT_TYPES.includes(r.apt_type as AptType)) return null
  if (r.id == null) return null
  return { id: Number(r.id), apt_type: r.apt_type as AptType, position: Number(r.position ?? 0), body: String(r.body ?? '') }
}

function parseInspectionItem(r: Record<string, unknown>): InspectionItem {
  return {
    id: Number(r.id),
    inspection_id: Number(r.inspection_id),
    position: Number(r.position ?? 0),
    body: String(r.body ?? ''),
    ok: r.ok === true,
    note: str(r.note),
    photo_paths: strings(r.photo_paths),
    task_id: r.task_id == null ? null : Number(r.task_id),
    resolved_at: str(r.resolved_at),
    resolved_by_name: str(r.resolved_by_name),
    recheck_note: str(r.recheck_note),
    recheck_count: Number(r.recheck_count ?? 0),
    recheck_photo_paths: strings(r.recheck_photo_paths),
  }
}

/** A row of `inspections` with its `inspection_items` nested; the items come in the order of the check list. */
export function parseInspection(r: Record<string, unknown>): Inspection | null {
  if (r.id == null || typeof r.cleaning_event_id !== 'string') return null
  const status: InspectionStatus = r.status === 'needs_rework' ? 'needs_rework' : 'passed'
  const raw = Array.isArray(r.inspection_items) ? (r.inspection_items as Record<string, unknown>[]) : []
  return {
    id: Number(r.id),
    cleaning_event_id: r.cleaning_event_id,
    apartment_id: Number(r.apartment_id),
    status,
    inspector_name: str(r.inspector_name),
    inspected_at: String(r.inspected_at ?? ''),
    items: raw.map(parseInspectionItem).sort((a, b) => a.position - b.position || a.id - b.id),
  }
}

// ---- who may do what (the database checks it again) ----

export const canEditTemplate = (role: TaskRole) => role === 'admin' || role === 'manager'
export const canDeleteInspection = (role: TaskRole) => role === 'admin' || role === 'manager'

// ---- check list template editor ----

export interface TemplateDraftItem {
  /** Stable key of the row in the editor (not the database id). */
  key: string
  /** Database id of a saved item; null for a new one. */
  id: number | null
  text: string
}

export type TemplateError = 'empty' | 'long' | 'tooMany'

export function validateTemplate(items: readonly TemplateDraftItem[]): TemplateError | null {
  if (items.length > CHECKLIST_MAX_ITEMS) return 'tooMany'
  for (const it of items) {
    const t = it.text.trim()
    if (t === '') return 'empty'
    if (t.length > CHECKLIST_TEXT_MAX) return 'long'
  }
  return null
}

/** The `p_items` argument of checklist_save: the order of the array is the order of the items. */
export function toSaveItems(items: readonly TemplateDraftItem[]): Array<{ id?: number; text: string }> {
  return items.map((it) => (it.id == null ? { text: it.text.trim() } : { id: it.id, text: it.text.trim() }))
}

export function draftFromItems(items: readonly ChecklistItem[]): TemplateDraftItem[] {
  return [...items]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((i) => ({ key: `i${i.id}`, id: i.id, text: i.body }))
}

/** Move the item at `index` by `delta` places (-1 up, +1 down); the list is returned as is at the edges. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

/** Unsaved changes: another order, another text, an added or a removed item. */
export function isTemplateChanged(saved: readonly ChecklistItem[], draft: readonly TemplateDraftItem[]): boolean {
  const base = draftFromItems(saved)
  if (base.length !== draft.length) return true
  return base.some((b, i) => b.id !== draft[i].id || b.text !== draft[i].text.trim())
}

// ---- inspection form ----

export interface ResultDraft {
  itemId: number
  /** null = not answered yet. */
  ok: boolean | null
  note: string
}

export function emptyResults(items: readonly ChecklistItem[]): ResultDraft[] {
  return items.map((i) => ({ itemId: i.id, ok: null, note: '' }))
}

export function answeredAll(results: readonly ResultDraft[]): boolean {
  return results.length > 0 && results.every((r) => r.ok !== null)
}

export function failedCount(results: readonly ResultDraft[]): number {
  return results.filter((r) => r.ok === false).length
}

export function noteTooLong(note: string): boolean {
  return note.trim().length > NOTE_MAX
}

/** The `p_results` argument of inspection_create; photos are paths already uploaded. */
export function buildResults(
  results: readonly ResultDraft[],
  photosByItem: ReadonlyMap<number, readonly string[]>,
): Array<{ item_id: number; ok: boolean; note: string; photos: string[] }> {
  return results.map((r) => ({
    item_id: r.itemId,
    ok: r.ok === true,
    note: r.note.trim(),
    photos: [...(photosByItem.get(r.itemId) ?? [])],
  }))
}

// ---- re-check of a failed item ----

export type RecheckError = 'choose' | 'note' | 'noteLong'

/** "Not fixed" needs a reason; "fixed" may have a comment. */
export function validateRecheck(ok: boolean | null, note: string): RecheckError | null {
  if (ok === null) return 'choose'
  const n = note.trim()
  if (n.length > NOTE_MAX) return 'noteLong'
  if (!ok && n === '') return 'note'
  return null
}

/** The item failed, nobody has checked it again, and the rework task is done (or was deleted). */
export function canRecheck(item: Pick<InspectionItem, 'ok' | 'resolved_at'>, taskStatus: TaskStatus | null): boolean {
  if (item.ok || item.resolved_at !== null) return false
  return taskStatus === null || taskStatus === 'done'
}

export interface ReworkEntry {
  inspection: Inspection
  item: InspectionItem
}

/** Failed items nobody has closed yet, the newest inspection first. */
export function openReworkItems(inspections: readonly Inspection[]): ReworkEntry[] {
  const out: ReworkEntry[] = []
  for (const inspection of inspections) {
    for (const item of inspection.items) if (!item.ok && item.resolved_at === null) out.push({ inspection, item })
  }
  return out.sort((a, b) => b.inspection.inspected_at.localeCompare(a.inspection.inspected_at) || a.item.position - b.item.position)
}

// ---- which cleanings still wait for an inspection ----

/** Valid cleanings (not reversed, not rejected) without an inspection, the newest first. */
export function cleaningsToInspect(
  cleanings: readonly CleaningFeedRow[],
  inspections: ReadonlyArray<Pick<Inspection, 'cleaning_event_id'>>,
): CleaningFeedRow[] {
  const done = new Set(inspections.map((i) => i.cleaning_event_id))
  return cleanings
    .filter((c) => {
      const s = cleaningState(c)
      return (s === 'pending' || s === 'posted') && !done.has(c.id)
    })
    .sort((a, b) => b.cleaned_at.localeCompare(a.cleaned_at))
}

// ---- where the screens live in each area ----

export type Area = 'admin' | 'manager' | 'sv'

export function areaOf(pathname: string): Area {
  if (pathname.startsWith('/manager')) return 'manager'
  if (pathname.startsWith('/sv')) return 'sv'
  return 'admin'
}

export function inspectionsPath(area: Area): string {
  return area === 'admin' ? '/admin/more/inspections' : area === 'manager' ? '/manager/inspections' : '/sv/inspections'
}

export function templatesPath(area: Area): string {
  return `${inspectionsPath(area)}/templates`
}

export function tasksPath(area: Area): string {
  return area === 'admin' ? '/admin/more/tasks' : area === 'manager' ? '/manager/tasks' : '/sv/tasks'
}
