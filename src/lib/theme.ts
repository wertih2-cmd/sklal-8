import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_THEME, applyTheme, nextTheme, parseTheme, type Theme } from '@/lib/themeCore'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => set({ theme: parseTheme(theme) }),
      toggleTheme: () => set({ theme: nextTheme(parseTheme(get().theme)) }),
    }),
    { name: 'theme' },
  ),
)

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useThemeStore((s) => s.theme)
  const toggle = useThemeStore((s) => s.toggleTheme)
  return { theme: parseTheme(theme), toggle }
}

// Apply the stored theme as soon as this module is imported, and follow every later change.
if (typeof document !== 'undefined') {
  applyTheme(parseTheme(useThemeStore.getState().theme), document)
  useThemeStore.subscribe((state) => applyTheme(parseTheme(state.theme), document))
}
