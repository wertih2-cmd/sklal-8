import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { friendlyMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { createTask } from './tasksApi'
import { TASK_BODY_MAX, TASK_KINDS, validateTaskForm, type TaskFormError, type TaskKind } from './tasksModel'

/** A new task: the manager or the admin. The apartment is optional; the text has no photo. */
export function TaskFormModal({ apartments, today, defaultApartmentId = null, onClose, onDone }: {
  apartments: ReadonlyArray<{ id: number; code: string }>
  today: string
  defaultApartmentId?: number | null
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const k = t.tasks
  const [kind, setKind] = useState<TaskKind>('cleaning')
  const [apartmentId, setApartmentId] = useState<number | null>(defaultApartmentId)
  const [date, setDate] = useState(today)
  const [due, setDue] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<TaskFormError | null>(null)
  const [busy, setBusy] = useState(false)

  const kindName: Record<TaskKind, string> = { cleaning: k.kindCleaning, inspection: k.kindInspection, other: k.kindOther }
  const errorText: Record<TaskFormError, string> = { body: k.errBody, bodyLong: k.errBodyLong, date: k.errDate, due: k.errDue }
  const field = 'well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm mt-1 disabled:opacity-60'

  const submit = async () => {
    const problem = validateTaskForm({ kind, apartmentId, date, due, body })
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      await createTask({ apartmentId, date, kind, body, due })
      toast(k.created, 'success')
      onDone()
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={k.newTask} onClose={() => { if (!busy) onClose() }} size="md" closeOnBackdrop={false}>
      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <label className="block text-sm text-ink">{k.fieldKind}
          <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as TaskKind)} className={field}>
            {TASK_KINDS.map((x) => <option key={x} value={x}>{kindName[x]}</option>)}
          </select>
        </label>
        <label className="block text-sm text-ink">{k.fieldApartment}
          <select value={apartmentId ?? ''} disabled={busy} onChange={(e) => setApartmentId(e.target.value === '' ? null : Number(e.target.value))} className={field}>
            <option value="">{k.noApartment}</option>
            {apartments.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
          </select>
        </label>
        <label className="block text-sm text-ink">{k.fieldDate}
          <input type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="block text-sm text-ink">{k.fieldDue}
          <input type="date" value={due} min={date} disabled={busy} onChange={(e) => setDue(e.target.value)} className={field} />
        </label>
      </div>
      <label className="block text-sm text-ink mb-1">{k.fieldBody}
        <textarea value={body} disabled={busy} rows={5} maxLength={TASK_BODY_MAX} onChange={(e) => setBody(e.target.value)} className={`${field} py-2`} />
      </label>
      <p className="text-xs text-muted mb-3">{body.trim().length} / {TASK_BODY_MAX}</p>
      {error && <p className="text-xs text-bad mb-3" role="alert">{errorText[error]}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="well rounded-xl px-4 min-h-[44px] text-sm text-ink">{k.cancel}</button>
        <button type="button" disabled={busy} onClick={() => void submit()} className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">{k.create}</button>
      </div>
    </Modal>
  )
}
