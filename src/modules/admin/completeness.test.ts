import { describe, it, expect } from 'vitest'
import { ALMOST_PCT, coveredPct, levelOf, summarizeCompleteness, ringArcs } from './completeness'

describe('levelOf', () => {
  it('no norm lines at all is "none"', () => {
    expect(levelOf(undefined)).toBe('none')
    expect(levelOf({ total: 0, missing: 0 })).toBe('none')
  })
  it('nothing short is complete', () => {
    expect(levelOf({ total: 10, missing: 0 })).toBe('complete')
  })
  it('the threshold is inclusive: exactly 75% covered is almost', () => {
    expect(ALMOST_PCT).toBe(75)
    expect(levelOf({ total: 4, missing: 1 })).toBe('almost')
    expect(levelOf({ total: 10, missing: 2 })).toBe('almost')
  })
  it('below the threshold is low', () => {
    expect(levelOf({ total: 4, missing: 2 })).toBe('low')
    expect(levelOf({ total: 10, missing: 3 })).toBe('low')
    expect(levelOf({ total: 5, missing: 5 })).toBe('low')
  })
})

describe('summarizeCompleteness', () => {
  it('counts apartments by level; an id missing from the map has no norms', () => {
    const by = new Map([
      [1, { total: 10, missing: 0 }],
      [2, { total: 10, missing: 2 }],
      [3, { total: 10, missing: 6 }],
      [4, { total: 3, missing: 0 }],
    ])
    const s = summarizeCompleteness([1, 2, 3, 4, 5], by)
    expect(s).toEqual({ total: 4, complete: 2, almost: 1, low: 1, noNorms: 1, pct: 50 })
  })
  it('apartments without norms do not count in the share', () => {
    const s = summarizeCompleteness([1, 2, 3], new Map([[1, { total: 2, missing: 0 }]]))
    expect(s.total).toBe(1)
    expect(s.noNorms).toBe(2)
    expect(s.pct).toBe(100)
  })
  it('ignores entries of apartments that are not in the list', () => {
    const s = summarizeCompleteness([1], new Map([[99, { total: 5, missing: 5 }]]))
    expect(s).toEqual({ total: 0, complete: 0, almost: 0, low: 0, noNorms: 1, pct: 0 })
  })
  it('never shows 100 while something is short', () => {
    const ids = Array.from({ length: 300 }, (_, i) => i + 1)
    const by = new Map(ids.map((id) => [id, { total: 5, missing: id === 1 ? 1 : 0 }] as const))
    const s = summarizeCompleteness(ids, by)
    expect(s.complete).toBe(299)
    expect(s.pct).toBe(99)
  })
  it('no apartments gives zeros', () => {
    expect(summarizeCompleteness([], new Map())).toEqual({ total: 0, complete: 0, almost: 0, low: 0, noNorms: 0, pct: 0 })
  })
})

describe('ringArcs', () => {
  const R = 40
  const circ = 2 * Math.PI * R
  it('arcs are proportional and fill the circle', () => {
    const arcs = ringArcs([1, 1, 2], R)
    expect(arcs.map((a) => a.index)).toEqual([0, 1, 2])
    expect(arcs[0].length).toBeCloseTo(circ / 4)
    expect(arcs[2].length).toBeCloseTo(circ / 2)
    expect(arcs.reduce((s, a) => s + a.length, 0)).toBeCloseTo(circ)
  })
  it('offsets accumulate', () => {
    const arcs = ringArcs([3, 1], R)
    expect(arcs[0].offset).toBe(0)
    expect(arcs[1].offset).toBeCloseTo(arcs[0].length)
  })
  it('skips empty parts but keeps the index of the others', () => {
    const arcs = ringArcs([0, 2, 0, 2], R)
    expect(arcs.map((a) => a.index)).toEqual([1, 3])
    expect(arcs[1].offset).toBeCloseTo(circ / 2)
  })
  it('nothing to draw when all values are zero', () => {
    expect(ringArcs([0, 0, 0], R)).toEqual([])
    expect(ringArcs([], R)).toEqual([])
  })
})

describe('coveredPct', () => {
  it('an apartment without any norm line shows 0, not 100', () => {
    expect(coveredPct(0, 0)).toBe(0)
    expect(coveredPct(0, 3)).toBe(0)
    expect(coveredPct(-1, 0)).toBe(0)
    expect(coveredPct(Number.NaN, 0)).toBe(0)
  })
  it('everything covered is 100', () => {
    expect(coveredPct(12, 0)).toBe(100)
  })
  it('everything short is 0', () => {
    expect(coveredPct(12, 12)).toBe(0)
  })
  it('a share in between is rounded', () => {
    expect(coveredPct(4, 1)).toBe(75)
    expect(coveredPct(3, 1)).toBe(67)
  })
  it('one short line never rounds up to 100', () => {
    expect(coveredPct(300, 1)).toBe(99)
  })
  it('a missing count above the total or below zero is kept in range', () => {
    expect(coveredPct(5, 9)).toBe(0)
    expect(coveredPct(5, -2)).toBe(100)
  })
})
