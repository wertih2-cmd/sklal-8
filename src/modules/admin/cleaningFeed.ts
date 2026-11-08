import type { EventStatus } from '@/lib/database.types'
import { queryTokens } from '@/modules/admin/incidentFilter'

export type PostingStatus = 'pending' | 'posted' | 'rejected'

/** What the feed shows for a cleaning: a reversed one is "reversed" whatever its posting status was. */
export type CleaningState = 'pending' | 'posted' | 'rejected' | 'reversed'
export type CleaningFilter = 'all' | CleaningState

export const CLEANING_FILTERS: CleaningFilter[] = ['all', 'pending', 'posted', 'rejected', 'reversed']

export interface CleaningFeedRow {
  id: string
  apartment_id: number
  cleaned_at: string
  status: EventStatus
  posting_status: PostingStatus
  note: string | null
  media_count: number
  staff_names: string[]
}

export function cleaningState(row: Pick<CleaningFeedRow, 'status' | 'posting_status'>): CleaningState {
  if (row.status === 'reversed') return 'reversed'
  return row.posting_status
}

export interface CleaningFilterInput {
  state: CleaningFilter
  query: string
}

/** Every token of the query must match the apartment code, a staff name or the note. */
export function filterCleanings(
  rows: CleaningFeedRow[],
  input: CleaningFilterInput,
  apartmentCode: (apartmentId: number) => string | undefined,
): CleaningFeedRow[] {
  const tokens = queryTokens(input.query)
  return rows.filter((row) => {
    if (input.state !== 'all' && cleaningState(row) !== input.state) return false
    if (tokens.length === 0) return true
    const haystacks = [apartmentCode(row.apartment_id), row.note, ...row.staff_names]
      .filter((value): value is string => value != null && value !== '')
      .map((value) => value.toLowerCase())
    return tokens.every((token) => haystacks.some((text) => text.includes(token)))
  })
}

export function countByState(rows: CleaningFeedRow[]): Record<CleaningState, number> {
  const counts: Record<CleaningState, number> = { pending: 0, posted: 0, rejected: 0, reversed: 0 }
  for (const row of rows) counts[cleaningState(row)]++
  return counts
}
