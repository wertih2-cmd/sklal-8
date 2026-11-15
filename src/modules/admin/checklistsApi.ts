import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import type { AptType } from '@/lib/database.types'
import {
  parseChecklistItem, parseInspection, type ChecklistItem, type Inspection,
} from './checklistsModel'

const BUCKET = 'cleaning-media'

const INSPECTION_COLUMNS =
  'id,cleaning_event_id,apartment_id,status,inspector_name,inspected_at,' +
  'inspection_items(id,inspection_id,position,body,ok,note,photo_paths,task_id,resolved_at,resolved_by_name,recheck_note,recheck_count,recheck_photo_paths)'

/** Every item of every template (a few dozen rows). Readable by the admin and the supervisors (the manager included). */
export async function fetchChecklistItems(): Promise<ChecklistItem[]> {
  const { data, error, status } = await supabase
    .from('checklist_items')
    .select('id,apt_type,position,body')
    .order('apt_type')
    .order('position')
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r) => parseChecklistItem(r as Record<string, unknown>)).filter((x): x is ChecklistItem => x !== null)
}

/** Manager and admin only (checked by the database). Items with an id keep it; the ones not listed are deleted. */
export async function saveChecklist(type: AptType, items: Array<{ id?: number; text: string }>): Promise<void> {
  const { error, status } = await supabase.rpc('checklist_save', { p_type: type, p_items: items })
  if (error) throw toApiError(error, status)
}

/** The newest 200 inspections with their items. */
export async function fetchInspections(): Promise<Inspection[]> {
  const { data, error, status } = await supabase
    .from('inspections')
    .select(INSPECTION_COLUMNS)
    .order('inspected_at', { ascending: false })
    .limit(200)
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r) => parseInspection(r as unknown as Record<string, unknown>)).filter((x): x is Inspection => x !== null)
}

export interface InspectionResultArg {
  item_id: number
  ok: boolean
  note: string
  photos: string[]
}

export interface InspectionCreated {
  id: number
  failed: number
}

export async function createInspection(eventId: string, results: InspectionResultArg[]): Promise<InspectionCreated> {
  const { data, error, status } = await supabase.rpc('inspection_create', { p_event: eventId, p_results: results })
  if (error) throw toApiError(error, status)
  const d = (data ?? {}) as { id?: number; failed?: number }
  return { id: Number(d.id ?? 0), failed: Number(d.failed ?? 0) }
}

export async function recheckInspectionItem(itemId: number, ok: boolean, note: string, photos: string[]): Promise<void> {
  const { error, status } = await supabase.rpc('inspection_recheck', {
    p_item: itemId,
    p_ok: ok,
    p_note: note.trim() === '' ? null : note.trim(),
    p_photos: photos,
  })
  if (error) throw toApiError(error, status)
}

export async function deleteInspection(id: number): Promise<void> {
  const { error, status } = await supabase.rpc('inspection_delete', { p_id: id })
  if (error) throw toApiError(error, status)
}

/** A photo goes into the existing cleaning-media bucket, into the folder of the person: the database accepts no other path. */
export async function uploadInspectionPhoto(userId: string, blob: Blob): Promise<string> {
  const path = `${userId}/inspections/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw toApiError(error)
  return path
}

export const INSPECTION_BUCKET = BUCKET
