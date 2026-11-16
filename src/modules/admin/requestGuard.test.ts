import { describe, it, expect } from 'vitest'
import { createRequestGuard } from './requestGuard'

describe('createRequestGuard', () => {
  it('последний запрос актуален', () => {
    const g = createRequestGuard()
    const a = g.next()
    expect(g.isCurrent(a)).toBe(true)
  })

  it('новый запрос делает предыдущий устаревшим', () => {
    const g = createRequestGuard()
    const a = g.next()
    const b = g.next()
    expect(g.isCurrent(a)).toBe(false)
    expect(g.isCurrent(b)).toBe(true)
  })

  it('invalidate отменяет текущий запрос без нового', () => {
    const g = createRequestGuard()
    const a = g.next()
    g.invalidate()
    expect(g.isCurrent(a)).toBe(false)
  })

  it('после invalidate следующий запрос снова актуален', () => {
    const g = createRequestGuard()
    g.next()
    g.invalidate()
    const c = g.next()
    expect(g.isCurrent(c)).toBe(true)
  })

  it('номера разных охранников независимы', () => {
    const g1 = createRequestGuard()
    const g2 = createRequestGuard()
    const a = g1.next()
    g2.next(); g2.next()
    expect(g1.isCurrent(a)).toBe(true)
  })
})
