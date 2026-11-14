import type { StaffEntry, AttendanceKind } from './attendanceModel'
import { MAX_HOURS } from './attendanceModel'

/** Largest amount numeric(12,2) accepts, kept far below the limit so a typo cannot reach it. */
export const MAX_ADJUSTMENT = 1_000_000

export interface Adjustment {
  id: number
  staff_id: number
  amount: number
  note: string | null
}

/** A typed amount: a plus is a bonus, a minus a deduction; zero and more than two decimals are refused. Null when invalid. */
export function parseAdjustmentAmount(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) > MAX_ADJUSTMENT) return null
  return value
}

/** Sum of the adjustments of one worker, in hundredths so cents never drift. */
export function adjustmentTotal(rows: readonly Adjustment[], staffId: number): number {
  let hundredths = 0
  for (const r of rows) if (r.staff_id === staffId) hundredths += Math.round(r.amount * 100)
  return hundredths / 100
}

export type ImportReason = 'empty' | 'date' | 'future' | 'staff' | 'hours' | 'duplicate' | 'kind'

export interface ImportRow {
  /** 1-based line of the file, for the person to find it. */
  line: number
  day: string
  staffName: string
  staffId: number | null
  kind: AttendanceKind
  hours: number
  sharesPool: boolean
  /** ok = will be written; skip = a blank row (no hours yet); error = needs a fix. */
  status: 'ok' | 'skip' | 'error'
  reason: ImportReason | null
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const DMY = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/

function validDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** YYYY-MM-DD or DD.MM.YYYY to YYYY-MM-DD; null when it is not a real day. */
export function parseImportDate(text: string): string | null {
  const s = text.trim()
  const a = ISO.exec(s)
  if (a) return validDay(Number(a[1]), Number(a[2]), Number(a[3]))
  const b = DMY.exec(s)
  if (b) return validDay(Number(b[3]), Number(b[2]), Number(b[1]))
  return null
}

function splitLine(line: string): string[] {
  const sep = line.includes(';') ? ';' : line.includes('\t') ? '\t' : ','
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim())
}

function parseKind(text: string): AttendanceKind | null {
  const s = text.trim().toLowerCase()
  if (s === '' || s === 'work' || s === '\u0440') return 'work'
  if (s === '\u0432' || s === 'v' || s === 'weekend') return 'weekend'
  if (s === '\u043e' || s === 'o' || s === 'leave') return 'leave'
  return null
}

function parseImportHours(text: string): number {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return 0
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Reads a CSV of hours: date; worker; hours; shares the pool (1/0, optional); kind (В / О, optional).
 * A header line is recognised by its first cell not being a date. A work row without hours is skipped, not an error.
 */
export function parseHoursCsv(text: string, staff: readonly StaffEntry[], today: string): ImportRow[] {
  const byName = new Map(staff.map((s) => [norm(s.full_name), s.id]))
  const seen = new Set<string>()
  const out: ImportRow[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return
    const cells = splitLine(raw)
    const day = parseImportDate(cells[0] ?? '')
    if (day === null && out.length === 0 && i === 0) return // header
    const staffName = cells[1] ?? ''
    const staffId = byName.get(norm(staffName)) ?? null
    const kind = parseKind(cells[4] ?? '')
    const hours = parseImportHours(cells[2] ?? '')
    const flag = (cells[3] ?? '').trim()
    const sharesPool = flag === '' ? true : flag !== '0'
    const base = { line: i + 1, day: day ?? (cells[0] ?? ''), staffName, staffId, kind: kind ?? 'work', hours: Number.isNaN(hours) ? 0 : hours, sharesPool }
    const fail = (reason: ImportReason): ImportRow => ({ ...base, status: 'error', reason })
    if (day === null) { out.push(fail('date')); return }
    if (day > today) { out.push(fail('future')); return }
    if (staffId === null) { out.push(fail('staff')); return }
    if (kind === null) { out.push(fail('kind')); return }
    if (Number.isNaN(hours) || hours > MAX_HOURS) { out.push(fail('hours')); return }
    const key = `${staffId}|${day}`
    if (seen.has(key)) { out.push(fail('duplicate')); return }
    seen.add(key)
    if (kind !== 'leave' && hours === 0) { out.push({ ...base, status: 'skip', reason: 'empty' }); return }
    out.push({ ...base, hours: kind === 'leave' ? 0 : hours, status: 'ok', reason: null })
  })
  return out
}

export function importSummary(rows: readonly ImportRow[]): { ok: number; skipped: number; errors: number } {
  return {
    ok: rows.filter((r) => r.status === 'ok').length,
    skipped: rows.filter((r) => r.status === 'skip').length,
    errors: rows.filter((r) => r.status === 'error').length,
  }
}

/** Largest coefficient numeric(5,2) accepts. */
export const MAX_COEF = 999.99

export type CoefInput = { ok: true; value: number | null } | { ok: false }

/** A typed coefficient of one cleaning: empty means "back to 1" (the entry is removed), otherwise 0 to 999.99 with up to two decimals. */
export function parseCoef(text: string): CoefInput {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return { ok: true, value: null }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false }
  const value = Number(cleaned)
  return value <= MAX_COEF ? { ok: true, value } : { ok: false }
}
