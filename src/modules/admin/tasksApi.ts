import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import { parseTask, type Task, type TaskKind, type TaskStatus } from './tasksModel'

const COLUMNS = 'id,apartment_id,task_date,kind,body,due_date,status,created_by_name,created_at,accepted_by_name,accepted_at,done_by_name,done_at'

/** All tasks the person may read (admin, manager, supervisor): the newest 500. */
export async function fetchTasks(): Promise<Task[]> {
  const { data, error, status } = await supabase.from('tasks').select(COLUMNS).order('id', { ascending: false }).limit(500)
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r) => parseTask(r as Record<string, unknown>)).filter((t): t is Task => t !== null)
}

export interface CreateTaskArgs {
  apartmentId: number | null
  date: string
  kind: TaskKind
  body: string
  due: string
}

/** Manager and admin only (checked by the database). */
export async function createTask(a: CreateTaskArgs): Promise<void> {
  const { error, status } = await supabase.rpc('task_create', {
    p_apartment: a.apartmentId,
    p_date: a.date,
    p_kind: a.kind,
    p_body: a.body.trim(),
    p_due: a.due === '' ? null : a.due,
  })
  if (error) throw toApiError(error, status)
}

export async function setTaskStatus(id: number, next: TaskStatus): Promise<void> {
  const { error, status } = await supabase.rpc('task_set_status', { p_id: id, p_status: next })
  if (error) throw toApiError(error, status)
}

export async function deleteTask(id: number): Promise<void> {
  const { error, status } = await supabase.rpc('task_delete', { p_id: id })
  if (error) throw toApiError(error, status)
}
