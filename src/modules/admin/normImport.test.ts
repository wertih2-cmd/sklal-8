import { describe, it, expect } from 'vitest'
import {
  decodeCsvBytes, parseCsv, mapHeader, parseQty, parseNormRows, planImport, planClearApartment, effectiveRules,
  buildNormsTable, buildTemplateTable, type ImportContext, type ExistingRule, type FileLabels,
} from './normImport'

const ctx: ImportContext = {
  apartments: [
    { id: 1, code: 'Tower A/12', number: '12', type: '1br' },
    { id: 2, code: 'Tower A/7', number: '7', type: 'studio' },
    { id: 3, code: 'Villa/7', number: '7', type: '2br' },
  ],
  items: [
    { id: 10, name: 'Полотенце', name_en: 'Towel', name_ar: null, category_id: 1, active: true },
    { id: 11, name: 'Шампунь', name_en: 'Shampoo', name_ar: null, category_id: 2, active: true },
    { id: 12, name: 'Подушка', name_en: null, name_ar: null, category_id: 1, active: true },
    { id: 13, name: 'Подушка', name_en: null, name_ar: null, category_id: 3, active: true },
    { id: 14, name: 'Старое', name_en: null, name_ar: null, category_id: 1, active: false },
  ],
  categories: [
    { id: 1, name: 'Текстиль', name_en: 'Textile', name_ar: null },
    { id: 2, name: 'Химия', name_en: 'Chemicals', name_ar: null },
    { id: 3, name: 'Мебель', name_en: null, name_ar: null },
  ],
  normTypeNames: { asset_standing: ['Инвентарь', 'Inventory'], turnover_replenish: ['Комплект для жильцов'], cleaning_consumption: ['Расход на уборку', 'Cleaning supplies'] },
  aptTypeNames: { studio: ['Студия', 'Studio'], '1br': ['1 спальня'], '2br': ['2 спальни'] },
}
const HEAD = 'Тип квартиры;Квартира;Вид нормы;Категория;Предмет;Количество;Примечание'
const parse = (...lines: string[]) => parseNormRows(parseCsv([HEAD, ...lines].join('\n')), ctx)

describe('CSV', () => {
  it('detects ; , and tab and reads quotes', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x,y', 'he said "hi"']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a;b\n"line1\nline2";2')).toEqual([['a', 'b'], ['line1\nline2', '2']])
  })

  it('drops empty lines and handles a missing final newline', () => {
    expect(parseCsv('a;b\n\n;\n1;2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('')).toEqual([])
  })

  it('reads UTF-8 with a BOM and Windows-1251', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Склад')])
    expect(decodeCsvBytes(utf8)).toBe('Склад')
    // "Склад" in cp1251: С=D1 к=EA л=EB а=E0 д=E4
    expect(decodeCsvBytes(new Uint8Array([0xd1, 0xea, 0xeb, 0xe0, 0xe4]))).toBe('Склад')
  })
})

describe('headers and quantities', () => {
  it('maps headers in Russian, English and in any case or punctuation', () => {
    expect(mapHeader(['Тип квартиры', 'Квартира', 'Вид нормы', 'Категория', 'Предмет', 'Кол-во', 'Ед.', 'Примечание']))
      .toEqual({ type: 0, apartment: 1, normType: 2, category: 3, item: 4, qty: 5, unit: 6, note: 7 })
    expect(mapHeader(['APT TYPE', 'Apartment', 'norm_type', 'Item', 'Qty']))
      .toEqual({ type: 0, apartment: 1, normType: 2, item: 3, qty: 4 })
  })

  it('parses quantities with a decimal comma, spaces and rounds to 3 places', () => {
    expect(parseQty('2')).toBe(2)
    expect(parseQty(' 1,5 ')).toBe(1.5)
    expect(parseQty('1 000')).toBe(1000)
    expect(parseQty('0')).toBe(0)
    expect(parseQty('0.12345')).toBe(0.123)
    expect(['', 'abc', '-1', '1e3', '1.2.3'].map(parseQty)).toEqual([null, null, null, null, null])
  })
})

