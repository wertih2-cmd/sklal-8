import { describe, it, expect } from 'vitest'
import {
  parseReport, teamTotals, hasBlockingRemarks, closeState, isCurrentMonth, parseDecimal, checkSettings, checkBonusRates,
  decimalText, reasonValid, premiumRatesFromBonus, type PayrollLine,
} from './payrollModel'

const line = (p: Partial<PayrollLine> = {}): PayrollLine => ({
  staff_id: 1, full_name: 'A', work_days: 2, hours: 16, overtime_hours: 0, base_pay: 640, overtime_pay: 0,
  pool_share: 46.67, cleaning_bonus: 15, personal_bonus: 0, total: 701.67, ...p,
})

const raw = (p: Record<string, unknown> = {}) => ({
  month: '2026-03-01', status: 'open',
  lines: [{ staff_id: 1, full_name: 'A', work_days: 2, hours: '16.00', overtime_hours: 0, base_pay: 640, overtime_pay: 0, pool_share: 46.67, cleaning_bonus: 15, personal_bonus: 0, total: 701.67 }],
  control: [{ kind: 'unallocated_pool', on_date: '2026-03-07', staff_id: null, amount: 30, detail: null }],
  ...p,
})

describe('parseReport', () => {
  it('reads a report; numbers may arrive as text', () => {
    const r = parseReport(raw())
    expect(r.status).toBe('open')
    expect(r.lines[0].hours).toBe(16)
    expect(r.control[0]).toEqual({ kind: 'unallocated_pool', on_date: '2026-03-07', staff_id: null, amount: 30, detail: null })
  })
  it('keeps an unknown control kind instead of failing', () => {
    expect(parseReport(raw({ control: [{ kind: 'new_kind' }] })).control[0].kind).toBe('new_kind')
  })
  it('rejects anything unexpected instead of showing an empty report', () => {
    expect(() => parseReport(null)).toThrow()
    expect(() => parseReport(raw({ status: 'done' }))).toThrow()
    expect(() => parseReport(raw({ lines: 'x' }))).toThrow()
    expect(() => parseReport(raw({ lines: [{ staff_id: 1, full_name: 'A' }] }))).toThrow()
    expect(() => parseReport(raw({ lines: [{ ...raw().lines[0], total: 'abc' }] }))).toThrow()
  })
})

describe('teamTotals', () => {
  it('adds in whole hundredths, so no fraction of a cent appears', () => {
    const t = teamTotals([line({ total: 0.1 }), line({ staff_id: 2, total: 0.2 })])
    expect(t.total).toBe(0.3)
  })
  it('equals the sum of the totals of the people and of every column', () => {
    const t = teamTotals([line(), line({ staff_id: 2, hours: 20, overtime_hours: 2, base_pay: 720, overtime_pay: 120, total: 891.67 })])
    expect(t.total).toBe(1593.34)
    expect(t.hours).toBe(36)
    expect(t.overtime_hours).toBe(2)
    expect(t.base_pay).toBe(1360)
  })
  it('is zero for an empty month', () => {
    expect(teamTotals([]).total).toBe(0)
  })
})

describe('closing', () => {
  it('blocking remarks are an unallocated pool and a type without a premium', () => {
    const c = (kind: string) => ({ kind, on_date: null, staff_id: null, amount: null, detail: null })
    expect(hasBlockingRemarks([c('unallocated_pool')])).toBe(true)
    expect(hasBlockingRemarks([c('no_rate')])).toBe(true)
    expect(hasBlockingRemarks([c('cleaner_not_marked'), c('no_hourly_rate')])).toBe(false)
    expect(hasBlockingRemarks([])).toBe(false)
  })
  it('a closed, a future month and a zero rate cannot be closed', () => {
    expect(closeState('2026-03', '2026-03-20', 'closed', 35)).toBe('closed')
    expect(closeState('2026-04', '2026-03-20', 'open', 35)).toBe('future')
    expect(closeState('2026-03', '2026-03-20', 'open', 0)).toBe('no_hourly_rate')
    expect(closeState('2026-03', '2026-03-20', 'open', 35)).toBe('ready')
    expect(closeState('2026-02', '2026-03-20', 'open', 35)).toBe('ready')
  })
  it('knows the current month', () => {
    expect(isCurrentMonth('2026-03', '2026-03-20')).toBe(true)
    expect(isCurrentMonth('2026-02', '2026-03-20')).toBe(false)
  })
  it('a reason needs a letter, spaces do not count', () => {
    expect(reasonValid('')).toBe(false)
    expect(reasonValid('   ')).toBe(false)
    expect(reasonValid(' typo ')).toBe(true)
  })
})

describe('input', () => {
  it('parses a decimal with a comma or a dot, at most two decimals', () => {
    expect(parseDecimal('35,41')).toBe(35.41)
    expect(parseDecimal(' 8 ')).toBe(8)
    expect(Number.isNaN(parseDecimal(''))).toBe(true)
    expect(Number.isNaN(parseDecimal('1.234'))).toBe(true)
    expect(Number.isNaN(parseDecimal('-1'))).toBe(true)
    expect(Number.isNaN(parseDecimal('1e3'))).toBe(true)
  })
  it('settings follow the limits of the table', () => {
    const ok = { hourly_rate: '35,41', norm_hours: '8', overtime_coef: '1,5' }
    expect(checkSettings(ok)).toEqual({ ok: true, value: { hourly_rate: 35.41, norm_hours: 8, overtime_coef: 1.5 } })
    expect(checkSettings({ ...ok, hourly_rate: '0' }).ok).toBe(true)
    expect(checkSettings({ ...ok, hourly_rate: 'x' })).toEqual({ ok: false, field: 'hourly_rate' })
    expect(checkSettings({ ...ok, norm_hours: '0' })).toEqual({ ok: false, field: 'norm_hours' })
    expect(checkSettings({ ...ok, norm_hours: '25' })).toEqual({ ok: false, field: 'norm_hours' })
    expect(checkSettings({ ...ok, overtime_coef: '0,9' })).toEqual({ ok: false, field: 'overtime_coef' })
    expect(checkSettings({ ...ok, overtime_coef: '100' })).toEqual({ ok: false, field: 'overtime_coef' })
  })
  it('every apartment type needs a premium, 0 is allowed', () => {
    const ok = checkBonusRates({ studio: '30', '1br': '40', '2br': '0' })
    expect(ok).toEqual({ ok: true, value: [
      { apt_type: 'studio', base_bonus: 30 }, { apt_type: '1br', base_bonus: 40 }, { apt_type: '2br', base_bonus: 0 },
    ] })
    expect(checkBonusRates({ studio: '30', '1br': '', '2br': '50' })).toEqual({ ok: false, type: '1br' })
  })
  it('shows a stored number without trailing zeros', () => {
    expect(decimalText(8)).toBe('8')
    expect(decimalText(35.41)).toBe('35.41')
    expect(decimalText(1.5)).toBe('1.5')
  })
})

describe('premiumRatesFromBonus', () => {
  it('is null until some premium is above zero', () => {
    expect(premiumRatesFromBonus([])).toBeNull()
    expect(premiumRatesFromBonus([{ apt_type: 'studio', base_bonus: 0 }])).toBeNull()
  })
  it('keeps only the types with a premium', () => {
    expect(premiumRatesFromBonus([{ apt_type: 'studio', base_bonus: 30 }, { apt_type: '1br', base_bonus: 0 }])).toEqual({ studio: 30 })
  })
})
