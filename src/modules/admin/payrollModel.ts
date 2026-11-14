import type { AptType } from '@/lib/database.types'

export const APT_TYPES: readonly AptType[] = ['studio', '1br', '2br']

/** Largest money amount the numeric(10,2) columns accept. */
const MAX_MONEY = 99_999_999.99

export interface PayrollLine {
  staff_id: number
  full_name: string
  work_days: number
  hours: number
  overtime_hours: number
  base_pay: number
  overtime_pay: number
  pool_share: number
  cleaning_bonus: number
  personal_bonus: number
  total: number
}

export interface ControlItem {
  /** unallocated_pool, cleaner_not_marked, no_rate, no_hourly_rate (an unknown kind is kept as it came). */
  kind: string
  on_date: string | null
  staff_id: number | null
  amount: number | null
  detail: string | null
}

export interface PayrollReport {
  /** First day of the month, YYYY-MM-DD. */
  month: string
  status: 'open' | 'closed'
  lines: PayrollLine[]
  control: ControlItem[]
}

export interface PayrollSettings {
  hourly_rate: number
  norm_hours: number
  overtime_coef: number
}

export interface BonusRate {
  apt_type: AptType
  base_bonus: number
}

const LINE_NUMBERS = [
  'staff_id', 'work_days', 'hours', 'overtime_hours', 'base_pay', 'overtime_pay', 'pool_share', 'cleaning_bonus', 'personal_bonus', 'total',
] as const

function num(value: unknown, what: string): number {
  const x = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Unexpected answer of the server: ${what}`)
  return x
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const x = typeof value === 'string' ? Number(value) : value
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}

/** Reads the answer of payroll_report. Anything unexpected is an error, never an empty report. */
export function parseReport(data: unknown): PayrollReport {
  const o = data as { month?: unknown; status?: unknown; lines?: unknown; control?: unknown } | null
  if (!o || typeof o !== 'object' || typeof o.month !== 'string') throw new Error('Unexpected answer of the server: report')
  if (o.status !== 'open' && o.status !== 'closed') throw new Error('Unexpected answer of the server: status')
  if (!Array.isArray(o.lines) || !Array.isArray(o.control)) throw new Error('Unexpected answer of the server: lists')
  const lines = o.lines.map((raw): PayrollLine => {
    const r = raw as Record<string, unknown>
    if (typeof r.full_name !== 'string') throw new Error('Unexpected answer of the server: name')
    const v = Object.fromEntries(LINE_NUMBERS.map((k) => [k, num(r[k], k)])) as Record<(typeof LINE_NUMBERS)[number], number>
    return { full_name: r.full_name, ...v }
  })
  const control = o.control.map((raw): ControlItem => {
    const r = raw as Record<string, unknown>
    return {
      kind: typeof r.kind === 'string' ? r.kind : 'unknown',
      on_date: typeof r.on_date === 'string' ? r.on_date : null,
      staff_id: optNum(r.staff_id),
      amount: optNum(r.amount),
      detail: typeof r.detail === 'string' ? r.detail : null,
    }
  })
  return { month: o.month, status: o.status, lines, control }
}

const cents = (x: number) => Math.round(x * 100)

export interface TeamTotals {
  hours: number
  overtime_hours: number
  base_pay: number
  overtime_pay: number
  pool_share: number
  cleaning_bonus: number
  personal_bonus: number
  total: number
}

/** Column sums of the team, added in whole hundredths so that no fraction of a cent appears. */
export function teamTotals(lines: readonly PayrollLine[]): TeamTotals {
  const sum = (pick: (l: PayrollLine) => number) => lines.reduce((s, l) => s + cents(pick(l)), 0) / 100
  return {
    hours: sum((l) => l.hours),
    overtime_hours: sum((l) => l.overtime_hours),
    base_pay: sum((l) => l.base_pay),
    overtime_pay: sum((l) => l.overtime_pay),
    pool_share: sum((l) => l.pool_share),
    cleaning_bonus: sum((l) => l.cleaning_bonus),
    personal_bonus: sum((l) => l.personal_bonus),
    total: sum((l) => l.total),
  }
}

/** Remarks that the server only lets pass with a confirmation (p_force). */
export function hasBlockingRemarks(control: readonly ControlItem[]): boolean {
  return control.some((c) => c.kind === 'unallocated_pool' || c.kind === 'no_rate')
}

export type CloseState = 'closed' | 'future' | 'no_hourly_rate' | 'ready'

/** Whether the month may be closed. The server decides in the end; this only keeps impossible clicks away. */
export function closeState(month: string, today: string, status: 'open' | 'closed', hourlyRate: number): CloseState {
  if (status === 'closed') return 'closed'
  if (month > today.slice(0, 7)) return 'future'
  if (!(hourlyRate > 0)) return 'no_hourly_rate'
  return 'ready'
}

/** The current month is not over yet: closing it freezes a partial month. */
export function isCurrentMonth(month: string, today: string): boolean {
  return month === today.slice(0, 7)
}

/** Parses an amount typed by a person ('35,41'); NaN when it is not a number with at most two decimals. */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

export interface SettingsDraft {
  hourly_rate: string
  norm_hours: string
  overtime_coef: string
}

export type SettingsField = keyof SettingsDraft

export type SettingsCheck = { ok: true; value: PayrollSettings } | { ok: false; field: SettingsField }

/** Same limits as the table: rate 0..99999999.99, norm above 0 and up to 24, overtime coefficient 1..99.99. */
export function checkSettings(d: SettingsDraft): SettingsCheck {
  const hourly_rate = parseDecimal(d.hourly_rate)
  if (!(hourly_rate >= 0 && hourly_rate <= MAX_MONEY)) return { ok: false, field: 'hourly_rate' }
  const norm_hours = parseDecimal(d.norm_hours)
  if (!(norm_hours > 0 && norm_hours <= 24)) return { ok: false, field: 'norm_hours' }
  const overtime_coef = parseDecimal(d.overtime_coef)
  if (!(overtime_coef >= 1 && overtime_coef <= 99.99)) return { ok: false, field: 'overtime_coef' }
  return { ok: true, value: { hourly_rate, norm_hours, overtime_coef } }
}

export type BonusCheck = { ok: true; value: BonusRate[] } | { ok: false; type: AptType }

/** One premium per apartment type; an empty field is not allowed, 0 means no premium. */
export function checkBonusRates(drafts: Readonly<Record<AptType, string>>): BonusCheck {
  const value: BonusRate[] = []
  for (const apt_type of APT_TYPES) {
    const base_bonus = parseDecimal(drafts[apt_type])
    if (!(base_bonus >= 0 && base_bonus <= MAX_MONEY)) return { ok: false, type: apt_type }
    value.push({ apt_type, base_bonus })
  }
  return { ok: true, value }
}

/** The text a person edits: the stored number without trailing zeros. */
export function decimalText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

export function reasonValid(text: string): boolean {
  return text.trim() !== ''
}

/** Premium per cleaning by apartment type for the chessboard; null while no premium is set. */
export function premiumRatesFromBonus(rates: readonly BonusRate[]): Partial<Record<AptType, number>> | null {
  const out: Partial<Record<AptType, number>> = {}
  let any = false
  for (const r of rates) {
    if (r.base_bonus > 0) { out[r.apt_type] = r.base_bonus; any = true }
  }
  return any ? out : null
}