describe('parseNormRows', () => {
  it('reads rows by type and by apartment, in any language of the names', () => {
    const p = parse('Студия;;Инвентарь;Текстиль;Полотенце;2;', ';Tower A/12;Cleaning supplies;Chemicals;Shampoo;30,5;по запросу')
    expect(p.issues).toEqual([])
    expect(p.rows).toEqual([
      { line: 2, scope: { kind: 'type', aptType: 'studio' }, normType: 'asset_standing', itemId: 10, qty: 2, note: null },
      { line: 3, scope: { kind: 'apartment', apartmentId: 1 }, normType: 'cleaning_consumption', itemId: 11, qty: 30.5, note: 'по запросу' },
    ])
  })

  it('finds an apartment by code, or by number when the number is unique', () => {
    expect(parse(';Tower A/12;Инвентарь;;Полотенце;1;').rows[0].scope).toEqual({ kind: 'apartment', apartmentId: 1 })
    expect(parse(';12;Инвентарь;;Полотенце;1;').rows[0].scope).toEqual({ kind: 'apartment', apartmentId: 1 })
    expect(parse(';7;Инвентарь;;Полотенце;1;').issues).toEqual([{ line: 2, code: 'ambiguous_apartment', value: '7' }])
    expect(parse(';99;Инвентарь;;Полотенце;1;').issues).toEqual([{ line: 2, code: 'unknown_apartment', value: '99' }])
  })

  it('uses the category to tell items with the same name apart', () => {
    expect(parse('Студия;;Инвентарь;;Подушка;1;').issues[0].code).toBe('ambiguous_item')
    expect(parse('Студия;;Инвентарь;Мебель;Подушка;1;').rows[0].itemId).toBe(13)
    expect(parse('Студия;;Инвентарь;Химия;Подушка;1;').issues[0].code).toBe('item_category_mismatch')
    expect(parse('Студия;;Инвентарь;Нет такой;Подушка;1;').issues[0].code).toBe('unknown_category')
  })

  it('reports every problem with its line and the offending value', () => {
    const p = parse(
      ';;Инвентарь;;Полотенце;1;', 'Студия;Tower A/12;Инвентарь;;Полотенце;1;', 'Дворец;;Инвентарь;;Полотенце;1;',
      'Студия;;Хлам;;Полотенце;1;', 'Студия;;Инвентарь;;Гвоздь;1;', 'Студия;;Инвентарь;;Старое;1;',
      'Студия;;Инвентарь;;Полотенце;много;', 'Студия;;Инвентарь;;Полотенце;1;', 'Студия;;Инвентарь;;Полотенце;3;',
    )
    expect(p.issues.map((i) => [i.line, i.code, i.value])).toEqual([
      [2, 'no_scope', ''], [3, 'both_scopes', ''], [4, 'unknown_type', 'Дворец'], [5, 'unknown_norm_type', 'Хлам'],
      [6, 'unknown_item', 'Гвоздь'], [7, 'item_inactive', 'Старое'], [8, 'bad_qty', 'много'], [10, 'duplicate', 'Полотенце'],
    ])
    expect(p.rows.map((r) => r.line)).toEqual([9])
    expect(p.lines).toBe(9)
  })

  it('names the missing columns', () => {
    expect(parseNormRows(parseCsv('Предмет;Количество\nПолотенце;1'), ctx).missing).toEqual(['normType', 'scope'])
    expect(parseNormRows([], ctx).missing).toHaveLength(4)
  })
})

describe('planImport', () => {
  const rule = (over: Partial<ExistingRule>): ExistingRule => ({ id: 1, norm_type: 'asset_standing', apt_type: null, apartment_id: 1, item_id: 10, qty: 4, note: null, ...over })
  const rows = parse(';Tower A/12;Инвентарь;;Полотенце;6;', ';Tower A/12;Инвентарь;;Шампунь;1;', 'Студия;;Инвентарь;;Полотенце;2;').rows

  it('inserts new rules, updates changed ones, leaves equal ones alone', () => {
    const existing = [rule({ id: 5, item_id: 10, qty: 4 }), rule({ id: 6, item_id: 11, qty: 1 })]
    const plan = planImport(rows, existing, 'merge')
    expect(plan.inserts).toEqual([{ norm_type: 'asset_standing', apt_type: 'studio', apartment_id: null, item_id: 10, qty: 2, note: null }])
    expect(plan.updates.map((u) => [u.id, u.qty])).toEqual([[5, 6]])
    expect([plan.unchanged, plan.deletes]).toEqual([1, []])
    expect([plan.types, plan.apartments]).toEqual([['studio'], [1]])
  })

  it('keeps an existing note in merge when the file has none, and drops it in replace', () => {
    const existing = [rule({ id: 5, item_id: 10, qty: 4, note: 'keep me' })]
    expect(planImport(rows, existing, 'merge').updates[0].note).toBe('keep me')
    expect(planImport(rows, existing, 'replace').updates[0].note).toBeNull()
  })

  it('replace deletes unlisted rules only in scopes the file mentions', () => {
    const existing = [
      rule({ id: 5, item_id: 10 }), rule({ id: 7, item_id: 12 }), // apartment 1: item 12 is not in the file
      rule({ id: 8, apartment_id: 2, item_id: 10 }), // apartment 2 is not in the file
      rule({ id: 9, apartment_id: null, apt_type: '2br', item_id: 10 }), // 2br is not in the file
    ]
    expect(planImport(rows, existing, 'replace').deletes).toEqual([7])
    expect(planImport(rows, existing, 'merge').deletes).toEqual([])
  })

  it('treats the same item in another kind of norm as another rule', () => {
    const existing = [rule({ id: 5, norm_type: 'cleaning_consumption', item_id: 10, qty: 6 })]
    const plan = planImport(rows.slice(0, 1), existing, 'merge')
    expect([plan.inserts.length, plan.updates.length, plan.unchanged]).toEqual([1, 0, 0])
  })
})

