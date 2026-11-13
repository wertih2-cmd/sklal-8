import { describe, it, expect } from 'vitest'
import { mainAppAccess } from './roleAccess'

describe('mainAppAccess', () => {
  it('lets the administrator into the admin panel', () => {
    expect(mainAppAccess('admin')).toBe('admin')
  })

  it('lets the supervisor into the supervisor interface only', () => {
    expect(mainAppAccess('supervisor')).toBe('supervisor')
  })

  it('keeps the manager out of the main app', () => {
    expect(mainAppAccess('manager')).toBe('none')
  })
})
