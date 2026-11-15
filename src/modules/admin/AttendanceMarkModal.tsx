import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { errorMessage, toast } from '@/lib/toast'
import { formatDateTime } from '@/lib/format'
import { markAttendance, clearAttendance } from './attendanceApi'
import {
  DEFAULT_LUNCH_MINUTES, QUICK_HOURS, QUICK_LUNCH_MINUTES, formatHours, hoursBetweenClock, hoursToSend, minutesBetweenClock, parseClock, parseHours, parseLunch, validateMark,
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
  // Came / left: an aid to fill the hours (the mark stores the hours only)
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [lunchText, setLunchText] = useState(String(DEFAULT_LUNCH_MINUTES))
  const [sharesPool, setSharesPool] = useState(existing?.shares_pool ?? true)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const kindLabel: Record<AttendanceKind, string> = { work: a.kindWork, weekend: a.kindWeekend, leave: a.kindLeave }
  // Net hours: the time at work minus the lunch break (a working day is 8 net hours)
  const lunch = parseLunch(lunchText)
  const grossMinutes = minutesBetweenClock(fromText, toText)
  const timesHours = lunch === null ? null : hoursBetweenClock(fromText, toText, lunch)
  const timesFilled = fromText.trim() !== '' && toText.trim() !== ''
  const timeSyntaxBad = (fromText.trim() !== '' && parseClock(fromText) === null) || (toText.trim() !== '' && parseClock(toText) === null) || (timesFilled && grossMinutes === null)
  const lunchBad = lunch === null
  const lunchTooLong = !timeSyntaxBad && !lunchBad && timesFilled && grossMinutes !== null && timesHours === null

  const onTimes = (nextFrom: string, nextTo: string, nextLunch: string = lunchText) => {
    setFromText(nextFrom)
    setToText(nextTo)
    setLunchText(nextLunch)
    const l = parseLunch(nextLunch)
    const h = l === null ? null : hoursBetweenClock(nextFrom, nextTo, l)
    if (h !== null) setHoursText(formatHours(h))
  }
  // Hours set by hand or by a quick button: the times typed before no longer explain them
  const onHours = (text: string) => {
    setHoursText(text)
    setFromText('')
    setToText('')
  }

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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted mb-1.5" htmlFor="att-from">{a.timeFrom}</label>
                  <input id="att-from" inputMode="decimal" placeholder="08:00" value={fromText} onChange={(e) => onTimes(e.target.value, toText)} aria-invalid={timeSyntaxBad} className="well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm" data-testid="att-from" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1.5" htmlFor="att-to">{a.timeTo}</label>
                  <input id="att-to" inputMode="decimal" placeholder="17:00" value={toText} onChange={(e) => onTimes(fromText, e.target.value)} aria-invalid={timeSyntaxBad} className="well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm" data-testid="att-to" />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-muted mb-1.5" htmlFor="att-lunch">{a.lunchLabel}</label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_LUNCH_MINUTES.map((m) => (
                    <button key={m} type="button" onClick={() => onTimes(fromText, toText, String(m))} className={`min-w-[48px] min-h-[44px] rounded-xl px-3 text-sm font-medium ${lunch === m ? 'bg-accent-soft text-accent' : 'well text-ink'}`}>{m}</button>
                  ))}
                  <input id="att-lunch" inputMode="numeric" value={lunchText} onChange={(e) => onTimes(fromText, toText, e.target.value)} aria-invalid={lunchBad} className="well w-20 rounded-xl px-3 min-h-[44px] text-ink text-sm" data-testid="att-lunch" />
                </div>
              </div>
              {timeSyntaxBad ? (
                <p className="text-xs text-bad mt-1.5" role="alert">{a.timeInvalid}</p>
              ) : lunchBad ? (
                <p className="text-xs text-bad mt-1.5" role="alert">{a.lunchInvalid}</p>
              ) : lunchTooLong ? (
                <p className="text-xs text-bad mt-1.5" role="alert">{a.lunchTooLong}</p>
              ) : timesHours !== null && grossMinutes !== null ? (
                <p className="text-xs text-ok mt-1.5">{a.timeResult}: {formatHours(timesHours)} ({a.timeAtWork} {formatHours(Math.round((grossMinutes / 60) * 100) / 100)}, {a.lunchShort} {lunch})</p>
              ) : (
                <p className="text-xs text-muted mt-1.5">{a.timeHint}</p>
              )}
              <label className="block text-xs text-muted mt-3 mb-1.5" htmlFor="att-hours">{a.hoursLabel}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onHours(String(h))}
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
                onChange={(e) => onHours(e.target.value)}
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
