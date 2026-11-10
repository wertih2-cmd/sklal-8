import { describe, it, expect } from 'vitest'
import { NAV_ITEMS, MOBILE_NAV_ITEMS, sidebarItems, isNavActive, formatBadge, totalBadge, type NavKey } from './adminNavModel'

const item = (key: NavKey) => NAV_ITEMS.find((i) => i.key === key)!
const activeKeys = (path: string, visible = NAV_ITEMS) => visible.filter((i) => isNavActive(path, i, visible)).map((i) => i.key)

describe('isNavActive (sidebar: all items visible)', () => {
  it('home is exact', () => {
    expect(activeKeys('/admin')).toEqual(['home'])
    expect(activeKeys('/admin/stock')).toEqual(['stock'])
  })
  it('nested pages belong to their section', () => {
    expect(activeKeys('/admin/apartments/12')).toEqual(['apartments'])
    expect(activeKeys('/admin/more/documents/7')).toEqual(['more'])
  })
  it('the more specific item wins over More', () => {
    expect(activeKeys('/admin/more/incidents')).toEqual(['incidents'])
    expect(activeKeys('/admin/more/cleaning-approvals')).toEqual(['cleanings'])
    expect(activeKeys('/admin/more/reports')).toEqual(['reports'])
    expect(activeKeys('/admin/more')).toEqual(['more'])
  })
  it('a path that only shares a prefix does not match', () => {
    expect(isNavActive('/admin/stockroom', item('stock'))).toBe(false)
    expect(isNavActive('/admin/more-things', item('more'))).toBe(false)
  })
})

describe('isNavActive (phone: only the five tabs)', () => {
  it('More is lit for every /admin/more page', () => {
    expect(activeKeys('/admin/more/incidents', MOBILE_NAV_ITEMS)).toEqual(['more'])
    expect(activeKeys('/admin/more/reports', MOBILE_NAV_ITEMS)).toEqual(['more'])
  })
  it('has the five tabs with move in the middle', () => {
    expect(MOBILE_NAV_ITEMS.map((i) => i.key)).toEqual(['home', 'stock', 'move', 'apartments', 'more'])
  })
})

describe('sidebarItems', () => {
  it('work group has no duplicate of the move button', () => {
    expect(sidebarItems('work').map((i) => i.key)).toEqual(['home', 'apartments', 'stock'])
  })
  it('control group order', () => {
    expect(sidebarItems('control').map((i) => i.key)).toEqual(['incidents', 'cleanings', 'reports', 'more'])
  })
  it('only incidents and cleanings carry a counter', () => {
    expect(NAV_ITEMS.filter((i) => i.badge).map((i) => i.key)).toEqual(['incidents', 'cleanings'])
  })
})

describe('formatBadge / totalBadge', () => {
  it('hides zero, unknown and nonsense', () => {
    expect(formatBadge(0)).toBeNull()
    expect(formatBadge(null)).toBeNull()
    expect(formatBadge(undefined)).toBeNull()
    expect(formatBadge(-3)).toBeNull()
    expect(formatBadge(Number.NaN)).toBeNull()
  })
  it('shows numbers and caps at 99+', () => {
    expect(formatBadge(1)).toBe('1')
    expect(formatBadge(99)).toBe('99')
    expect(formatBadge(100)).toBe('99+')
  })
  it('sums known counts, unknown is 0', () => {
    expect(totalBadge({ incidents: 2, cleanings: 3 })).toBe(5)
    expect(totalBadge({ incidents: null, cleanings: 3 })).toBe(3)
    expect(totalBadge({ incidents: null, cleanings: null })).toBe(0)
  })
})
