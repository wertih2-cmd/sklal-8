export type Theme = 'dark' | 'light'

export const DEFAULT_THEME: Theme = 'dark'
export const THEME_COLOR: Record<Theme, string> = { dark: '#0c0e10', light: '#0e7c86' }

/** Anything that is not exactly "light" (a missing, stale or corrupt stored value) falls back to the default. */
export function parseTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : DEFAULT_THEME
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

/** The part of `document` that applyTheme touches (so it can be tested without a browser). */
export interface ThemeTarget {
  documentElement: { setAttribute(name: string, value: string): void }
  querySelector(selector: string): { setAttribute(name: string, value: string): void } | null
}

export function applyTheme(theme: Theme, target: ThemeTarget): void {
  target.documentElement.setAttribute('data-theme', theme)
  target.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}
