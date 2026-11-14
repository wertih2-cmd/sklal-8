import { describe, it, expect } from 'vitest'
import {
  cairoToday, monthOf, shiftMonth, monthDays, monthRange, weekdayOf, markKey, indexMarks, dayEditable,
  workedCount, hoursPerStaff, formatHours, validateMark, hoursToSend, parseHours, parseOutcome, sortedStaff,
  QUICK_HOURS, type AttendanceRow, type StaffEntry,
} from './attendanceModel'

const row = (p: Partial<AttendanceRow> = {}): AttendanceRow => ({
  id: 1, work_date: '2026-11-10', staff_id: 1, kind: 'work', hours: 8, shares_pool: true, note: null,
  marked_by: 'u1', marked_by_name: 'Sup', marked_at: '2026-11-10T09:00:00Z', ...p,
})

describe('dates', () => {
  it('takes the day in Cairo, not in UTC', () => {
    expect(cairoToday(new Date('2026-11-14T22:30:00Z'))).toBe('2026-11-15')
    expect(cairoToday(new Date('2026-11-14T10:00:00Z'))).toBe('2026-11-14')
  })
  it('shifts months over a year edge in both directions', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-03', -15)).toBe('2024-12')
    expect(shiftMonth('bad', 1)).toBe('bad')
  })
  it('lists the days of a month, leap February included', () => {
    expect(monthDays('2026-11')).toHaveLength(30)
    expect(monthDays('2026-11')[0]).toBe('2026-11-01')
    expect(monthDays('2028-02')).toHaveLength(29)
    expect(monthDays('2026-02')).toHaveLength(28)
    expect(monthDays('x')).toEqual([])
  })
  it('gives the window of a month and the weekday', () => {
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' })
    expect(monthOf('2026-11-14')).toBe('2026-11')
    expect(weekdayOf('2026-11-14')).toBe(6)
  })
})

describe('marks', () => {
  it('indexes by worker and day', () => {
    const idx = indexMarks([row({ staff_id: 2, work_date: '2026-11-03' })])
    expect(idx.get(markKey(2, '2026-11-03'))?.hours).toBe(8)
    expect(idx.get(markKey(1, '2026-11-03'))).toBeUndefined()
  })
  it('lets a mark be made today and before, not in the future, not in a closed month', () => {
    expect(dayEditable('2026-11-14', '2026-11-14', false)).toBe(true)
    expect(dayEditable('2026-11-15', '2026-11-14', false)).toBe(false)
    expect(dayEditable('2026-11-10', '2026-11-14', true)).toBe(false)
    expect(dayEditable('garbage', '2026-11-14', false)).toBe(false)
  })
  it('counts the people who worked per day; leave and zero hours do not count', () => {
    const days = monthDays('2026-11')
    const rows = [
      row({ id: 1, staff_id: 1 }), row({ id: 2, staff_id: 2 }),
      row({ id: 3, staff_id: 3, kind: 'leave', hours: 0 }),
      row({ id: 4, staff_id: 1, work_date: '2026-11-11', kind: 'weekend', hours: 9 }),
    ]
    const per = workedCount(rows, days)
    expect(per.get('2026-11-10')).toBe(2)
    expect(per.get('2026-11-11')).toBe(1)
    expect(per.get('2026-11-12')).toBe(0)
    expect(per.size).toBe(30)
  })
  it('sums hours per worker in exact hundredths and skips leaves', () => {
    const rows = [row({ hours: 7.5 }), row({ id: 2, work_date: '2026-11-11', hours: 8.25 }), row({ id: 3, work_date: '2026-11-12', kind: 'leave', hours: 0 }), row({ id: 4, staff_id: 2, hours: 0.1 }), row({ id: 5, staff_id: 2, work_date: '2026-11-13', hours: 0.2 })]
    const per = hoursPerStaff(rows)
    expect(per.get(1)).toBe(15.75)
    expect(per.get(2)).toBe(0.3)
  })
  it('formats hours without trailing zeros', () => {
    expect(formatHours(8)).toBe('8')
    expect(formatHours(7.5)).toBe('7.5')
    expect(formatHours(7.25)).toBe('7.25')
  })
})

describe('the mark dialog', () => {
  it('offers the usual lengths of a shift', () => {
    expect(QUICK_HOURS).toEqual([6, 8, 10, 12])
  })
  it('needs hours from above 0 up to 24 for work and weekend, none for a leave', () => {
    expect(validateMark({ kind: 'work', hours: 8 })).toBeNull()
    expect(validateMark({ kind: 'work', hours: 24 })).toBeNull()
    expect(validateMark({ kind: 'work', hours: 0 })).toBe('hours')
    expect(validateMark({ kind: 'weekend', hours: 24.5 })).toBe('hours')
    expect(validateMark({ kind: 'work', hours: Number.NaN })).toBe('hours')
    expect(validateMark({ kind: 'leave', hours: 0 })).toBeNull()
  })
  it('sends 0 hours for a leave whatever was typed before', () => {
    expect(hoursToSend({ kind: 'leave', hours: 8 })).toBe(0)
    expect(hoursToSend({ kind: 'work', hours: 8 })).toBe(8)
  })
  it('parses typed hours with a comma or a dot and refuses the rest', () => {
    expect(parseHours('8')).toBe(8)
    expect(parseHours(' 7,5 ')).toBe(7.5)
    expect(parseHours('7.25')).toBe(7.25)
    expect(Number.isNaN(parseHours(''))).toBe(true)
    expect(Number.isNaN(parseHours('8h'))).toBe(true)
    expect(Number.isNaN(parseHours('7.255'))).toBe(true)
    expect(Number.isNaN(parseHours('-1'))).toBe(true)
  })
})

describe('the answer of the server', () => {
  it('reads ok and conflict', () => {
    expect(parseOutcome({ status: 'ok' })).toEqual({ status: 'ok' })
    expect(parseOutcome({ status: 'conflict', marked_by_name: 'Sara', marked_at: '2026-11-10T09:00:00Z' })).toEqual({ status: 'conflict', markedByName: 'Sara', markedAt: '2026-11-10T09:00:00Z' })
    expect(parseOutcome({ status: 'conflict' })).toEqual({ status: 'conflict', markedByName: null, markedAt: null })
  })
  it('never takes an unknown answer for a success', () => {
    expect(() => parseOutcome(null)).toThrow()
    expect(() => parseOutcome({ status: 'saved' })).toThrow()
    expect(() => parseOutcome('ok')).toThrow()
  })
})

describe('staff list', () => {
  it('keeps active workers only, by name', () => {
    const staff: StaffEntry[] = [
      { id: 3, full_name: 'Zaki', role: 'housekeeper', active: true },
      { id: 1, full_name: 'Ali', role: 'technician', active: true },
      { id: 2, full_name: 'Omar', role: 'housekeeper', active: false },
    ]
    expect(sortedStaff(staff).map((s) => s.id)).toEqual([1, 3])
  })
})
