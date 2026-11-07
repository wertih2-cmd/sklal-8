import { describe, it, expect } from 'vitest'
import type { ItemUnit } from '@/lib/database.types'
import { buildUnitRows, filterUnitRows, statusCounts, matchesCodeOrLocation, EVENT_LABEL_KEYS } from './unitsView'

const unit = (id: string, item: number, code: string, status: ItemUnit['status'], loc: number, owner: number | null = null): ItemUnit => ({
  id, item_id: item, code, status, location_id: loc, owner_apartment_id: owner, unit_cost: null, created_at: '2026-01-01T00:00:00Z',
})

const units = [
  unit('a', 2, 'U-2-10', 'in_stock', 1),
  unit('b', 2, 'U-2-9', 'issued', 3),
  unit('c', 1, 'U-1-1', 'written_off', 2),
  unit('d', 9, 'U-9-1', 'lost', 99),
]
const rows = buildUnitRows(
  units,
  new Map([[1, 'Основной склад'], [2, 'Расход'], [3, 'ZZ/1']]),
  new Map([[1, 'Чайник'], [2, 'Фен']]),
)

describe('buildUnitRows', () => {
  it('keeps all rows and orders units of one item by natural code order', () => {
    expect(rows).toHaveLength(4)
    const fen = rows.filter((r) => r.name === 'Фен').map((r) => r.code)
    expect(fen).toEqual(['U-2-9', 'U-2-10'])
  })
  it('falls back to ids when names are unknown', () => {
    const d = rows.find((r) => r.id === 'd')
    expect(d?.name).toBe('#9')
    expect(d?.location).toBe('#99')
  })
})

describe('filterUnitRows / statusCounts', () => {
  const all = () => true
  it('filters by status', () => {
    expect(filterUnitRows(rows, 'all', all)).toHaveLength(4)
    expect(filterUnitRows(rows, 'issued', all).map((r) => r.id)).toEqual(['b'])
    expect(filterUnitRows(rows, 'lost', all).map((r) => r.id)).toEqual(['d'])
  })
  it('combines status with the predicate', () => {
    expect(filterUnitRows(rows, 'in_stock', (r) => r.code.endsWith('-10')).map((r) => r.id)).toEqual(['a'])
    expect(filterUnitRows(rows, 'issued', (r) => r.code.endsWith('-10'))).toEqual([])
  })
  it('counts statuses', () => {
    expect(statusCounts(rows)).toEqual({ all: 4, in_stock: 1, issued: 1, written_off: 1, lost: 1 })
    expect(statusCounts([])).toEqual({ all: 0, in_stock: 0, issued: 0, written_off: 0, lost: 0 })
  })
})

describe('matchesCodeOrLocation', () => {
  it('matches code or location case-insensitively and accepts empty query', () => {
    const r = rows.find((x) => x.id === 'b')!
    expect(matchesCodeOrLocation(r, '')).toBe(true)
    expect(matchesCodeOrLocation(r, 'u-2-9')).toBe(true)
    expect(matchesCodeOrLocation(r, 'zz/1')).toBe(true)
    expect(matchesCodeOrLocation(r, 'нет такого')).toBe(false)
  })
})

describe('EVENT_LABEL_KEYS', () => {
  it('covers the events written by the database', () => {
    for (const e of ['initial', 'receipt', 'issue_apartment', 'return_apartment', 'writeoff_apartment', 'writeoff_warehouse', 'issue_holder', 'return_holder', 'writeoff_holder', 'transfer', 'owner_transfer', 'void']) {
      expect(EVENT_LABEL_KEYS[e]).toBeTruthy()
    }
  })
})
