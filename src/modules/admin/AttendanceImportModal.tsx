import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { friendlyMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { markAttendance } from './attendanceApi'
import { cairoToday, type StaffEntry } from './attendanceModel'
import { importSummary, parseHoursCsv, type ImportReason } from './payrollExtraModel'

/** Admin: writes hours from a CSV through attendance_mark, one row at a time, so every server check applies. A mark made by somebody else is never replaced. */
export function AttendanceImportModal({ staff, onClose, onDone }: {
  staff: readonly StaffEntry[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const a = t.admin.attendance
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: number; conflict: number; failed: number } | null>(null)

  const rows = useMemo(() => parseHoursCsv(text, staff, cairoToday()), [text, staff])
  const sum = importSummary(rows)
  const reason: Record<ImportReason, string> = {
    empty: a.importReasonEmpty, date: a.importReasonDate, future: a.importReasonFuture, staff: a.importReasonStaff,
    hours: a.importReasonHours, duplicate: a.importReasonDup, kind: a.importReasonKind,
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    try { setText(await file.text()); setResult(null) } catch (e) { toast(friendlyMessage(e), 'error') }
  }

  const run = async () => {
    setBusy(true)
    const out = { ok: 0, conflict: 0, failed: 0 }
    for (const r of rows) {
      if (r.status !== 'ok' || r.staffId === null) continue
      try {
        const o = await markAttendance({ day: r.day, staffId: r.staffId, kind: r.kind, hours: r.hours, sharesPool: r.sharesPool, note: '', force: false })
        if (o.status === 'ok') out.ok += 1
        else out.conflict += 1
      } catch {
        out.failed += 1
      }
    }
    setBusy(false)
    setResult(out)
    if (out.ok > 0) onDone()
  }

  return (
    <Modal open title={a.importTitle} onClose={() => { if (!busy) onClose() }} size="lg">
      <p className="text-xs text-muted mb-3">{a.importHelp}</p>
      <label className="well rounded-xl px-4 min-h-[44px] inline-flex items-center text-sm text-ink mb-3 cursor-pointer">
        {a.importPick}
        <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      <label className="block text-sm text-ink mb-3">{a.importPaste}
        <textarea value={text} disabled={busy} onChange={(e) => { setText(e.target.value); setResult(null) }} rows={5} className="well w-full rounded-xl px-3 py-2 text-ink text-sm mt-1 font-mono" />
      </label>

      {rows.length > 0 && (
        <>
          <p className="text-sm text-ink mb-2">{a.importPreview}: {a.importOk} {sum.ok}, {a.importSkipped} {sum.skipped}, {a.importErrors} {sum.errors}</p>
          <div className="tile rounded-xl max-h-[30vh] overflow-auto mb-3">
            <ul className="divide-y divide-[var(--line)]">
              {rows.filter((r) => r.status !== 'ok').map((r) => (
                <li key={r.line} className={`px-3 py-1.5 text-xs ${r.status === 'error' ? 'text-bad' : 'text-muted'}`}>
                  {r.line}: {r.day}, {r.staffName} — {r.reason ? reason[r.reason] : ''}
                </li>
              ))}
              {sum.ok > 0 && <li className="px-3 py-1.5 text-xs text-ok">{a.importOk}: {sum.ok}</li>}
            </ul>
          </div>
        </>
      )}

      {result && <p className="text-sm text-ink mb-3" role="status">{a.importDone}. {a.importWritten}: {result.ok}, {a.importConflicts}: {result.conflict}, {a.importFailed}: {result.failed}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="well rounded-xl px-4 min-h-[44px] text-sm text-ink">{a.importClose}</button>
        <button type="button" disabled={busy || sum.ok === 0} onClick={() => void run()} className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">{busy ? a.importRunning : a.importRun}</button>
      </div>
    </Modal>
  )
}
