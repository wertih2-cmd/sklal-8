import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, THEME_COLOR, applyTheme, nextTheme, parseTheme, type ThemeTarget } from './themeCore'

function fakeTarget(withMeta: boolean) {
  const attrs: Record<string, string> = {}
  const metaAttrs: Record<string, string> = {}
  const target: ThemeTarget = {
    documentElement: { setAttribute: (name, value) => { attrs[name] = value } },
    querySelector: (selector) => (withMeta && selector === 'meta[name="theme-color"]'
      ? { setAttribute: (name, value) => { metaAttrs[name] = value } }
      : null),
  }
  return { target, attrs, metaAttrs }
}

describe('parseTheme', () => {
  it('dark is the default', () => {
    expect(DEFAULT_THEME).toBe('dark')
    expect(parseTheme(undefined)).toBe('dark')
    expect(parseTheme(null)).toBe('dark')
  })

  it('accepts light and dark', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
  })

  it('falls back to dark for any stale or corrupt value', () => {
    expect(parseTheme('auto')).toBe('dark')
    expect(parseTheme('LIGHT')).toBe('dark')
    expect(parseTheme(1)).toBe('dark')
    expect(parseTheme({})).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('flips between the two themes', () => {
    expect(nextTheme('dark')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('sets data-theme and the browser theme color', () => {
    const { target, attrs, metaAttrs } = fakeTarget(true)
    applyTheme('light', target)
    expect(attrs['data-theme']).toBe('light')
    expect(metaAttrs.content).toBe(THEME_COLOR.light)
    applyTheme('dark', target)
    expect(attrs['data-theme']).toBe('dark')
    expect(metaAttrs.content).toBe(THEME_COLOR.dark)
  })

  it('works when the page has no theme-color meta tag', () => {
    const { target, attrs, metaAttrs } = fakeTarget(false)
    applyTheme('dark', target)
    expect(attrs['data-theme']).toBe('dark')
    expect(metaAttrs.content).toBeUndefined()
  })
})
