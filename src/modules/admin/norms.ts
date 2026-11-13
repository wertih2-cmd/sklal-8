import { supabase } from '@/lib/supabase'
import { toApiError } from '@/lib/errors'
import type { NormRuleRow, NormType, ItemKind, Category } from '@/lib/database.types'
import { ALL_NORM_TYPES, countByApartment, readCount } from '@/modules/admin/aptNormsModel'

export interface MergedNormRow {
  itemId: number
  qty: number
  source: 'template' | 'custom'
  excluded: boolean
  overrideId?: number
  templateQty?: number
  note: string | null
}

export function mergeNorms(
  templateRows: NormRuleRow[],
  overrideRows: NormRuleRow[],
): Map<NormType, MergedNormRow[]> {
  const result = new Map<NormType, MergedNormRow[]>()

  const allTypes: NormType[] = ['asset_standing', 'turnover_replenish', 'cleaning_consumption']

  for (const nt of allTypes) {
    const templates = templateRows.filter((r) => r.norm_type === nt)
    const overrides = overrideRows.filter((r) => r.norm_type === nt)
    const rows: MergedNormRow[] = []

    const overrideMap = new Map(overrides.map((o) => [o.item_id, o]))
    const templateMap = new Map(templates.map((t) => [t.item_id, t]))

    for (const [itemId, ov] of overrideMap) {
      const tmpl = templateMap.get(itemId)
      rows.push({
        itemId,
        qty: Number(ov.qty),
        source: 'custom',
        excluded: Number(ov.qty) === 0,
        overrideId: ov.id,
        templateQty: tmpl ? Number(tmpl.qty) : undefined,
        note: ov.note,
      })
    }

    for (const [itemId, tmpl] of templateMap) {
      if (overrideMap.has(itemId)) continue
      rows.push({
        itemId,
        qty: Number(tmpl.qty),
        source: 'template',
        excluded: Number(tmpl.qty) === 0,
        templateQty: Number(tmpl.qty),
        note: tmpl.note,
      })
    }

    rows.sort((a, b) => a.itemId - b.itemId)
    result.set(nt, rows)
  }

  return result
}

export interface NormCatalogItem {
  id: number
  name: string
  category: string
  kind: ItemKind
  base_unit: string
  pack_size: number
  pack_label: string
  active: boolean
}

export async function fetchNormCatalog(): Promise<NormCatalogItem[]> {
  const { data: items, error, status } = await supabase
    .from('items')
    .select('id,name,base_unit,pack_size,pack_label,category_id,active')
    .order('name')
  if (error) throw toApiError(error, status)

  const catIds = Array.from(new Set((items ?? []).map((i) => i.category_id)))
  const { data: cats, error: catError, status: catStatus } = catIds.length
    ? await supabase.from('categories').select('id,name,kind').in('id', catIds)
    : { data: [], error: null, status: 200 }
  if (catError) throw toApiError(catError, catStatus)
  const catMap = new Map(
    (cats as Category[] | null ?? []).map((c) => [c.id, c]),
  )

  return (items ?? []).map((i) => {
    const cat = catMap.get(i.category_id)
    return {
      id: i.id,
      name: i.name,
      category: cat?.name ?? '—',
      kind: cat?.kind ?? 'consumable',
      base_unit: i.base_unit,
      pack_size: i.pack_size,
      pack_label: i.pack_label,
      active: i.active,
    }
  })
}

export async function apartmentNormsMaterialize(
  apartmentId: number,
  normTypes: NormType[],
): Promise<unknown> {
  const { data, error, status } = await supabase.rpc('apartment_norms_materialize', {
    p_apartment: apartmentId,
    p_norm_types: normTypes,
  })
  if (error) throw toApiError(error, status)
  return data
}

export async function apartmentNormsReset(
  apartmentId: number,
  normTypes: NormType[],
): Promise<unknown> {
  const { data, error, status } = await supabase.rpc('apartment_norms_reset', {
    p_apartment: apartmentId,
    p_norm_types: normTypes,
  })
  if (error) throw toApiError(error, status)
  return data
}

export async function apartmentNormsCopy(
  fromId: number,
  toIds: number[],
  normTypes: NormType[],
  replace: boolean,
): Promise<unknown> {
  const { data, error, status } = await supabase.rpc('apartment_norms_copy', {
    p_from: fromId,
    p_to: toIds,
    p_norm_types: normTypes,
    p_replace: replace,
  })
  if (error) throw toApiError(error, status)
  return data
}

const PAGE = 1000

/** Number of own rules per apartment, for every apartment that has any. Read in pages: the table can be large. */
export async function fetchApartmentNormCounts(): Promise<Map<number, number>> {
  const rows: Array<{ apartment_id: number | null }> = []
  for (let from = 0; ; from += PAGE) {
    const { data, error, status } = await supabase
      .from('norm_rules')
      .select('apartment_id')
      .not('apartment_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw toApiError(error, status)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return countByApartment(rows)
}

export async function fetchApartmentNormCount(apartmentId: number): Promise<number> {
  const { count, error, status } = await supabase
    .from('norm_rules')
    .select('id', { head: true, count: 'exact' })
    .eq('apartment_id', apartmentId)
  if (error) throw toApiError(error, status)
  return count ?? 0
}

/** Copies the template of the apartment type into the apartment; items it already has are kept. Returns rows added. */
export async function makeApartmentNormsIndividual(apartmentId: number): Promise<number> {
  return readCount(await apartmentNormsMaterialize(apartmentId, ALL_NORM_TYPES), 'materialized')
}

/** Replaces the norms of the apartment with those of another apartment. Returns rows written. */
export async function replaceApartmentNormsFrom(sourceId: number, apartmentId: number): Promise<number> {
  return readCount(await apartmentNormsCopy(sourceId, [apartmentId], ALL_NORM_TYPES, true), 'upserted')
}

/** Deletes every own rule of the apartment, so the template of its type applies again. Returns rows deleted. */
export async function resetApartmentNormsToType(apartmentId: number): Promise<number> {
  return readCount(await apartmentNormsReset(apartmentId, ALL_NORM_TYPES), 'reset')
}
