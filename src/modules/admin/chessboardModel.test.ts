import { describe, it, expect } from 'vitest'
import {
  cairoDay, addDays, buildDays, defaultStart, shiftStart, canShiftForward, queryWindow, cleaningEvents, incidentEvents,
  filterByLayer, buildCells, cellKey, dominantLayer, waitingDays, apartmentIdsWithEvents,
  APT_TYPES, aptTypeMap, eventsOfTypes, cleanedPerDay, premiumPerDay, sumOf, cleaningsOfDay,
  type BoardCleaningRow, type BoardIncidentRow,
} from './chessboardModel'

const cl = (p: Partial<BoardCleaningRow>): BoardCleaningRow => ({
  id: 'c1', apartment_id: 1, cleaned_at: '2026-11-10T10:00:00Z', status: 'done', posting_status: 'posted', note: null, ...p,
})
const inc = (p: Partial<BoardIncidentRow>): BoardIncidentRow => ({
  id: 'i1', apartment_id: 1, kind: 'other', status: 'new', created_at: '2026-11-10T10:00:00Z', free_text: null, comment: null, ...p,
})
const days = buildDays('2026-11-08', 7)

describe('days', () => {
  it('cairoDay uses the Cairo calendar, not UTC', () => {
    expect(cairoDay('2026-11-10T10:00:00Z')).toBe('2026-11-10')
    expect(cairoDay('2026-11-10T22:30:00Z')).toBe('2026-11-11')
    expect(cairoDay('not a date')).toBeNull()
  })
  it('addDays crosses month and year borders', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('buildDays and defaultStart: the last column is today', () => {
    expect(buildDays('2026-11-08', 3)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10'])
    expect(buildDays('2026-11-08', 0)).toEqual([])
    const start = defaultStart('2026-11-14', 14)
    expect(start).toBe('2026-11-01')
    expect(buildDays(start, 14).pop()).toBe('2026-11-14')
  })
  it('shifts by weeks and never runs into the future', () => {
    expect(shiftStart('2026-11-01', -1)).toBe('2026-10-25')
    expect(canShiftForward('2026-11-01', 14, '2026-11-14')).toBe(false)
    expect(canShiftForward('2026-10-25', 14, '2026-11-14')).toBe(true)
  })
  it('queryWindow has a day of margin on both sides', () => {
    expect(queryWindow([])).toBeNull()
    expect(queryWindow(['2026-11-08', '2026-11-09'])).toEqual({
      fromISO: '2026-11-07T00:00:00.000Z', toISO: '2026-11-11T00:00:00.000Z',
    })
  })
})

describe('events', () => {
  it('drops reversed and rejected cleanings and cleanings outside the window', () => {
    const rows = [
      cl({ id: 'a' }),
      cl({ id: 'b', status: 'reversed' }),
      cl({ id: 'c', posting_status: 'rejected' }),
      cl({ id: 'd', cleaned_at: '2026-11-20T10:00:00Z' }),
    ]
    expect(cleaningEvents(rows, days).map((e) => e.id)).toEqual(['a'])
  })
  it('a cleaning waits while posting_status is pending', () => {
    const [a, b] = cleaningEvents([cl({ id: 'a', posting_status: 'pending' }), cl({ id: 'b' })], days)
    expect([a.pending, b.pending]).toEqual([true, false])
    expect(a.layer).toBe('cleanings')
  })
  it('breakdown is a breakdown, every other kind is a request; rejected is dropped', () => {
    const rows = [
      inc({ id: '1', kind: 'breakdown' }), inc({ id: '2', kind: 'broken' }), inc({ id: '3', kind: 'lost' }),
      inc({ id: '4', kind: 'other' }), inc({ id: '5', kind: 'damaged' }), inc({ id: '6', status: 'rejected' }),
    ]
    const ev = incidentEvents(rows, days)
    expect(ev.map((e) => [e.id, e.layer])).toEqual([
      ['1', 'breakdowns'], ['2', 'requests'], ['3', 'requests'], ['4', 'requests'], ['5', 'requests'],
    ])
  })
  it('a request waits only while it is new; the text falls back to the comment', () => {
    const ev = incidentEvents([
      inc({ id: '1', status: 'new', free_text: 'leak' }),
      inc({ id: '2', status: 'in_progress', comment: 'plumber called' }),
      inc({ id: '3', status: 'confirmed' }),
    ], days)
    expect(ev.map((e) => e.pending)).toEqual([true, false, false])
    expect(ev.map((e) => e.text)).toEqual(['leak', 'plumber called', null])
  })
})

describe('cells', () => {
  const events = [
    ...cleaningEvents([cl({ id: 'c1', cleaned_at: '2026-11-10T08:00:00Z', posting_status: 'pending' })], days),
    ...incidentEvents([
      inc({ id: 'i1', kind: 'breakdown', created_at: '2026-11-10T06:00:00Z' }),
      inc({ id: 'i2', kind: 'other', created_at: '2026-11-10T12:00:00Z', status: 'confirmed' }),
      inc({ id: 'i3', apartment_id: 2, created_at: '2026-11-09T09:00:00Z' }),
    ], days),
  ]
  it('groups by apartment and day, counts, pending and the oldest pending', () => {
    const cells = buildCells(events)
    const c = cells.get(cellKey(1, '2026-11-10'))!
    expect(c.count).toBe(3)
    expect(c.pending).toBe(2)
    expect(c.oldestPending).toBe('2026-11-10T06:00:00Z')
    expect(c.layers).toEqual({ cleanings: 1, requests: 1, breakdowns: 1 })
    expect(c.events.map((e) => e.id)).toEqual(['i1', 'c1', 'i2'])
    expect(cells.get(cellKey(2, '2026-11-09'))!.count).toBe(1)
    expect(cells.get(cellKey(2, '2026-11-10'))).toBeUndefined()
  })
  it('the layer filter changes the counts', () => {
    const only = buildCells(filterByLayer(events, 'cleanings'))
    expect(only.get(cellKey(1, '2026-11-10'))!.count).toBe(1)
    expect(only.get(cellKey(2, '2026-11-09'))).toBeUndefined()
    expect(filterByLayer(events, 'all')).toHaveLength(events.length)
  })
  it('dominant layer: breakdown, then request, then cleaning', () => {
    const l = (cleanings: number, requests: number, breakdowns: number) => dominantLayer({ layers: { cleanings, requests, breakdowns } })
    expect(l(1, 1, 1)).toBe('breakdowns')
    expect(l(1, 1, 0)).toBe('requests')
    expect(l(1, 0, 0)).toBe('cleanings')
    expect(l(0, 0, 0)).toBeNull()
  })
  it('empty data gives empty results', () => {
    expect(buildCells([]).size).toBe(0)
    expect(apartmentIdsWithEvents([])).toEqual(new Set())
    expect(apartmentIdsWithEvents(events)).toEqual(new Set([1, 2]))
  })
})

describe('waitingDays', () => {
  it('counts whole days, never negative', () => {
    expect(waitingDays('2026-11-10T06:00:00Z', '2026-11-14T05:00:00Z')).toBe(3)
    expect(waitingDays('2026-11-10T06:00:00Z', '2026-11-10T20:00:00Z')).toBe(0)
    expect(waitingDays('2026-11-15T06:00:00Z', '2026-11-14T05:00:00Z')).toBe(0)
    expect(waitingDays('garbage', '2026-11-14T05:00:00Z')).toBe(0)
  })
})

describe('categories, daily totals and premium', () => {
  const typeOf = aptTypeMap([
    { id: 1, type: 'studio' }, { id: 2, type: '1br' }, { id: 3, type: '2br' },
  ])
  const week = buildDays('2026-11-08', 7)
  const rows = [
    cl({ id: 'a', apartment_id: 1, cleaned_at: '2026-11-10T08:00:00Z' }),
    cl({ id: 'b', apartment_id: 2, cleaned_at: '2026-11-10T09:00:00Z' }),
    cl({ id: 'c', apartment_id: 3, cleaned_at: '2026-11-11T09:00:00Z' }),
    cl({ id: 'd', apartment_id: 1, cleaned_at: '2026-11-11T10:00:00Z' }),
    cl({ id: 'x', apartment_id: 1, cleaned_at: '2026-11-11T11:00:00Z', posting_status: 'rejected' }),
    cl({ id: 'y', apartment_id: 2, cleaned_at: '2026-11-11T12:00:00Z', status: 'reversed' }),
  ]
  const events = cleaningEvents(rows, week)

  it('lists the categories in the order of the legend', () => {
    expect(APT_TYPES).toEqual(['studio', '1br', '2br'])
  })

  it('an empty choice keeps every category, a choice keeps only its own', () => {
    expect(eventsOfTypes(events, new Set(), typeOf)).toHaveLength(4)
    expect(eventsOfTypes(events, new Set(['studio']), typeOf).map((e) => e.id)).toEqual(['a', 'd'])
    expect(eventsOfTypes(events, new Set(['1br', '2br']), typeOf).map((e) => e.id)).toEqual(['b', 'c'])
  })

  it('drops events of an apartment whose category is unknown once a category is chosen', () => {
    const lone = cleaningEvents([cl({ id: 'z', apartment_id: 99 })], week)
    expect(eventsOfTypes(lone, new Set(['studio']), typeOf)).toEqual([])
    expect(eventsOfTypes(lone, new Set(), typeOf)).toHaveLength(1)
  })

  it('counts cleanings per day, rejected and reversed ones are not counted, empty days are 0', () => {
    const per = cleanedPerDay(events, week)
    expect(per.size).toBe(7)
    expect(per.get('2026-11-10')).toBe(2)
    expect(per.get('2026-11-11')).toBe(2)
    expect(per.get('2026-11-08')).toBe(0)
  })

  it('counts only cleanings, not requests or breakdowns', () => {
    const mixed = [...events, ...incidentEvents([inc({ id: 'q', apartment_id: 1, created_at: '2026-11-10T10:00:00Z' })], week)]
    expect(cleanedPerDay(mixed, week).get('2026-11-10')).toBe(2)
  })

  it('sums the premium per day from the rate of the category', () => {
    const res = premiumPerDay(events, week, typeOf, { studio: 30, '1br': 40, '2br': 50 })
    expect(res.incomplete).toBe(false)
    expect(res.byDay.get('2026-11-10')).toBe(70)
    expect(res.byDay.get('2026-11-11')).toBe(80)
    expect(res.byDay.get('2026-11-09')).toBe(0)
    expect(sumOf(res.byDay.values())).toBe(150)
  })

  it('keeps cents exact when rates have kopecks', () => {
    const many = cleaningEvents(Array.from({ length: 10 }, (_, i) => cl({ id: `m${i}`, apartment_id: 1, cleaned_at: '2026-11-10T08:00:00Z' })), week)
    const res = premiumPerDay(many, week, typeOf, { studio: 0.1 })
    expect(res.byDay.get('2026-11-10')).toBe(1)
    expect(sumOf([0.1, 0.2])).toBe(0.3)
  })

  it('marks the result incomplete when a category has no rate and leaves that cleaning out', () => {
    const res = premiumPerDay(events, week, typeOf, { studio: 30, '1br': 40 })
    expect(res.incomplete).toBe(true)
    expect(res.byDay.get('2026-11-11')).toBe(30)
  })

  it('lists the cleanings of a day earliest first', () => {
    expect(cleaningsOfDay(events, '2026-11-11').map((e) => e.id)).toEqual(['c', 'd'])
    expect(cleaningsOfDay(events, '2026-11-12')).toEqual([])
  })
})
