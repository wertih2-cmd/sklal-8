/** Timesheet: one mark per (date, worker). Pure logic of the page, the mark dialog and the totals. */

export type AttendanceKind = 'work' | 'weekend' | 'leave'

export interface AttendanceRow {
  id: number
  work_date: string
  staff_id: number
  kind: AttendanceKind
  hours: number
  shares_pool: boolean
  note: string | null
  marked_by: string | null
  marked_by_name: string | null
  marked_at: string
}

export interface StaffEntry {
  id: number
  full_name: string
  role: string
  active: boolean
}

export const QUICK_HOURS: readonly number[] = [6, 8, 10, 12]
export const MAX_HOURS = 24

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/

/** Today in Cairo, as YYYY-MM-DD: the working day of the business, whatever the time zone of the phone. */
export function cairoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** 'YYYY-MM' of a day. */
export function monthOf(day: string): string {
  return day.slice(0, 7)
}

/** The month shifted by `delta` months, 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
  if (!ISO_MONTH.test(month)) return month
  const [y, m] = month.split('-').map(Number)
  const index = y * 12 + (m - 1) + delta
  const year = Math.floor(index / 12)
  const mon = (index % 12 + 12) % 12 + 1
  return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`
}

/** Every day of the month, 'YYYY-MM-DD'. */
export function monthDays(month: string): string[] {
  if (!ISO_MONTH.test(month)) return []
  const [y, m] = month.split('-').map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Window [from, to) of the month for a range query. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` }
}

/** Day of the week, 0 = Sunday, of a YYYY-MM-DD date. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

export function markKey(staffId: number, day: string): string {
  return `${staffId}|${day}`
}

export function indexMarks(rows: readonly AttendanceRow[]): Map<string, AttendanceRow> {
  return new Map(rows.map((r) => [markKey(r.staff_id, r.work_date), r]))
}

/** Whether a mark on this day can still be made or changed on the client (the server checks again). */
export function dayEditable(day: string, today: string, monthClosed: boolean): boolean {
  return ISO_DAY.test(day) && day <= today && !monthClosed
}

/** A worked day is any day with hours; a leave has none. */
export function workedCount(rows: readonly AttendanceRow[], days: readonly string[]): Map<string, number> {
  const out = new Map<string, number>(days.map((d) => [d, 0]))
  for (const r of rows) {
    if (r.hours <= 0 || r.kind === 'leave') continue
    const v = out.get(r.work_date)
    if (v !== undefined) out.set(r.work_date, v + 1)
  }
  return out
}

/** Hours per worker over the rows given; hundredths are kept exact. */
export function hoursPerStaff(rows: readonly AttendanceRow[]): Map<number, number> {
  const hundredths = new Map<number, number>()
  for (const r of rows) {
    if (r.kind === 'leave') continue
    hundredths.set(r.staff_id, (hundredths.get(r.staff_id) ?? 0) + Math.round(r.hours * 100))
  }
  return new Map([...hundredths].map(([id, h]) => [id, h / 100]))
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100)
}

export interface MarkDraft {
  kind: AttendanceKind
  hours: number
}

export type MarkError = 'hours' | null

/** A leave has no hours; any other mark needs more than 0 and at most 24. */
export function validateMark(draft: MarkDraft): MarkError {
  if (draft.kind === 'leave') return null
  if (!Number.isFinite(draft.hours) || draft.hours <= 0 || draft.hours > MAX_HOURS) return 'hours'
  return null
}

/** Hours to send: the server expects 0 for a leave. */
export function hoursToSend(draft: MarkDraft): number {
  return draft.kind === 'leave' ? 0 : draft.hours
}

/** Parses a decimal typed by a person ('8', '7,5'); NaN when it is not a number. */
export function parseHours(text: string): number {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '' || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

export type MarkOutcome =
  | { status: 'ok' }
  | { status: 'conflict'; markedByName: string | null; markedAt: string | null }

/** Reads the answer of attendance_mark / attendance_clear. Anything unexpected is an error, not a success. */
export function parseOutcome(data: unknown): MarkOutcome {
  const obj = data as { status?: unknown; marked_by_name?: unknown; marked_at?: unknown } | null
  if (obj && obj.status === 'ok') return { status: 'ok' }
  if (obj && obj.status === 'conflict') {
    return {
      status: 'conflict',
      markedByName: typeof obj.marked_by_name === 'string' ? obj.marked_by_name : null,
      markedAt: typeof obj.marked_at === 'string' ? obj.marked_at : null,
    }
  }
  throw new Error('Unexpected answer of the server')
}

/** Active workers, those with a role the page lists first: the order is by name, stable. */
export function sortedStaff(staff: readonly StaffEntry[]): StaffEntry[] {
  return staff.filter((s) => s.active).sort((a, b) => a.full_name.localeCompare(b.full_name) || a.id - b.id)
}
