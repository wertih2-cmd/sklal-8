/** From this share of covered norm lines an apartment counts as "almost complete" (same threshold as the bars). */
export const ALMOST_PCT = 75

export type CompletenessLevel = 'complete' | 'almost' | 'low' | 'none'

/** Norm lines of one apartment: how many it has in total and how many of them are short. */
export interface ApartmentNorms {
  total: number
  missing: number
}

export interface CompletenessSummary {
  /** Apartments that have norms: only they take part in the ring. */
  total: number
  complete: number
  almost: number
  low: number
  /** Apartments without any norm line: completeness is not defined for them. */
  noNorms: number
  /** Share of complete apartments among those with norms, 0..100. 100 only when every one is complete. */
  pct: number
}

export function levelOf(n: ApartmentNorms | undefined): CompletenessLevel {
  if (!n || n.total <= 0) return 'none'
  if (n.missing <= 0) return 'complete'
  const covered = ((n.total - n.missing) / n.total) * 100
  return covered >= ALMOST_PCT ? 'almost' : 'low'
}

/**
 * Counts apartments by how well their norms are covered. `byApartment` has an entry for every apartment that has
 * norm lines; an id missing from it means "no norms". Entries of ids that are not in `apartmentIds` are ignored.
 */
export function summarizeCompleteness(
  apartmentIds: readonly number[],
  byApartment: ReadonlyMap<number, ApartmentNorms>,
): CompletenessSummary {
  let complete = 0
  let almost = 0
  let low = 0
  let noNorms = 0
  for (const id of apartmentIds) {
    const level = levelOf(byApartment.get(id))
    if (level === 'complete') complete++
    else if (level === 'almost') almost++
    else if (level === 'low') low++
    else noNorms++
  }
  const total = complete + almost + low
  let pct = 0
  if (total > 0) pct = complete === total ? 100 : Math.min(99, Math.round((complete / total) * 100))
  return { total, complete, almost, low, noNorms, pct }
}

export interface RingArc {
  /** Index of the value in the input array. */
  index: number
  length: number
  /** Distance from the start of the circle. */
  offset: number
}

/** Splits a circle of the given radius into arcs proportional to the values. Zero and negative values get no arc. */
export function ringArcs(values: readonly number[], radius: number): RingArc[] {
  const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0)
  if (total <= 0) return []
  const circ = 2 * Math.PI * radius
  const arcs: RingArc[] = []
  let acc = 0
  values.forEach((v, index) => {
    if (!(v > 0)) return
    const length = (circ * v) / total
    arcs.push({ index, length, offset: acc })
    acc += length
  })
  return arcs
}
