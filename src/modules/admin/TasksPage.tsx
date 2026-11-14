import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageCircle, Plus, Trash2, Undo2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { friendlyMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { useLiveRefresh } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { whatsappUrl } from '@/lib/whatsappNotify'
import { useAuth } from '@/modules/core/store'
import { fetchApartmentsAdmin } from './api'
import { cairoToday } from './attendanceModel'
import { TaskFormModal } from './TaskFormModal'
import { deleteTask, fetchTasks, setTaskStatus } from './tasksApi'
import {
  canCreateTask, canDeleteTask, countOpen, filterTasks, isOverdue, nextStatus, prevStatus, sortTasks, taskWhatsappText,
  type Task, type TaskFilter, type TaskKind, type TaskRole, type TaskStatus,
} from './tasksModel'

const FILTERS: readonly TaskFilter[] = ['active', 'done', 'all']

/** Tasks of the manager for the supervisors. Everybody sees all tasks; the supervisor accepts and completes, the manager creates, sends, steps back and deletes. */
export function TasksPage() {
  const { t } = useI18n()
  const k = t.tasks
  const role = useAuth((s) => s.profile?.role) as TaskRole | undefined
  const [tasks, setTasks] = useState<Task[]>([])
  const [codes, setCodes] = useState<ReadonlyMap<number, string>>(new Map())
  const [apartments, setApartments] = useState<Array<{ id: number; code: string }>>([])
  const [filter, setFilter] = useState<TaskFilter>('active')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [toDelete, setToDelete] = useState<Task | null>(null)
  const today = cairoToday()

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setFailed(false)
    try {
      const [list, apts] = await Promise.all([fetchTasks(), fetchApartmentsAdmin()])
      setTasks(list)
      setApartments(apts.map((a) => ({ id: a.id, code: a.code })))
      setCodes(new Map(apts.map((a) => [a.id, a.code])))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(['tasks'], () => { void load(true) })

  const shown = useMemo(() => sortTasks(filterTasks(tasks, filter), today), [tasks, filter, today])
  if (!role) return null

  const kindName: Record<TaskKind, string> = { cleaning: k.kindCleaning, inspection: k.kindInspection, other: k.kindOther }
  const statusName: Record<TaskStatus, string> = { new: k.statusNew, accepted: k.statusAccepted, done: k.statusDone }
  const filterName: Record<TaskFilter, string> = { active: k.filterActive, done: k.filterDone, all: k.filterAll }
  const stepName: Record<TaskStatus, string> = { new: k.back, accepted: k.accept, done: k.complete }
  const labels = { title: k.messageTitle, apartment: k.fieldApartment, date: k.fieldDate, due: k.fieldDue, kindName }

  const change = async (task: Task, next: TaskStatus) => {
    setBusyId(task.id)
    try {
      await setTaskStatus(task.id, next)
      await load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    const task = toDelete
    setToDelete(null)
    setBusyId(task.id)
    try {
      await deleteTask(task.id)
      toast(k.deleted, 'success')
      await load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const btn = 'rounded-xl px-4 min-h-[44px] text-sm font-medium disabled:opacity-60 inline-flex items-center justify-center gap-2'

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto pb-28">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{k.title}</h1>
          <p className="text-xs text-muted">{k.openCount}: {countOpen(tasks)}</p>
        </div>
        {canCreateTask(role) && (
          <button type="button" onClick={() => setCreating(true)} className={`${btn} bg-accent text-on-accent`}>
            <Plus className="w-4 h-4" />{k.newTask}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4" role="tablist" aria-label={k.title}>
        {FILTERS.map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`rounded-xl px-4 min-h-[44px] text-sm ${filter === f ? 'bg-accent-soft text-accent font-semibold' : 'well text-muted'}`}>
            {filterName[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted">{k.loading}</p>
      ) : failed ? (
        <div className="tile rounded-[20px] p-4">
          <p className="text-sm text-bad mb-2" role="alert">{k.loadFailed}</p>
          <button type="button" onClick={() => void load()} className={`${btn} well text-ink`}>{k.retry}</button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{k.empty}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((task) => {
            const next = nextStatus(task)
            const prev = prevStatus(role, task)
            const code = task.apartment_id === null ? null : (codes.get(task.apartment_id) ?? `#${task.apartment_id}`)
            const overdue = isOverdue(task, today)
            const busy = busyId === task.id
            return (
              <li key={task.id} className="tile rounded-[20px] p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-medium rounded-md px-2 py-0.5 bg-accent-soft text-accent">{kindName[task.kind]}</span>
                  <span className={`text-xs ${task.status === 'done' ? 'text-ok' : 'text-muted'}`}>{statusName[task.status]}</span>
                  {overdue && <span className="text-xs font-medium rounded-md px-2 py-0.5 bg-bad-soft text-bad">{k.overdue}</span>}
                  {code && <b className="text-sm text-ink ms-auto">{code}</b>}
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap break-words mb-2">{task.body}</p>
                <p className="text-xs text-muted">
                  {k.fieldDate}: {formatDate(task.task_date)}
                  {task.due_date && <> · {k.fieldDue}: {formatDate(task.due_date)}</>}
                </p>
                <p className="text-xs text-muted">{k.createdBy}: {task.created_by_name ?? '—'}</p>
                {task.accepted_at && <p className="text-xs text-muted">{k.acceptedBy}: {task.accepted_by_name ?? '—'}, {formatDateTime(task.accepted_at)}</p>}
                {task.done_at && <p className="text-xs text-muted">{k.doneBy}: {task.done_by_name ?? '—'}, {formatDateTime(task.done_at)}</p>}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {next && (
                    <button type="button" disabled={busy} onClick={() => void change(task, next)} className={`${btn} bg-accent text-on-accent`}>{stepName[next]}</button>
                  )}
                  {prev && (
                    <button type="button" disabled={busy} onClick={() => void change(task, prev)} className={`${btn} well text-ink`}>
                      <Undo2 className="w-4 h-4" />{k.back}
                    </button>
                  )}
                  {canCreateTask(role) && task.status !== 'done' && (
                    <a href={whatsappUrl('', taskWhatsappText(task, code, labels, formatDate))} target="_blank" rel="noopener noreferrer" className={`${btn} bg-ok text-on-accent`}>
                      <MessageCircle className="w-4 h-4" />{k.sendWhatsapp}
                    </a>
                  )}
                  {canDeleteTask(role, task) && (
                    <button type="button" disabled={busy} aria-label={k.delete} onClick={() => setToDelete(task)} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-bad ms-auto disabled:opacity-60">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {creating && (
        <TaskFormModal apartments={apartments} today={today} onClose={() => setCreating(false)} onDone={() => { setCreating(false); void load(true) }} />
      )}
      <ConfirmDialog open={toDelete !== null} title={k.deleteTitle} message={k.deleteMessage} confirmLabel={k.delete} cancelLabel={k.cancel} onConfirm={() => void remove()} onCancel={() => setToDelete(null)} />
    </div>
  )
}
