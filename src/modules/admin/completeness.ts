/** How many short lines (items below the apartment norm) still count as "a little short". */
export const FEW_LINES_MAX = 3

export type CompletenessLevel = 'complete' | 'few' | 'many'

export interface CompletenessSummary {
  total: number
  complete: number
  few: number
  many: number
  /** Share of fully complete apartments, 0..100. 100 only when every apartment is complete. */
  pct: number
}

export function levelOf(shortLines: number): CompletenessLevel {
  if (shortLines <= 0) return 'complete'
  return shortLines <= FEW_LINES_MAX ? 'few' : 'many'
}

/**
 * Counts apartments by how many norm lines are short. `shortLinesByApartment` holds only apartments that have at
 * least one short line (the apartment_gap query returns just those); a missing id means "no short lines".
 * Gap rows of ids that are not in `apartmentIds` are ignored.
 */
export function summarizeCompleteness(
  apartmentIds: readonly number[],
  shortLinesByApartment: ReadonlyMap<number, number>,
): CompletenessSummary {
  let complete = 0
  let few = 0
  let many = 0
  for (const id of apartmentIds) {
    const level = levelOf(shortLinesByApartment.get(id) ?? 0)
    if (level === 'complete') complete++
    else if (level === 'few') few++
    else many++
  }
  const total = complete + few + many
  let pct = 0
  if (total > 0) pct = complete === total ? 100 : Math.min(99, Math.round((complete / total) * 100))
  return { total, complete, few, many, pct }
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
