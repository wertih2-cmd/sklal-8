import { describe, it, expect } from 'vitest'
import { MANAGER_NAV_ITEMS, isManagerNavActive, managerTitleKey } from './managerNavModel'

const activeKeys = (path: string) => MANAGER_NAV_ITEMS.filter((i) => isManagerNavActive(path, i)).map((i) => i.key)

describe('isManagerNavActive', () => {
  it('home is exact', () => {
    expect(activeKeys('/manager')).toEqual(['home'])
  })
  it('sections own their sub-pages', () => {
    expect(activeKeys('/manager/incidents')).toEqual(['incidents'])
    expect(activeKeys('/manager/cleaning-approvals')).toEqual(['cleanings'])
    expect(activeKeys('/manager/chessboard')).toEqual(['chessboard'])
    expect(activeKeys('/manager/attendance')).toEqual(['attendance'])
  })
  it('a path that only shares a prefix does not match', () => {
    expect(activeKeys('/manager/incidents-old')).toEqual([])
  })
})

describe('managerNavModel', () => {
  it('every item that stays in the manager area lives under /manager', () => {
    for (const i of MANAGER_NAV_ITEMS.filter((x) => x.key !== 'apartments')) {
      expect(i.to === '/manager' || i.to.startsWith('/manager/')).toBe(true)
    }
  })
  it('apartments open the supervisor screens', () => {
    expect(MANAGER_NAV_ITEMS.find((i) => i.key === 'apartments')?.to).toBe('/sv')
  })
  it('titleKey follows the section and is null for unknown paths', () => {
    expect(managerTitleKey('/manager')).toBe('home')
    expect(managerTitleKey('/manager/incidents')).toBe('incidents')
    expect(managerTitleKey('/manager/attendance')).toBe('attendance')
    expect(managerTitleKey('/manager/unknown')).toBeNull()
  })
})
