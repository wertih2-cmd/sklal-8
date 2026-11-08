import { describe, it, expect } from 'vitest'
import { cleaningState, filterCleanings, countByState, type CleaningFeedRow } from './cleaningFeed'

function row(partial: Partial<CleaningFeedRow>): CleaningFeedRow {
  return {
    id: 'c1', apartment_id: 1, cleaned_at: '2026-11-05T10:00:00Z', status: 'done', posting_status: 'posted',
    note: null, media_count: 0, staff_names: [], ...partial,
  }
}

const code = (id: number) => ({ 1: 'B1/101', 2: 'B2/202' } as Record<number, string>)[id]
const all = { state: 'all', query: '' } as const

describe('cleaningState', () => {
  it('uses the posting status for a normal cleaning', () => {
    expect(cleaningState(row({ posting_status: 'pending' }))).toBe('pending')
    expect(cleaningState(row({ posting_status: 'posted' }))).toBe('posted')
    expect(cleaningState(row({ posting_status: 'rejected' }))).toBe('rejected')
  })

  it('a reversed cleaning is reversed whatever its posting status', () => {
    expect(cleaningState(row({ status: 'reversed', posting_status: 'posted' }))).toBe('reversed')
    expect(cleaningState(row({ status: 'reversed', posting_status: 'pending' }))).toBe('reversed')
  })
})

describe('filterCleanings', () => {
  const rows = [
    row({ id: 'a', apartment_id: 1, posting_status: 'pending', staff_names: ['Ahmed Ali'] }),
    row({ id: 'b', apartment_id: 2, posting_status: 'posted', staff_names: ['Mona', 'Sara'], note: 'Late checkout' }),
    row({ id: 'c', apartment_id: 2, status: 'reversed', staff_names: ['Mona'] }),
    row({ id: 'd', apartment_id: 1, posting_status: 'rejected' }),
  ]

  it('returns everything for all/empty', () => {
    expect(filterCleanings(rows, all, code)).toHaveLength(4)
  })

  it('filters by state, a reversed one only under "reversed"', () => {
    expect(filterCleanings(rows, { state: 'posted', query: '' }, code).map((r) => r.id)).toEqual(['b'])
    expect(filterCleanings(rows, { state: 'reversed', query: '' }, code).map((r) => r.id)).toEqual(['c'])
    expect(filterCleanings(rows, { state: 'pending', query: '' }, code).map((r) => r.id)).toEqual(['a'])
  })

  it('searches the apartment code case-insensitively', () => {
    expect(filterCleanings(rows, { ...all, query: 'b2/202' }, code)).toHaveLength(2)
    expect(filterCleanings(rows, { ...all, query: 'B1' }, code)).toHaveLength(2)
  })

  it('searches staff names and the note', () => {
    expect(filterCleanings(rows, { ...all, query: 'mona' }, code).map((r) => r.id)).toEqual(['b', 'c'])
    expect(filterCleanings(rows, { ...all, query: 'checkout' }, code).map((r) => r.id)).toEqual(['b'])
  })

  it('requires every token to match (AND), across different fields', () => {
    expect(filterCleanings(rows, { ...all, query: 'b2 sara' }, code).map((r) => r.id)).toEqual(['b'])
    expect(filterCleanings(rows, { ...all, query: 'b1 sara' }, code)).toHaveLength(0)
  })

  it('combines state and search', () => {
    expect(filterCleanings(rows, { state: 'posted', query: 'mona' }, code).map((r) => r.id)).toEqual(['b'])
  })

  it('handles an unknown apartment and missing staff', () => {
    const one = [row({ apartment_id: 99, staff_names: [] })]
    expect(filterCleanings(one, { ...all, query: 'b1' }, code)).toHaveLength(0)
    expect(filterCleanings(one, all, code)).toHaveLength(1)
  })
})

describe('countByState', () => {
  it('counts rows per state', () => {
    const rows = [
      row({ posting_status: 'pending' }), row({ posting_status: 'pending' }),
      row({ status: 'reversed' }), row({ posting_status: 'rejected' }),
    ]
    expect(countByState(rows)).toEqual({ pending: 2, posted: 0, rejected: 1, reversed: 1 })
  })
})
