import { supabase } from '@/lib/supabase'
import { fetchAllPages } from '@/lib/paginate'
import { toApiError } from '@/lib/errors'
import {
  monthRange, parseOutcome,
  type AttendanceKind, type AttendanceRow, type MarkOutcome, type StaffEntry,
} from './attendanceModel'

/** Active workers without their phones: the directory view is what the supervisor may read. */
export async function fetchStaffDirectory(): Promise<StaffEntry[]> {
  const { data, error, status } = await supabase
    .from('staff_directory')
    .select('id,full_name,role,active')
    .eq('active', true)
    .order('full_name', { ascending: true })
  if (error) throw toApiError(error, status)
  return (data ?? []) as StaffEntry[]
}

/** Every mark of the month ('YYYY-MM'); paged, stable order. */
export async function fetchAttendance(month: string): Promise<AttendanceRow[]> {
  const { from, to } = monthRange(month)
  const rows = await fetchAllPages<AttendanceRow>((a, b) =>
    supabase
      .from('attendance')
      .select('id,work_date,staff_id,kind,hours,shares_pool,note,marked_by,marked_by_name,marked_at')
      .gte('work_date', from)
      .lt('work_date', to)
      .order('work_date', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  )
  return rows.map((r) => ({ ...r, hours: Number(r.hours) }))
}

/** Whether payroll of the month is closed: a closed month cannot be changed. */
export async function fetchMonthClosed(month: string): Promise<boolean> {
  const { data, error, status } = await supabase.rpc('payroll_month_is_closed', { p_month: `${month}-01` })
  if (error) throw toApiError(error, status)
  return data === true
}

export interface MarkArgs {
  day: string
  staffId: number
  kind: AttendanceKind
  hours: number
  sharesPool: boolean
  note: string
  /** Replace a mark made by somebody else; asked only after the person agreed. */
  force: boolean
}

export async function markAttendance(a: MarkArgs): Promise<MarkOutcome> {
  const { data, error, status } = await supabase.rpc('attendance_mark', {
    p_date: a.day,
    p_staff: a.staffId,
    p_kind: a.kind,
    p_hours: a.hours,
    p_shares_pool: a.sharesPool,
    p_note: a.note.trim() === '' ? null : a.note.trim(),
    p_force: a.force,
  })
  if (error) throw toApiError(error, status)
  return parseOutcome(data)
}

export async function clearAttendance(day: string, staffId: number, force: boolean): Promise<MarkOutcome> {
  const { data, error, status } = await supabase.rpc('attendance_clear', { p_date: day, p_staff: staffId, p_force: force })
  if (error) throw toApiError(error, status)
  return parseOutcome(data)
}
