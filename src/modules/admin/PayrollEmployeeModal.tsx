import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { formatEGP } from '@/lib/format'
import { formatHours } from './attendanceModel'
import type { PayrollLine } from './payrollModel'

/** The report of one worker for the month, as the sheet of the Excel file: every component of the total. */
export function PayrollEmployeeModal({ line, hourlyRate, monthLabel, onClose }: {
  line: PayrollLine
  hourlyRate: number
  monthLabel: string
  onClose: () => void
}) {
  const { t, n } = useI18n()
  const p = t.admin.payroll
  const inNorm = Math.round((line.hours - line.overtime_hours) * 100) / 100
  const rows: Array<[string, string, boolean?]> = [
    [p.empRate, formatEGP(hourlyRate)],
    [p.colDays, n(String(line.work_days))],
    [p.colHours, n(formatHours(line.hours))],
    [p.empInNorm, n(formatHours(inNorm))],
    [p.colOvertime, n(formatHours(line.overtime_hours))],
    [p.colBase, formatEGP(line.base_pay)],
    [p.colOvertimePay, formatEGP(line.overtime_pay)],
    [p.colPool, formatEGP(line.pool_share)],
    [p.colBonus, formatEGP(line.cleaning_bonus)],
    [p.colPersonal, formatEGP(line.personal_bonus)],
    [p.colTotal, formatEGP(line.total), true],
  ]
  return (
    <Modal open title={`${p.empTitle}: ${line.full_name}`} onClose={onClose} size="sm">
      <p className="text-xs text-muted mb-3 capitalize">{monthLabel}</p>
      <dl className="divide-y divide-[var(--line)] mb-4">
        {rows.map(([label, value, strong]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2 text-sm">
            <dt className="text-muted">{label}</dt>
            <dd className={`text-ink whitespace-nowrap ${strong ? 'font-semibold text-accent' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="well rounded-xl px-4 min-h-[44px] text-sm text-ink">{p.empClose}</button>
      </div>
    </Modal>
  )
}
