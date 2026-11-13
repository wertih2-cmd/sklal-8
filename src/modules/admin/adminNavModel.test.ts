import { describe, it, expect } from 'vitest'
import {
  NAV_ITEMS, MOBILE_NAV_ITEMS, MORE_SECTIONS, sidebarItems, isNavActive, formatBadge, totalBadge, titleKeyFor, type NavKey,
} from './adminNavModel'

const item = (key: NavKey) => NAV_ITEMS.find((i) => i.key === key)!
const activeKeys = (path: string, visible = NAV_ITEMS) => visible.filter((i) => isNavActive(path, i, visible)).map((i) => i.key)

describe('isNavActive (sidebar: all items visible)', () => {
  it('home is exact', () => {
    expect(activeKeys('/admin')).toEqual(['home'])
    expect(activeKeys('/admin/stock')).toEqual(['stock'])
  })
  it('nested pages belong to their section', () => {
    expect(activeKeys('/admin/apartments/12')).toEqual(['apartments'])
    expect(activeKeys('/admin/more/documents/7')).toEqual(['documents'])
    expect(activeKeys('/admin/more/staff')).toEqual(['more'])
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
  it('warehouse group order', () => {
    expect(sidebarItems('warehouse').map((i) => i.key)).toEqual(['orders', 'inventory', 'documents', 'catalog'])
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

describe('MORE_SECTIONS', () => {
  const all = MORE_SECTIONS.flatMap((s) => s.items)
  it('lists every sub-page once', () => {
    expect(all).toHaveLength(13)
    expect(new Set(all.map((i) => i.key)).size).toBe(all.length)
    expect(new Set(all.map((i) => i.to)).size).toBe(all.length)
    expect(all.every((i) => i.to.startsWith('/admin/more/'))).toBe(true)
  })
  it('no section is empty', () => {
    expect(MORE_SECTIONS.every((s) => s.items.length > 0)).toBe(true)
  })
  it('every sidebar page under /admin/more is also in the list', () => {
    const paths = new Set(all.map((i) => i.to))
    for (const i of NAV_ITEMS.filter((n) => n.to.startsWith('/admin/more/'))) expect(paths.has(i.to)).toBe(true)
  })
  it('counters sit on the same pages as in the sidebar', () => {
    expect(all.filter((i) => i.badge).map((i) => i.badge)).toEqual(['incidents', 'cleanings'])
  })
})

describe('titleKeyFor', () => {
  it('main sections', () => {
    expect(titleKeyFor('/admin')).toBe('home')
    expect(titleKeyFor('/admin/move')).toBe('move')
    expect(titleKeyFor('/admin/apartments/12')).toBe('apartments')
    expect(titleKeyFor('/admin/stock')).toBe('stock')
  })
  it('a sidebar page wins over the More hub', () => {
    expect(titleKeyFor('/admin/more/incidents')).toBe('incidents')
    expect(titleKeyFor('/admin/more/documents/7')).toBe('documents')
  })
  it('pages that only live under More', () => {
    expect(titleKeyFor('/admin/more/staff')).toBe('staff')
    expect(titleKeyFor('/admin/more/norm-templates')).toBe('normTemplates')
    expect(titleKeyFor('/admin/more/history')).toBe('history')
  })
  it('the hub itself and unknown paths', () => {
    expect(titleKeyFor('/admin/more')).toBe('more')
    expect(titleKeyFor('/nowhere')).toBeNull()
  })
})
