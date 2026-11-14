export type TaskKind = 'cleaning' | 'inspection' | 'other'
export type TaskStatus = 'new' | 'accepted' | 'done'
export type TaskRole = 'admin' | 'manager' | 'supervisor'
export type TaskFilter = 'active' | 'done' | 'all'

export const TASK_KINDS: readonly TaskKind[] = ['cleaning', 'inspection', 'other']
export const TASK_BODY_MAX = 2000

export interface Task {
  id: number
  apartment_id: number | null
  task_date: string
  kind: TaskKind
  body: string
  due_date: string | null
  status: TaskStatus
  created_by_name: string | null
  created_at: string
  accepted_by_name: string | null
  accepted_at: string | null
  done_by_name: string | null
  done_at: string | null
}

const KINDS = new Set<string>(TASK_KINDS)
const STATUSES = new Set<string>(['new', 'accepted', 'done'])

/** A row of the table into a task; null when the row is not a task (a wrong kind or status). */
export function parseTask(r: Record<string, unknown>): Task | null {
  if (typeof r.id !== 'number' && typeof r.id !== 'string') return null
  if (!KINDS.has(String(r.kind)) || !STATUSES.has(String(r.status))) return null
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  return {
    id: Number(r.id),
    apartment_id: r.apartment_id === null || r.apartment_id === undefined ? null : Number(r.apartment_id),
    task_date: String(r.task_date),
    kind: r.kind as TaskKind,
    body: String(r.body ?? ''),
    due_date: s(r.due_date),
    status: r.status as TaskStatus,
    created_by_name: s(r.created_by_name),
    created_at: String(r.created_at ?? ''),
    accepted_by_name: s(r.accepted_by_name),
    accepted_at: s(r.accepted_at),
    done_by_name: s(r.done_by_name),
    done_at: s(r.done_at),
  }
}

/** Not done and past its due date (days compared as YYYY-MM-DD, Cairo today). */
export function isOverdue(t: Task, today: string): boolean {
  return t.status !== 'done' && t.due_date !== null && t.due_date < today
}

export function filterTasks(list: readonly Task[], f: TaskFilter): Task[] {
  if (f === 'all') return [...list]
  return list.filter((t) => (f === 'done' ? t.status === 'done' : t.status !== 'done'))
}

/** Open tasks first: overdue, then by due date (no due date last), newest first; done tasks after them, newest first. */
export function sortTasks(list: readonly Task[], today: string): Task[] {
  const rank = (t: Task) => (t.status === 'done' ? 2 : isOverdue(t, today) ? 0 : 1)
  return [...list].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra !== 2 && a.due_date !== b.due_date) {
      if (a.due_date === null) return 1
      if (b.due_date === null) return -1
      return a.due_date < b.due_date ? -1 : 1
    }
    return b.id - a.id
  })
}

export function countOpen(list: readonly Task[]): number {
  return list.filter((t) => t.status !== 'done').length
}

export const canCreateTask = (role: TaskRole) => role === 'admin' || role === 'manager'

/** The next status that supervisor, manager and admin may set: new, then accepted, then done. */
export function nextStatus(t: Task): TaskStatus | null {
  return t.status === 'new' ? 'accepted' : t.status === 'accepted' ? 'done' : null
}

/** Back by one step: the manager and the admin only. */
export function prevStatus(role: TaskRole, t: Task): TaskStatus | null {
  if (role === 'supervisor') return null
  return t.status === 'done' ? 'accepted' : t.status === 'accepted' ? 'new' : null
}

/** The manager deletes only a new task, the admin any. */
export function canDeleteTask(role: TaskRole, t: Task): boolean {
  return role === 'admin' || (role === 'manager' && t.status === 'new')
}

export type TaskFormError = 'body' | 'bodyLong' | 'date' | 'due'

export interface TaskForm {
  kind: TaskKind
  apartmentId: number | null
  date: string
  due: string
  body: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function validateTaskForm(f: TaskForm): TaskFormError | null {
  const body = f.body.trim()
  if (body === '') return 'body'
  if (body.length > TASK_BODY_MAX) return 'bodyLong'
  if (!DAY.test(f.date)) return 'date'
  if (f.due !== '' && (!DAY.test(f.due) || f.due < f.date)) return 'due'
  return null
}

export interface TaskTextLabels {
  title: string
  apartment: string
  date: string
  due: string
  kindName: Record<TaskKind, string>
}

/** The ready message for WhatsApp; the manager presses send there. */
export function taskWhatsappText(t: Task, apartmentCode: string | null, l: TaskTextLabels, formatDay: (iso: string) => string): string {
  return [
    `${l.title}: ${l.kindName[t.kind]}`,
    apartmentCode ? `${l.apartment}: ${apartmentCode}` : null,
    `${l.date}: ${formatDay(t.task_date)}`,
    t.due_date ? `${l.due}: ${formatDay(t.due_date)}` : null,
    '',
    t.body,
  ].filter((x): x is string => x !== null).join('\n')
}
