import { describe, it, expect } from 'vitest'
import {
  buildDigest,
  toAiPayload,
  mergeCleanings,
  periodMs,
  type DigestInput,
  type DigestIncident,
  type DigestCleaning,
  type DigestShortage,
} from './digest'

const NOW = Date.parse('2026-11-12T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()
const codes: Record<number, string> = { 1: 'B1/101', 2: 'B1/102', 3: 'B2/201' }

function input(partial: Partial<DigestInput> = {}): DigestInput {
  return {
    now: NOW,
    period: '24h',
    incidents: [],
    cleanings: [],
    shortages: [],
    stock: [],
    spend: { current: 0, previous: null },
    apartmentCode: (id) => codes[id],
    ...partial,
  }
}

const inc = (p: Partial<DigestIncident> = {}): DigestIncident => ({ apartment_id: 1, kind: 'broken', status: 'new', created_at: ago(1), ...p })
const cln = (p: Partial<DigestCleaning> = {}): DigestCleaning => ({ apartment_id: 1, cleaned_at: ago(1), status: 'done', posting_status: 'pending', ...p })
const sht = (p: Partial<DigestShortage> = {}): DigestShortage => ({ apartment_id: 1, created_at: ago(1), ...p })

const apt = (d: ReturnType<typeof buildDigest>, id: number) => d.apartments.find((a) => a.apartmentId === id)

describe('buildDigest: red rules', () => {
  it('flags a serious incident open for more than 48 hours', () => {
    const d = buildDigest(input({ incidents: [inc({ created_at: ago(49) })] }))
    expect(apt(d, 1)?.label).toBe('urgent')
    expect(apt(d, 1)?.alerts[0]).toMatchObject({ code: 'incident_overdue', severity: 'red', count: 1, oldestHours: 49 })
  })

  it('does not flag exactly 48 hours, a decided incident, or the "other" kind', () => {
    const d = buildDigest(input({
      incidents: [
        inc({ apartment_id: 1, created_at: ago(48) }),
        inc({ apartment_id: 2, status: 'confirmed', created_at: ago(100) }),
        inc({ apartment_id: 3, kind: 'other', created_at: ago(100) }),
      ],
    }))
    expect(d.redCount).toBe(0)
  })

  it('counts in-progress incidents as still without a decision', () => {
    const d = buildDigest(input({ incidents: [inc({ status: 'in_progress', kind: 'lost', created_at: ago(72) })] }))
    expect(apt(d, 1)?.label).toBe('urgent')
  })

  it('flags an unprocessed shortage older than a day for the apartment it belongs to', () => {
    const d = buildDigest(input({ shortages: [sht({ apartment_id: 2, created_at: ago(30) })] }))
    expect(apt(d, 2)?.alerts[0]).toMatchObject({ code: 'shortage_unprocessed', severity: 'red', apartmentId: 2 })
    expect(apt(d, 2)?.label).toBe('urgent')
    expect(d.warehouse.alerts).toHaveLength(0)
  })

  it('keeps a younger shortage out of the alerts but still counts it', () => {
    const d = buildDigest(input({ shortages: [sht({ created_at: ago(5) })] }))
    expect(d.redCount).toBe(0)
    expect(d.warehouse.unprocessedShortages).toBe(1)
    expect(apt(d, 1)?.oldestWaitingHours).toBe(5)
  })

  it('puts a shortage without an apartment on the warehouse', () => {
    const d = buildDigest(input({ shortages: [sht({ apartment_id: null, created_at: ago(30) })] }))
    expect(d.apartments).toHaveLength(0)
    expect(d.warehouse.unassignedShortages).toBe(1)
    expect(d.warehouse.alerts[0]).toMatchObject({ code: 'shortage_unprocessed', severity: 'red', apartmentId: null })
    expect(d.redCount).toBe(1)
  })

  it('splits shortages between apartments', () => {
    const d = buildDigest(input({
      shortages: [sht({ apartment_id: 1, created_at: ago(30) }), sht({ apartment_id: 1, created_at: ago(50) }), sht({ apartment_id: 3, created_at: ago(2) })],
    }))
    expect(apt(d, 1)?.alerts[0]).toMatchObject({ code: 'shortage_unprocessed', count: 2, oldestHours: 50 })
    expect(apt(d, 3)?.label).toBe('normal')
    expect(d.warehouse.unprocessedShortages).toBe(3)
  })
})

describe('buildDigest: amber rules', () => {
  it('flags a cleaning waiting for approval longer than 24 hours', () => {
    const d = buildDigest(input({ cleanings: [cln({ cleaned_at: ago(25) })] }))
    expect(apt(d, 1)?.label).toBe('attention')
    expect(apt(d, 1)?.alerts[0]).toMatchObject({ code: 'cleaning_waiting', severity: 'amber' })
  })

  it('ignores posted, rejected and reversed cleanings', () => {
    const d = buildDigest(input({
      cleanings: [
        cln({ posting_status: 'posted', cleaned_at: ago(80) }),
        cln({ posting_status: 'rejected', cleaned_at: ago(80) }),
        cln({ status: 'reversed', cleaned_at: ago(80) }),
      ],
    }))
    expect(d.amberCount).toBe(0)
  })

  it('flags two or more incidents in seven days, rejected ones do not count', () => {
    const two = buildDigest(input({ incidents: [inc({ created_at: ago(24) }), inc({ kind: 'other', created_at: ago(100) })] }))
    expect(apt(two, 1)?.repeat).toBe(true)
    expect(apt(two, 1)?.alerts.some((a) => a.code === 'incident_repeat')).toBe(true)

    const withRejected = buildDigest(input({ incidents: [inc({ created_at: ago(24) }), inc({ status: 'rejected', created_at: ago(30) })] }))
    expect(apt(withRejected, 1)?.repeat).toBe(false)

    const old = buildDigest(input({ incidents: [inc({ created_at: ago(24) }), inc({ created_at: ago(24 * 8) })] }))
    expect(apt(old, 1)?.repeat).toBe(false)
  })

  it('counts items below minimum, consumables apart from assets', () => {
    const d = buildDigest(input({
      stock: [
        { kind: 'asset', below_min: true },
        { kind: 'consumable', below_min: true },
        { kind: 'consumable', below_min: true },
        { kind: 'consumable', below_min: false },
      ],
    }))
    expect(d.warehouse.belowMinAssets).toBe(1)
    expect(d.warehouse.belowMinConsumables).toBe(2)
    expect(d.warehouse.alerts[0]).toMatchObject({ code: 'below_min', severity: 'amber', count: 3 })
  })
})

describe('buildDigest: per apartment summary', () => {
  it('counts new records for the chosen period', () => {
    const data = {
      incidents: [inc({ created_at: ago(2) }), inc({ created_at: ago(50) })],
      cleanings: [cln({ cleaned_at: ago(3), posting_status: 'posted' }), cln({ cleaned_at: ago(60), posting_status: 'posted' }), cln({ cleaned_at: ago(1), status: 'reversed' })],
    }
    const day = apt(buildDigest(input({ ...data, period: '24h' })), 1)
    expect(day?.newIncidents).toBe(1)
    expect(day?.newCleanings).toBe(1)
    const week = apt(buildDigest(input({ ...data, period: '7d' })), 1)
    expect(week?.newIncidents).toBe(2)
    expect(week?.newCleanings).toBe(2)
    expect(periodMs('7d')).toBe(7 * periodMs('24h'))
  })

  it('reports the longest waiting record across incidents, cleanings and shortages', () => {
    const d = buildDigest(input({
      incidents: [inc({ created_at: ago(10) })],
      cleanings: [cln({ cleaned_at: ago(20) })],
      shortages: [sht({ created_at: ago(15) })],
    }))
    expect(apt(d, 1)?.oldestWaitingHours).toBe(20)
  })

  it('sorts urgent first, then attention, then normal; falls back to #id without a code', () => {
    const d = buildDigest(input({
      incidents: [inc({ apartment_id: 3, status: 'confirmed' }), inc({ apartment_id: 9, created_at: ago(60) })],
      cleanings: [cln({ apartment_id: 2, cleaned_at: ago(30) })],
    }))
    expect(d.apartments.map((a) => [a.apartmentId, a.label])).toEqual([[9, 'urgent'], [2, 'attention'], [3, 'normal']])
    expect(apt(d, 9)?.code).toBe('#9')
  })

  it('ignores records with an unreadable date instead of failing', () => {
    const d = buildDigest(input({ incidents: [inc({ created_at: 'oops' })], shortages: [sht({ created_at: 'oops' })] }))
    expect(d.redCount).toBe(0)
    expect(apt(d, 1)?.oldestWaitingHours).toBeNull()
  })
})

describe('buildDigest: warehouse spend', () => {
  it('computes the change against the previous period', () => {
    expect(buildDigest(input({ spend: { current: 150, previous: 100 } })).warehouse.spendChangePct).toBe(50)
    expect(buildDigest(input({ spend: { current: 50, previous: 100 } })).warehouse.spendChangePct).toBe(-50)
  })

  it('gives null when there is nothing to compare with', () => {
    expect(buildDigest(input({ spend: { current: 50, previous: null } })).warehouse.spendChangePct).toBeNull()
    expect(buildDigest(input({ spend: { current: 50, previous: 0 } })).warehouse.spendChangePct).toBeNull()
  })
})

describe('toAiPayload', () => {
  it('carries only codes, statuses, ages and numbers', () => {
    const d = buildDigest(input({
      incidents: [inc({ created_at: ago(60) })],
      cleanings: [cln({ cleaned_at: ago(30) })],
      shortages: [sht({ created_at: ago(40) }), sht({ apartment_id: null, created_at: ago(40) })],
      stock: [{ kind: 'asset', below_min: true }],
      spend: { current: 120, previous: 100 },
    }))
    const payload = toAiPayload(d)
    const strings: string[] = []
    JSON.stringify(payload, (_k, v) => { if (typeof v === 'string') strings.push(v); return v })
    const allowed = new Set(['24h', '7d', 'B1/101', 'urgent', 'attention', 'normal', 'red', 'amber', 'incident_overdue', 'shortage_unprocessed', 'cleaning_waiting', 'incident_repeat', 'below_min'])
    for (const s of strings) expect(allowed.has(s)).toBe(true)
    expect(payload.apartments[0]).toMatchObject({ code: 'B1/101', label: 'urgent' })
    expect(payload.warehouse).toMatchObject({ below_min_assets: 1, unassigned_shortages: 1, spend_change_pct: 20 })
  })

  it('leaves quiet apartments out', () => {
    const d = buildDigest(input({ incidents: [inc({ status: 'confirmed', created_at: ago(100) })] }))
    expect(toAiPayload(d).apartments).toHaveLength(0)
  })
})

describe('mergeCleanings', () => {
  it('counts a cleaning found in both lists once, as waiting', () => {
    const merged = mergeCleanings(
      [{ id: 'a', apartment_id: 1, cleaned_at: ago(30), status: 'done', posting_status: 'pending' }, { id: 'b', apartment_id: 2, cleaned_at: ago(5), status: 'done', posting_status: 'posted' }],
      [{ id: 'a', apartment_id: 1, cleaned_at: ago(30) }],
    )
    expect(merged).toHaveLength(2)
    expect(merged.filter((c) => c.posting_status === 'pending')).toHaveLength(1)
  })

  it('keeps an old pending cleaning that is outside the feed window', () => {
    const merged = mergeCleanings([], [{ id: 'z', apartment_id: 3, cleaned_at: ago(24 * 20) }])
    expect(merged).toEqual([{ apartment_id: 3, cleaned_at: ago(24 * 20), status: 'done', posting_status: 'pending' }])
  })
})
