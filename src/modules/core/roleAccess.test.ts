import { describe, it, expect } from 'vitest'
import { mainAppAccess } from './roleAccess'

describe('mainAppAccess', () => {
  it('lets the administrator into the admin panel', () => {
    expect(mainAppAccess('admin')).toBe('admin')
  })

  it('lets the supervisor into the supervisor interface only', () => {
    expect(mainAppAccess('supervisor')).toBe('supervisor')
  })

  it('gives the manager the manager area', () => {
    expect(mainAppAccess('manager')).toBe('manager')
  })
})
