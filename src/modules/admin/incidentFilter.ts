import type { Incident, IncidentKind, IncidentStatus } from '@/lib/database.types'

/** 'open' = waiting for a decision or being handled (new + in progress) */
export type StatusFilter = 'open' | 'all' | IncidentStatus
export type KindFilter = 'all' | IncidentKind

export const STATUS_FILTERS: StatusFilter[] = ['open', 'all', 'new', 'in_progress', 'confirmed', 'rejected']
export const KIND_FILTERS: KindFilter[] = ['all', 'breakdown', 'broken', 'damaged', 'lost', 'other']

export type FeedIncident = Pick<
  Incident,
  'status' | 'kind' | 'item_id' | 'apartment_id' | 'free_text' | 'comment' | 'resolution_note'
>

export interface IncidentFilterInput {
  status: StatusFilter
  kind: KindFilter
  query: string
}

export interface IncidentMatchContext {
  apartmentCode(apartmentId: number): string | undefined
  /** true when the (lowercased) token matches the item's name in any language */
  itemMatches(token: string, itemId: number): boolean
}

export function matchesStatus(status: IncidentStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return status === 'new' || status === 'in_progress'
  return status === filter
}

export function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function has(text: string | null | undefined, token: string): boolean {
  return text != null && text.toLowerCase().includes(token)
}

/** Every token must match the apartment code, item name, description, comment or resolution note. */
export function filterIncidents<T extends FeedIncident>(
  list: T[],
  input: IncidentFilterInput,
  ctx: IncidentMatchContext,
): T[] {
  const tokens = queryTokens(input.query)
  return list.filter((inc) => {
    if (!matchesStatus(inc.status, input.status)) return false
    if (input.kind !== 'all' && inc.kind !== input.kind) return false
    if (tokens.length === 0) return true
    const code = ctx.apartmentCode(inc.apartment_id)
    return tokens.every((token) =>
      has(code, token)
      || has(inc.free_text, token)
      || has(inc.comment, token)
      || has(inc.resolution_note, token)
      || (inc.item_id != null && ctx.itemMatches(token, inc.item_id)),
    )
  })
}