describe('planClearApartment and effectiveRules', () => {
  const r = (over: Partial<ExistingRule>): ExistingRule => ({ id: 1, norm_type: 'asset_standing', apt_type: null, apartment_id: 1, item_id: 10, qty: 4, note: null, ...over })
  const own = [r({ id: 1, item_id: 10, qty: 6 }), r({ id: 2, item_id: 11, qty: 0 })]
  const template = [
    r({ id: 20, apartment_id: null, apt_type: '1br', item_id: 10, qty: 4 }),
    r({ id: 21, apartment_id: null, apt_type: '1br', item_id: 12, qty: 2, note: 'x' }),
    r({ id: 22, apartment_id: null, apt_type: '1br', item_id: 12, norm_type: 'cleaning_consumption', qty: 1 }),
  ]

  it('zeroes own rules and adds a zero for each template item the apartment does not override', () => {
    const plan = planClearApartment(1, own, template)
    expect(plan.updates.map((u) => [u.id, u.qty])).toEqual([[1, 0]])
    expect(plan.inserts).toEqual([
      { norm_type: 'asset_standing', apt_type: null, apartment_id: 1, item_id: 12, qty: 0, note: 'x' },
      { norm_type: 'cleaning_consumption', apt_type: null, apartment_id: 1, item_id: 12, qty: 0, note: null },
    ])
  })

  it('does nothing for an apartment that has no norms at all', () => {
    expect(planClearApartment(1, [], [])).toEqual({ inserts: [], updates: [] })
  })

  it('lists the effective norms: own over template', () => {
    expect(effectiveRules(own, template).map((x) => [x.item_id, x.qty, x.norm_type])).toEqual([
      [10, 6, 'asset_standing'], [11, 0, 'asset_standing'], [12, 2, 'asset_standing'], [12, 1, 'cleaning_consumption'],
    ])
  })
})

describe('the file written and read back', () => {
  const labels: FileLabels = {
    type: 'Тип квартиры', apartment: 'Квартира', normType: 'Вид нормы', category: 'Категория', item: 'Предмет', qty: 'Количество', unit: 'Ед.', note: 'Примечание',
    normTypeNames: { asset_standing: 'Инвентарь', turnover_replenish: 'Комплект для жильцов', cleaning_consumption: 'Расход на уборку' },
    aptTypeNames: { studio: 'Студия', '1br': '1 спальня', '2br': '2 спальни' },
  }
  const catalog = new Map([[10, { id: 10, name: 'Полотенце', category: 'Текстиль', unit: 'шт' }], [11, { id: 11, name: 'Шампунь', category: 'Химия', unit: 'мл' }]])
  const apartments = new Map([[1, 'Tower A/12']])

  it('round-trips through the importer to the same rules', () => {
    const rules = [
      { norm_type: 'asset_standing' as const, apt_type: 'studio' as const, apartment_id: null, item_id: 10, qty: 2, note: null },
      { norm_type: 'cleaning_consumption' as const, apt_type: null, apartment_id: 1, item_id: 11, qty: 30.5, note: 'по "запросу"; срочно' },
    ]
    const table = buildNormsTable(rules, catalog, apartments, labels)
    const csv = table.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const p = parseNormRows(parseCsv(csv), ctx)
    expect(p.issues).toEqual([])
    expect(planImport(p.rows, [], 'merge').inserts).toEqual(rules)
  })

  it('builds a template with a header and two example rows', () => {
    const t = buildTemplateTable(labels, { apartment: 'Tower A/12', item: 'Полотенце', category: 'Текстиль', unit: 'шт' })
    expect(t).toHaveLength(3)
    expect(parseNormRows(t, ctx).issues).toEqual([])
  })
})
