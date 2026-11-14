import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/format'
import { markAttendance, clearAttendance } from './attendanceApi'
import {
  QUICK_HOURS, formatHours, hoursToSend, parseHours, validateMark,
  type AttendanceKind, type AttendanceRow,
} from './attendanceModel'

const KINDS: readonly AttendanceKind[] = ['work', 'weekend', 'leave']

interface Conflict {
  action: 'save' | 'clear'
  markedByName: string | null
  markedAt: string | null
}

/** One cell of the timesheet: the kind of the day, the hours, whether the day shares the pool premium, a note. */
export function AttendanceMarkModal({ staffId, staffName, day, existing, onClose, onDone }: {
  staffId: number
  staffName: string
  day: string
  existing: AttendanceRow | undefined
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const a = t.admin.attendance
  const [kind, setKind] = useState<AttendanceKind>(existing?.kind ?? 'work')
  const [hoursText, setHoursText] = useState(existing && existing.kind !== 'leave' ? formatHours(existing.hours) : '8')
  const [sharesPool, setSharesPool] = useState(existing?.shares_pool ?? true)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const kindLabel: Record<AttendanceKind, string> = { work: a.kindWork, weekend: a.kindWeekend, leave: a.kindLeave }

  const run = async (action: 'save' | 'clear', force: boolean) => {
    const hours = parseHours(hoursText)
    if (action === 'save' && validateMark({ kind, hours: kind === 'leave' ? 0 : hours })) {
      setError(a.hoursInvalid)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const outcome = action === 'save'
        ? await markAttendance({ day, staffId, kind, hours: hoursToSend({ kind, hours }), sharesPool, note, force })
        : await clearAttendance(day, staffId, force)
      if (outcome.status === 'conflict') {
        setConflict({ action, markedByName: outcome.markedByName, markedAt: outcome.markedAt })
        return
      }
      toast(t.common.saved, 'success')
      onDone()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const conflictMessage = conflict
    ? `${a.conflictText}: ${conflict.markedByName ?? '—'}${conflict.markedAt ? `, ${formatDateTime(conflict.markedAt)}` : ''}. ${conflict.action === 'save' ? a.conflictAskSave : a.conflictAskClear}`
    : undefined

  return (
    <>
      <Modal open title={`${staffName} · ${day}`} onClose={onClose} size="sm" closeOnBackdrop={false}>
        <div className="space-y-4">
          <div className="flex gap-1.5" role="group" aria-label={a.kindLabel}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`flex-1 min-h-[44px] rounded-xl px-2 text-sm font-medium ${kind === k ? 'bg-accent text-on-accent' : 'well text-muted'}`}
              >
                {kindLabel[k]}
              </button>
            ))}
          </div>

          {kind !== 'leave' && (
            <div>
              <label className="block text-xs text-muted mb-1.5" htmlFor="att-hours">{a.hoursLabel}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHoursText(String(h))}
                    className={`min-w-[48px] min-h-[44px] rounded-xl px-3 text-sm font-medium ${parseHours(hoursText) === h ? 'bg-accent-soft text-accent' : 'well text-ink'}`}
                  >
                    {h}
                  </button>
                ))}
              </div>
              <input
                id="att-hours"
                inputMode="decimal"
                value={hoursText}
                onChange={(e) => setHoursText(e.target.value)}
                className="well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm"
              />
            </div>
          )}

          {kind !== 'leave' && (
            <label className="flex items-start gap-2.5 text-sm text-ink">
              <input type="checkbox" checked={sharesPool} onChange={(e) => setSharesPool(e.target.checked)} className="mt-1" />
              <span>{a.sharesPool}<span className="block text-xs text-muted">{a.sharesPoolNote}</span></span>
            </label>
          )}

          <div>
            <label className="block text-xs text-muted mb-1.5" htmlFor="att-note">{a.noteLabel}</label>
            <input
              id="att-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              className="well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm"
            />
          </div>

          {existing?.marked_by_name && (
            <p className="text-xs text-muted">{a.markedBy}: {existing.marked_by_name}, {formatDateTime(existing.marked_at)}</p>
          )}
          {error && <p className="text-bad text-sm" role="alert">{error}</p>}

          <div className="flex flex-wrap gap-2 justify-end">
            {existing && (
              <button type="button" disabled={busy} onClick={() => void run('clear', false)} className="well rounded-xl px-4 min-h-[44px] text-sm text-bad me-auto">
                {a.clear}
              </button>
            )}
            <button type="button" disabled={busy} onClick={onClose} className="well rounded-xl px-4 min-h-[44px] text-sm text-ink">{a.cancel}</button>
            <button type="button" disabled={busy} onClick={() => void run('save', false)} className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">
              {a.save}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={conflict !== null}
        tone="warn"
        title={a.conflictTitle}
        message={conflictMessage}
        confirmLabel={a.replace}
        onCancel={() => setConflict(null)}
        onConfirm={() => {
          const action = conflict?.action ?? 'save'
          setConflict(null)
          void run(action, true)
        }}
      />
    </>
  )
}
