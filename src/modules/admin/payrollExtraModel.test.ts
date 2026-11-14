import { describe, expect, it } from 'vitest'
import {
  adjustmentTotal, importSummary, parseAdjustmentAmount, parseCoef, parseHoursCsv, parseImportDate,
} from './payrollExtraModel'

const staff = [
  { id: 1, full_name: 'Mohammed abo talb', role: 'housekeeper', active: true },
  { id: 2, full_name: 'Mohamed Nabil', role: 'housekeeper', active: true },
]

describe('parseAdjustmentAmount', () => {
  it('accepts a bonus and a deduction with a comma or a dot', () => {
    expect(parseAdjustmentAmount('125')).toBe(125)
    expect(parseAdjustmentAmount('-50,5')).toBe(-50.5)
    expect(parseAdjustmentAmount('+10.25')).toBe(10.25)
  })
  it('refuses zero, text, three decimals and absurd amounts', () => {
    for (const bad of ['', '0', '0,00', 'abc', '1.234', '1e3', '--5', '1000001']) expect(parseAdjustmentAmount(bad)).toBeNull()
  })
})

describe('adjustmentTotal', () => {
  it('sums one worker in exact hundredths', () => {
    const rows = [
      { id: 1, staff_id: 1, amount: 0.1, note: null },
      { id: 2, staff_id: 1, amount: 0.2, note: null },
      { id: 3, staff_id: 2, amount: 500, note: null },
    ]
    expect(adjustmentTotal(rows, 1)).toBe(0.3)
    expect(adjustmentTotal(rows, 3)).toBe(0)
  })
})

describe('parseImportDate', () => {
  it('reads ISO and day-first dates, refuses impossible ones', () => {
    expect(parseImportDate('2026-11-04')).toBe('2026-11-04')
    expect(parseImportDate('4.11.2026')).toBe('2026-11-04')
    expect(parseImportDate('2026-02-30')).toBeNull()
    expect(parseImportDate('hello')).toBeNull()
  })
})

describe('parseHoursCsv', () => {
  const today = '2026-11-14'
  it('reads rows, skips the header and blank hours', () => {
    const text = 'date;staff;hours;shares\n2026-11-04;Mohammed abo talb;12;1\n2026-11-04;Mohamed Nabil;;1\n'
    const rows = parseHoursCsv(text, staff, today)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ staffId: 1, hours: 12, status: 'ok', sharesPool: true, kind: 'work' })
    expect(rows[1]).toMatchObject({ status: 'skip', reason: 'empty' })
  })
  it('matches names ignoring case and extra spaces, and reads a decimal comma', () => {
    const rows = parseHoursCsv('2026-11-06;  mohamed   nabil ;8,5;0', staff, today)
    expect(rows[0]).toMatchObject({ staffId: 2, hours: 8.5, sharesPool: false, status: 'ok' })
  })
  it('flags unknown workers, future days, bad hours and repeats', () => {
    const text = [
      '2026-11-05;Nobody;8',
      '2026-11-15;Mohamed Nabil;8',
      '2026-11-05;Mohamed Nabil;30',
      '2026-11-05;Mohamed Nabil;8',
      '2026-11-05;Mohamed Nabil;9',
      'x;Mohamed Nabil;8',
    ].join('\n')
    const rows = parseHoursCsv(text, staff, today)
    expect(rows.map((r) => r.reason)).toEqual(['staff', 'future', 'hours', null, 'duplicate', 'date'])
  })
  it('reads weekend and leave marks; a leave has no hours', () => {
    const rows = parseHoursCsv('2026-11-07;Mohamed Nabil;10;1;В\n2026-11-08;Mohamed Nabil;;;О', staff, today)
    expect(rows[0]).toMatchObject({ kind: 'weekend', hours: 10, status: 'ok' })
    expect(rows[1]).toMatchObject({ kind: 'leave', hours: 0, status: 'ok' })
  })
  it('counts the summary', () => {
    const rows = parseHoursCsv('2026-11-05;Mohamed Nabil;8\n2026-11-06;Mohamed Nabil;\n2026-11-07;Nobody;8', staff, today)
    expect(importSummary(rows)).toEqual({ ok: 1, skipped: 1, errors: 1 })
  })
})

describe('parseCoef', () => {
  it('reads a coefficient, empty means reset', () => {
    expect(parseCoef('1,5')).toEqual({ ok: true, value: 1.5 })
    expect(parseCoef('0')).toEqual({ ok: true, value: 0 })
    expect(parseCoef('  ')).toEqual({ ok: true, value: null })
  })
  it('refuses a minus, text, three decimals and more than 999.99', () => {
    for (const bad of ['-1', 'x', '1.234', '1000', '1e2']) expect(parseCoef(bad)).toEqual({ ok: false })
  })
})
