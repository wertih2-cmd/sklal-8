import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { friendlyMessage } from '@/lib/errors'
import { formatEGP } from '@/lib/format'
import { toast } from '@/lib/toast'
import { addAdjustment, deleteAdjustment, fetchAdjustments } from './payrollApi'
import { parseAdjustmentAmount, type Adjustment } from './payrollExtraModel'

/** Personal bonuses (plus) and deductions (minus) of a month. The admin edits; the manager reads. A closed month is read-only. */
export function PayrollAdjustments({ month, staff, closed, isAdmin, onChanged }: {
  month: string
  staff: ReadonlyMap<number, string>
  closed: boolean
  isAdmin: boolean
  onChanged: () => void
}) {
  const { t } = useI18n()
  const p = t.admin.payroll
  const [rows, setRows] = useState<Adjustment[]>([])
  const [failed, setFailed] = useState(false)
  const [staffId, setStaffId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try { setRows(await fetchAdjustments(month)) } catch { setFailed(true) }
  }, [month])

  useEffect(() => { void load() }, [load])

  const editable = isAdmin && !closed
  const field = 'well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm disabled:opacity-60'
  const people = [...staff.entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const add = async () => {
    const value = parseAdjustmentAmount(amount)
    if (staffId === '' || value === null) { setInvalid(true); return }
    setInvalid(false)
    setBusy(true)
    try {
      await addAdjustment(month, Number(staffId), value, note)
      toast(p.adjAdded, 'success')
      setAmount('')
      setNote('')
      await load()
      onChanged()
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    setBusy(true)
    try {
      await deleteAdjustment(id)
      toast(p.adjDeleted, 'success')
      await load()
      onChanged()
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="tile rounded-[20px] p-4 mb-4" aria-label={p.adjTitle}>
      <h2 className="text-sm font-semibold text-ink mb-1">{p.adjTitle}</h2>
      <p className="text-xs text-muted mb-3">{closed ? p.adjClosed : p.adjNote}</p>
      {failed ? (
        <p className="text-sm text-bad mb-2" role="alert">{p.adjLoadFailed}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted mb-2">{p.adjEmpty}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] mb-3">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium text-ink min-w-[120px]">{staff.get(r.staff_id) ?? `#${r.staff_id}`}</span>
              <span className={`whitespace-nowrap ${r.amount < 0 ? 'text-bad' : 'text-ok'}`}>{formatEGP(r.amount)}</span>
              <span className="text-muted flex-1 truncate">{r.note ?? ''}</span>
              {editable && (
                <button type="button" disabled={busy} aria-label={p.adjDelete} onClick={() => void remove(r.id)} className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-bad disabled:opacity-60">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 mb-2">
            <label className="block text-sm text-ink">{p.adjStaff}
              <select value={staffId} disabled={busy} onChange={(e) => setStaffId(e.target.value)} className={`${field} mt-1`}>
                <option value="">{p.adjPickStaff}</option>
                {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="block text-sm text-ink">{p.adjAmount}
              <input inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} className={`${field} mt-1`} />
            </label>
            <label className="block text-sm text-ink">{p.adjNoteField}
              <input value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} className={`${field} mt-1`} />
            </label>
          </div>
          {invalid && <p className="text-xs text-bad mb-2" role="alert">{p.adjInvalid}</p>}
          <button type="button" disabled={busy} onClick={() => void add()} className="bg-accent text-on-accent rounded-xl px-5 min-h-[44px] text-sm font-medium disabled:opacity-60">{p.adjAdd}</button>
        </>
      )}
    </section>
  )
}
