import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ClipboardCheck, Settings2, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { friendlyMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { useLiveRefresh } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { useAuth } from '@/modules/core/store'
import { MediaViewer } from '@/modules/history/MediaViewer'
import type { AptType } from '@/lib/database.types'
import { fetchApartmentsAdmin, fetchCleaningFeed } from './api'
import { fetchTasks } from './tasksApi'
import type { Task, TaskRole, TaskStatus } from './tasksModel'
import {
  deleteInspection, fetchChecklistItems, fetchInspections, INSPECTION_BUCKET,
} from './checklistsApi'
import {
  areaOf, canDeleteInspection, canEditTemplate, canRecheck, cleaningsToInspect, openReworkItems, tasksPath, templatesPath,
  type ChecklistItem, type Inspection, type ReworkEntry,
} from './checklistsModel'
import type { CleaningFeedRow } from './cleaningFeed'
import { InspectionFormModal } from './InspectionFormModal'
import { RecheckModal } from './RecheckModal'

type Tab = 'todo' | 'rework' | 'done'
const TABS: readonly Tab[] = ['todo', 'rework', 'done']
const DAYS_BACK = 14

interface Apt { id: number; code: string; type: AptType }

/** Inspections of cleanings: what waits for a check, the failed items that wait for rework or a second look, and the checks made. */
export function InspectionsPage() {
  const { t, n } = useI18n()
  const p = t.inspections
  const { pathname } = useLocation()
  const area = areaOf(pathname)
  const role = useAuth((s) => s.profile?.role) as TaskRole | undefined
  const [tab, setTab] = useState<Tab>('todo')
  const [apts, setApts] = useState<Map<number, Apt>>(new Map())
  const [cleanings, setCleanings] = useState<CleaningFeedRow[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [template, setTemplate] = useState<ChecklistItem[]>([])
  const [tasks, setTasks] = useState<Map<number, Task>>(new Map())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [inspecting, setInspecting] = useState<CleaningFeedRow | null>(null)
  const [rechecking, setRechecking] = useState<ReworkEntry | null>(null)
  const [toDelete, setToDelete] = useState<Inspection | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [viewer, setViewer] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setFailed(false)
    try {
      const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString()
      const [a, c, i, tpl, tk] = await Promise.all([
        fetchApartmentsAdmin(), fetchCleaningFeed(since), fetchInspections(), fetchChecklistItems(), fetchTasks(),
      ])
      setApts(new Map(a.map((x) => [x.id, { id: x.id, code: x.code, type: x.type }])))
      setCleanings(c)
      setInspections(i)
      setTemplate(tpl)
      setTasks(new Map(tk.map((x) => [x.id, x])))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(['inspections', 'inspection_items', 'tasks', 'cleaning_events'], () => { void load(true) })

  const todo = useMemo(() => cleaningsToInspect(cleanings, inspections), [cleanings, inspections])
  const rework = useMemo(() => openReworkItems(inspections), [inspections])
  const typesWithTemplate = useMemo(() => new Set(template.map((i) => i.apt_type)), [template])

  if (!role) return null
  const code = (id: number) => apts.get(id)?.code ?? `#${n(String(id))}`
  const taskStatus = (id: number | null): TaskStatus | null => (id === null ? null : tasks.get(id)?.status ?? null)
  const statusName: Record<TaskStatus, string> = { new: t.tasks.statusNew, accepted: t.tasks.statusAccepted, done: t.tasks.statusDone, verified: t.tasks.statusVerified }
  const tabName: Record<Tab, string> = { todo: p.tabTodo, rework: p.tabRework, done: p.tabDone }
  const tabCount: Record<Tab, number> = { todo: todo.length, rework: rework.length, done: inspections.length }
  const btn = 'rounded-xl px-4 min-h-[44px] text-sm font-medium disabled:opacity-60 inline-flex items-center justify-center gap-2'

  const remove = async () => {
    if (!toDelete) return
    const insp = toDelete
    setToDelete(null)
    setBusy(true)
    try {
      await deleteInspection(insp.id)
      toast(p.deleted, 'success')
      await load(true)
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const photoButton = (paths: string[]) =>
    paths.length > 0 ? (
      <button type="button" onClick={() => setViewer(paths)} className="text-xs text-accent underline min-h-[44px] px-1">
        {p.photos}: {n(String(paths.length))}
      </button>
    ) : null

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto pb-28">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h1 className="text-lg font-semibold text-ink me-auto">{p.title}</h1>
        <NavLink to={tasksPath(area)} className={`${btn} well text-ink`}>{p.tasksLink}</NavLink>
        {canEditTemplate(role) && (
          <NavLink to={templatesPath(area)} className={`${btn} well text-accent`}>
            <Settings2 className="w-4 h-4" />{p.templates}
          </NavLink>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap" role="tablist" aria-label={p.title}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)}
            className={`rounded-xl px-4 min-h-[44px] text-sm ${tab === x ? 'bg-accent-soft text-accent font-semibold' : 'well text-muted'}`}>
            {tabName[x]} <span className="text-xs">{n(String(tabCount[x]))}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted">{p.loading}</p>
      ) : failed ? (
        <div className="tile rounded-[20px] p-4">
          <p className="text-sm text-bad mb-2" role="alert">{p.loadFailed}</p>
          <button type="button" onClick={() => void load()} className={`${btn} well text-ink`}>{p.retry}</button>
        </div>
      ) : tab === 'todo' ? (
        todo.length === 0 ? <p className="text-sm text-muted">{p.emptyTodo}</p> : (
          <ul className="space-y-3">
            {todo.map((c) => {
              const apt = apts.get(c.apartment_id)
              const hasTemplate = apt ? typesWithTemplate.has(apt.type) : false
              return (
                <li key={c.id} className="tile rounded-[20px] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <b className="text-sm text-ink">{code(c.apartment_id)}</b>
                    <span className="text-xs text-muted ms-auto">{formatDateTime(c.cleaned_at)}</span>
                  </div>
                  <p className="text-xs text-muted">{p.cleaners}: {c.staff_names.length > 0 ? c.staff_names.join(', ') : p.noCleaners}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" disabled={!hasTemplate || busy} onClick={() => setInspecting(c)} className={`${btn} bg-accent text-on-accent`} data-testid="inspect-button">
                      <ClipboardCheck className="w-4 h-4" />{p.inspect}
                    </button>
                    {!hasTemplate && <span className="text-xs text-warn">{p.noTemplate}</span>}
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : tab === 'rework' ? (
        rework.length === 0 ? <p className="text-sm text-muted">{p.emptyRework}</p> : (
          <ul className="space-y-3">
            {rework.map((e) => {
              const status = taskStatus(e.item.task_id)
              const ready = canRecheck(e.item, status)
              return (
                <li key={e.item.id} className="tile rounded-[20px] p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <b className="text-sm text-ink">{code(e.inspection.apartment_id)}</b>
                    <span className="text-xs text-muted ms-auto">{formatDate(e.inspection.inspected_at)}</span>
                  </div>
                  <p className="text-sm text-ink">{e.item.body}</p>
                  {e.item.note && <p className="text-xs text-muted">{e.item.note}</p>}
                  {e.item.recheck_count > 0 && (
                    <p className="text-xs text-warn mt-1">{p.recheckCount}: {n(String(e.item.recheck_count))}{e.item.recheck_note ? ` · ${e.item.recheck_note}` : ''}</p>
                  )}
                  <p className="text-xs text-muted mt-1">
                    {p.taskStatus}: {status ? statusName[status] : p.taskGone}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!ready || busy} onClick={() => setRechecking(e)} className={`${btn} bg-accent text-on-accent`}>{p.recheck}</button>
                    {!ready && <span className="text-xs text-muted">{p.waitingTask}</span>}
                    {photoButton(e.item.photo_paths)}
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : inspections.length === 0 ? (
        <p className="text-sm text-muted">{p.emptyDone}</p>
      ) : (
        <ul className="space-y-3">
          {inspections.map((i) => {
            const open = openId === i.id
            const bad = i.items.filter((x) => !x.ok).length
            return (
              <li key={i.id} className="tile rounded-[20px] p-4">
                <button type="button" onClick={() => setOpenId(open ? null : i.id)} aria-expanded={open} className="w-full text-start min-h-[44px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm text-ink">{code(i.apartment_id)}</b>
                    <span className={`text-xs font-medium rounded-md px-2 py-0.5 ${i.status === 'passed' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
                      {i.status === 'passed' ? p.resultPassed : p.resultRework}
                    </span>
                    <span className="text-xs text-muted ms-auto">{formatDateTime(i.inspected_at)}</span>
                  </div>
                  <p className="text-xs text-muted mt-1">{p.inspector}: {i.inspector_name ?? '—'} · {p.itemNotOk}: {n(String(bad))}/{n(String(i.items.length))}</p>
                </button>
                {open && (
                  <div className="mt-3 border-t border-line pt-3">
                    <ul className="space-y-2">
                      {i.items.map((x) => (
                        <li key={x.id} className="text-sm">
                          <span className={x.ok ? 'text-ok' : x.resolved_at ? 'text-ok' : 'text-bad'}>{x.ok ? '✓' : x.resolved_at ? '✓' : '✗'}</span>{' '}
                          <span className="text-ink">{x.body}</span>
                          {x.note && <span className="text-xs text-muted"> · {x.note}</span>}
                          {photoButton(x.photo_paths)}
                          {!x.ok && x.resolved_at && <p className="text-xs text-ok ps-5">{p.fixed}: {x.resolved_by_name ?? '—'}, {formatDate(x.resolved_at)}</p>}
                        </li>
                      ))}
                    </ul>
                    {canDeleteInspection(role) && (
                      <button type="button" disabled={busy} onClick={() => setToDelete(i)} className="mt-3 min-h-[44px] px-3 rounded-xl text-sm text-muted hover:text-bad inline-flex items-center gap-2 disabled:opacity-60">
                        <Trash2 className="w-4 h-4" />{p.delete}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {inspecting && (
        <InspectionFormModal
          cleaning={inspecting}
          apartmentCode={code(inspecting.apartment_id)}
          template={template.filter((i) => i.apt_type === apts.get(inspecting.apartment_id)?.type)}
          onClose={() => setInspecting(null)}
          onDone={() => { setInspecting(null); void load(true) }}
        />
      )}
      {rechecking && (
        <RecheckModal
          entry={rechecking}
          apartmentCode={code(rechecking.inspection.apartment_id)}
          onClose={() => setRechecking(null)}
          onDone={() => { setRechecking(null); void load(true) }}
        />
      )}
      {viewer && <MediaViewer bucket={INSPECTION_BUCKET} paths={viewer} onClose={() => setViewer(null)} />}
      <ConfirmDialog open={toDelete !== null} title={p.deleteTitle} message={p.deleteMessage} confirmLabel={p.delete} cancelLabel={p.cancel} onConfirm={() => void remove()} onCancel={() => setToDelete(null)} />
    </div>
  )
}
