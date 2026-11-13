import { ru } from '@/i18n/ru'
import { en } from '@/i18n/en'
import { ar } from '@/i18n/ar'
import type { Dict } from '@/i18n/ru'
import type { Apartment, AptType, Category, Item, NormType } from '@/lib/database.types'
import { fetchApartmentsAdmin, fetchCategories, fetchItems } from '@/modules/admin/api'
import { downloadCsv } from '@/modules/admin/reportExport'
import type { CatalogRow, FileLabels, ImportContext } from '@/modules/admin/normImport'

/** Column headings and names of the file in the language of the interface. */
export function fileLabels(t: Dict): FileLabels {
  const a = t.admin.normImport
  return {
    type: a.fileType, apartment: a.fileApartment, normType: a.fileNormType, category: a.fileCategory,
    item: a.fileItem, qty: a.fileQty, unit: a.fileUnit, note: a.fileNote,
    normTypeNames: {
      asset_standing: t.apartments.normInventory,
      turnover_replenish: t.apartments.normTurnover,
      cleaning_consumption: t.apartments.normCleaning,
    },
    aptTypeNames: { studio: t.admin.normTemplates.studio, '1br': t.admin.normTemplates.br1, '2br': t.admin.normTemplates.br2 },
  }
}

/** Every spelling a file may use, in all three interface languages. */
export function acceptedNames(): Pick<ImportContext, 'normTypeNames' | 'aptTypeNames'> {
  const dicts = [ru, en, ar]
  const norm = (k: NormType) => dicts.map((d) => (k === 'asset_standing' ? d.apartments.normInventory : k === 'turnover_replenish' ? d.apartments.normTurnover : d.apartments.normCleaning))
  const apt = (k: AptType) => dicts.map((d) => (k === 'studio' ? d.admin.normTemplates.studio : k === '1br' ? d.admin.normTemplates.br1 : d.admin.normTemplates.br2))
  return {
    normTypeNames: { asset_standing: norm('asset_standing'), turnover_replenish: norm('turnover_replenish'), cleaning_consumption: norm('cleaning_consumption') },
    aptTypeNames: { studio: apt('studio'), '1br': apt('1br'), '2br': apt('2br') },
  }
}

export interface ImportCatalog { apartments: Apartment[]; items: Item[]; categories: Category[] }

export async function loadImportCatalog(): Promise<ImportCatalog> {
  const [apartments, items, categories] = await Promise.all([fetchApartmentsAdmin(), fetchItems(), fetchCategories()])
  return { apartments, items, categories }
}

export function importContext(cat: ImportCatalog): ImportContext {
  return {
    apartments: cat.apartments.map((a) => ({ id: a.id, code: a.code, number: a.number, type: a.type })),
    items: cat.items.map((i) => ({ id: i.id, name: i.name, name_en: i.name_en, name_ar: i.name_ar, category_id: i.category_id, active: i.active })),
    categories: cat.categories.map((c) => ({ id: c.id, name: c.name, name_en: c.name_en, name_ar: c.name_ar })),
    ...acceptedNames(),
  }
}

export function catalogRows(cat: ImportCatalog): Map<number, CatalogRow> {
  const cats = new Map(cat.categories.map((c) => [c.id, c.name]))
  return new Map(cat.items.map((i) => [i.id, { id: i.id, name: i.name, category: cats.get(i.category_id) ?? '', unit: i.base_unit }]))
}

export function saveTable(filename: string, table: string[][]): void {
  downloadCsv(filename, table[0] ?? [], table.slice(1))
}
