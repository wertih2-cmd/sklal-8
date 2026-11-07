import { describe, it, expect } from 'vitest'
import { filterIncidents, matchesStatus, queryTokens, type FeedIncident, type IncidentMatchContext } from './incidentFilter'

function inc(partial: Partial<FeedIncident>): FeedIncident {
  return {
    status: 'new',
    kind: 'broken',
    item_id: null,
    apartment_id: 1,
    free_text: null,
    comment: null,
    resolution_note: null,
    ...partial,
  }
}

const ctx: IncidentMatchContext = {
  apartmentCode: (id) => ({ 1: 'B1/101', 2: 'B2/202' } as Record<number, string>)[id],
  itemMatches: (token, itemId) => (itemId === 7 ? ['kettle', 'чайник', 'غلاية'].some((n) => n.includes(token)) : false),
}

const all = { status: 'all', kind: 'all', query: '' } as const

describe('matchesStatus', () => {
  it('open means new or in progress', () => {
    expect(matchesStatus('new', 'open')).toBe(true)
    expect(matchesStatus('in_progress', 'open')).toBe(true)
    expect(matchesStatus('confirmed', 'open')).toBe(false)
    expect(matchesStatus('rejected', 'open')).toBe(false)
  })

  it('all matches everything, a concrete status matches only itself', () => {
    expect(matchesStatus('rejected', 'all')).toBe(true)
    expect(matchesStatus('new', 'confirmed')).toBe(false)
    expect(matchesStatus('confirmed', 'confirmed')).toBe(true)
  })
})

describe('queryTokens', () => {
  it('splits on whitespace, lowercases and drops empties', () => {
    expect(queryTokens('  B1/101   Чайник ')).toEqual(['b1/101', 'чайник'])
    expect(queryTokens('   ')).toEqual([])
  })
})

describe('filterIncidents', () => {
  const list = [
    inc({ status: 'new', kind: 'breakdown', apartment_id: 1, free_text: 'Leaking tap' }),
    inc({ status: 'in_progress', kind: 'broken', apartment_id: 2, item_id: 7 }),
    inc({ status: 'confirmed', kind: 'lost', apartment_id: 1, comment: 'Guest left early' }),
    inc({ status: 'rejected', kind: 'broken', apartment_id: 2, resolution_note: 'duplicate' }),
  ]

  it('returns everything for the all/all/empty filter', () => {
    expect(filterIncidents(list, all, ctx)).toHaveLength(4)
  })

  it('filters by status and kind together', () => {
    expect(filterIncidents(list, { status: 'open', kind: 'all', query: '' }, ctx)).toHaveLength(2)
    expect(filterIncidents(list, { status: 'all', kind: 'broken', query: '' }, ctx)).toHaveLength(2)
    expect(filterIncidents(list, { status: 'open', kind: 'broken', query: '' }, ctx)).toHaveLength(1)
  })

  it('searches by apartment code, case-insensitively', () => {
    expect(filterIncidents(list, { ...all, query: 'b1/101' }, ctx)).toHaveLength(2)
    expect(filterIncidents(list, { ...all, query: 'B2' }, ctx)).toHaveLength(2)
  })

  it('searches free text, comment and resolution note', () => {
    expect(filterIncidents(list, { ...all, query: 'leaking' }, ctx)).toHaveLength(1)
    expect(filterIncidents(list, { ...all, query: 'guest' }, ctx)).toHaveLength(1)
    expect(filterIncidents(list, { ...all, query: 'duplicate' }, ctx)).toHaveLength(1)
  })

  it('searches item names in any language through the context', () => {
    expect(filterIncidents(list, { ...all, query: 'kettle' }, ctx)).toHaveLength(1)
    expect(filterIncidents(list, { ...all, query: 'чайник' }, ctx)).toHaveLength(1)
    expect(filterIncidents(list, { ...all, query: 'غلاية' }, ctx)).toHaveLength(1)
  })

  it('requires every token to match (AND)', () => {
    expect(filterIncidents(list, { ...all, query: 'b1/101 leaking' }, ctx)).toHaveLength(1)
    expect(filterIncidents(list, { ...all, query: 'b2/202 leaking' }, ctx)).toHaveLength(0)
  })

  it('does not match an unknown apartment or a missing item', () => {
    const one = [inc({ apartment_id: 99, item_id: null })]
    expect(filterIncidents(one, { ...all, query: 'b1' }, ctx)).toHaveLength(0)
    expect(filterIncidents(one, { ...all, query: '' }, ctx)).toHaveLength(1)
  })
})
