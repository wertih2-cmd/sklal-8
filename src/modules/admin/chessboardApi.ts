import { supabase } from '@/lib/supabase'
import { fetchAllPages } from '@/lib/paginate'
import type { BoardCleaningRow, BoardIncidentRow } from './chessboardModel'

/** Cleanings of the window [fromISO, toISO). Read only; paged, stable order. */
export function fetchBoardCleanings(fromISO: string, toISO: string): Promise<BoardCleaningRow[]> {
  return fetchAllPages<BoardCleaningRow>((from, to) =>
    supabase
      .from('cleaning_events')
      .select('id,apartment_id,cleaned_at,status,posting_status,note')
      .gte('cleaned_at', fromISO)
      .lt('cleaned_at', toISO)
      .order('cleaned_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

/** Incidents (requests and breakdowns) of the window [fromISO, toISO). Read only; paged, stable order. */
export function fetchBoardIncidents(fromISO: string, toISO: string): Promise<BoardIncidentRow[]> {
  return fetchAllPages<BoardIncidentRow>((from, to) =>
    supabase
      .from('incidents')
      .select('id,apartment_id,kind,status,created_at,free_text,comment')
      .gte('created_at', fromISO)
      .lt('created_at', toISO)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}
