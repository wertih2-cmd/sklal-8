import { describe, it, expect } from 'vitest'
import { FEW_LINES_MAX, levelOf, summarizeCompleteness, ringArcs } from './completeness'

describe('levelOf', () => {
  it('no short lines is complete', () => {
    expect(levelOf(0)).toBe('complete')
    expect(levelOf(-1)).toBe('complete')
  })
  it('a few short lines up to the limit', () => {
    expect(levelOf(1)).toBe('few')
    expect(levelOf(FEW_LINES_MAX)).toBe('few')
  })
  it('more than the limit is many', () => {
    expect(levelOf(FEW_LINES_MAX + 1)).toBe('many')
  })
})

describe('summarizeCompleteness', () => {
  it('counts apartments by level; an id missing from the map is complete', () => {
    const gaps = new Map([[1, 1], [2, 5], [3, 3]])
    const s = summarizeCompleteness([1, 2, 3, 4, 5], gaps)
    expect(s).toEqual({ total: 5, complete: 2, few: 2, many: 1, pct: 40 })
  })
  it('ignores gap rows of apartments that are not in the list', () => {
    const s = summarizeCompleteness([1, 2], new Map([[99, 7]]))
    expect(s).toEqual({ total: 2, complete: 2, few: 0, many: 0, pct: 100 })
  })
  it('never shows 100 while something is short', () => {
    const ids = Array.from({ length: 300 }, (_, i) => i + 1)
    const s = summarizeCompleteness(ids, new Map([[1, 2]]))
    expect(s.complete).toBe(299)
    expect(s.pct).toBe(99)
  })
  it('no apartments gives zeros', () => {
    expect(summarizeCompleteness([], new Map())).toEqual({ total: 0, complete: 0, few: 0, many: 0, pct: 0 })
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
