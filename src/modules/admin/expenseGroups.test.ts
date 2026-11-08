import { describe, it, expect } from 'vitest'
import { groupByApartment, groupByBuilding, groupTotals } from './expenseGroups'
import type { ExpenseRow } from './reportRules'

function row(partial: Partial<ExpenseRow>): ExpenseRow {
  return {
    apartment: 'B1/101', item: 'Towel', category: 'Linen', qtyPacks: 1, cost: 10,
    partial: false, isOwner: false, ownerCode: null, ...partial,
  }
}

const BUILDINGS: Record<string, string> = { 'B1/101': 'Building 1', 'B1/102': 'Building 1', 'B2/201': 'Building 2' }
const buildingOf = (code: string) => BUILDINGS[code]

describe('groupByApartment', () => {
  it('sums the cost per apartment and counts lines', () => {
    const groups = groupByApartment([
      row({ apartment: 'B1/101', cost: 10 }),
      row({ apartment: 'B1/101', item: 'Cup', cost: 5 }),
      row({ apartment: 'B1/102', cost: 30 }),
    ])
    expect(groups.map((g) => [g.label, g.cost, g.lines])).toEqual([['B1/102', 30, 1], ['B1/101', 15, 2]])
  })

  it('puts unpriced apartments last and flags them', () => {
    const groups = groupByApartment([
      row({ apartment: 'B1/101', cost: null, partial: true }),
      row({ apartment: 'B1/102', cost: 1 }),
    ])
    expect(groups.map((g) => g.label)).toEqual(['B1/102', 'B1/101'])
    expect(groups[1].priced).toBe(false)
    expect(groups[1].partial).toBe(true)
  })

  it('marks a group partial when some lines lack a price but others have one', () => {
    const [g] = groupByApartment([row({ cost: 10 }), row({ item: 'Cup', cost: 4, partial: true })])
    expect(g.cost).toBe(14)
    expect(g.priced).toBe(true)
    expect(g.partial).toBe(true)
  })

  it('collects moves without an apartment under an empty label', () => {
    const groups = groupByApartment([row({ apartment: '—', cost: 7 })])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('none')
    expect(groups[0].label).toBe('')
  })
})

describe('groupByBuilding', () => {
  const rows = [
    row({ apartment: 'B1/101', cost: 10 }),
    row({ apartment: 'B1/102', cost: 20 }),
    row({ apartment: 'B2/201', cost: 50 }),
    row({ apartment: 'X9/999', cost: 1 }),
    row({ apartment: '—', cost: 2 }),
  ]

  it('groups apartments under their building with the building total', () => {
    const groups = groupByBuilding(rows, buildingOf)
    const b1 = groups.find((g) => g.label === 'Building 1')
    expect(b1?.cost).toBe(30)
    expect(b1?.lines).toBe(2)
    expect(b1?.children.map((c) => [c.label, c.cost])).toEqual([['B1/102', 20], ['B1/101', 10]])
  })

  it('sorts buildings by cost, biggest first', () => {
    const groups = groupByBuilding(rows, buildingOf)
    expect(groups.map((g) => g.label)).toEqual(['Building 2', 'Building 1', ''])
  })

  it('sends unknown apartments and apartment-less moves to one building-less group', () => {
    const groups = groupByBuilding(rows, buildingOf)
    const none = groups.find((g) => g.label === '')
    expect(none?.cost).toBe(3)
    expect(none?.lines).toBe(2)
  })

  it('building totals add up to the grand total', () => {
    const total = groupTotals(groupByBuilding(rows, buildingOf))
    expect(total.cost).toBe(83)
    expect(total.lines).toBe(5)
  })
})

describe('groupTotals', () => {
  it('returns zeros for an empty list', () => {
    expect(groupTotals([])).toEqual({ cost: 0, priced: false, partial: false, lines: 0 })
  })
})
