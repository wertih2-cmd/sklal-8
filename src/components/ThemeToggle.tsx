import { Moon, Sun } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useTheme } from '@/lib/theme'

/** Switches between the dark (default) and the light theme. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? t.common.themeToLight : t.common.themeToDark
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className={`glass flex items-center justify-center text-muted hover:text-ink shrink-0 ${
        compact ? 'w-8 self-stretch rounded-lg' : 'w-10 h-10 rounded-xl'
      }`}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
