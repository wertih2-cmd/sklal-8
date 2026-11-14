import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import type { AptType } from '@/lib/database.types'
import { parseReport, type BonusRate, type PayrollReport, type PayrollSettings } from './payrollModel'
import type { Adjustment } from './payrollExtraModel'

const monthStart = (month: string) => `${month}-01`

/** The month report: live while the month is open, the snapshot once it is closed. Admin and manager only. */
export async function fetchPayrollReport(month: string): Promise<PayrollReport> {
  const { data, error, status } = await supabase.rpc('payroll_report', { p_month: monthStart(month) })
  if (error) throw toApiError(error, status)
  return parseReport(data)
}

export async function fetchPayrollSettings(): Promise<PayrollSettings> {
  const { data, error, status } = await supabase
    .from('payroll_settings')
    .select('hourly_rate,norm_hours,overtime_coef')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw toApiError(error, status)
  if (!data) throw new Error('Payroll settings are missing')
  return {
    hourly_rate: Number(data.hourly_rate),
    norm_hours: Number(data.norm_hours),
    overtime_coef: Number(data.overtime_coef),
  }
}

export async function fetchBonusRates(): Promise<BonusRate[]> {
  const { data, error, status } = await supabase.from('cleaning_bonus_rates').select('apt_type,base_bonus')
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r) => ({ apt_type: r.apt_type as AptType, base_bonus: Number(r.base_bonus) }))
}

/** Admin only (RLS): a manager's attempt changes nothing and is rejected. */
export async function savePayrollSettings(v: PayrollSettings): Promise<void> {
  const { error, status } = await supabase
    .from('payroll_settings')
    .update({ hourly_rate: v.hourly_rate, norm_hours: v.norm_hours, overtime_coef: v.overtime_coef, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw toApiError(error, status)
}

export async function saveBonusRates(rates: readonly BonusRate[]): Promise<void> {
  const { error, status } = await supabase
    .from('cleaning_bonus_rates')
    .upsert(rates.map((r) => ({ apt_type: r.apt_type, base_bonus: r.base_bonus })), { onConflict: 'apt_type' })
  if (error) throw toApiError(error, status)
}

/** Closes the month. `force` lets a month with remarks of the control through, after the admin agreed. */
export async function closePayrollMonth(month: string, force: boolean): Promise<void> {
  const { data, error, status } = await supabase.rpc('payroll_close', { p_month: monthStart(month), p_force: force })
  if (error) throw toApiError(error, status)
  if ((data as { status?: unknown } | null)?.status !== 'closed') throw new Error('Unexpected answer of the server')
}

export async function reopenPayrollMonth(month: string, reason: string): Promise<void> {
  const { data, error, status } = await supabase.rpc('payroll_reopen', { p_month: monthStart(month), p_reason: reason.trim() })
  if (error) throw toApiError(error, status)
  if ((data as { status?: unknown } | null)?.status !== 'open') throw new Error('Unexpected answer of the server')
}

/** Personal bonuses and deductions of a month ('YYYY-MM'). Admin and manager read (RLS). */
export async function fetchAdjustments(month: string): Promise<Adjustment[]> {
  const { data, error, status } = await supabase
    .from('payroll_adjustments')
    .select('id,staff_id,amount,note')
    .eq('month', monthStart(month))
    .order('id', { ascending: true })
  if (error) throw toApiError(error, status)
  return (data ?? []).map((r) => ({ id: Number(r.id), staff_id: Number(r.staff_id), amount: Number(r.amount), note: (r.note as string | null) ?? null }))
}

/** Admin only (RLS); a closed month is refused by the database trigger. */
export async function addAdjustment(month: string, staffId: number, amount: number, note: string): Promise<void> {
  const { error, status } = await supabase
    .from('payroll_adjustments')
    .insert({ month: monthStart(month), staff_id: staffId, amount, note: note.trim() === '' ? null : note.trim() })
  if (error) throw toApiError(error, status)
}

export async function deleteAdjustment(id: number): Promise<void> {
  const { error, status } = await supabase.from('payroll_adjustments').delete().eq('id', id)
  if (error) throw toApiError(error, status)
}
