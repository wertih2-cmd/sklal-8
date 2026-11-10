import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ArrowLeft } from 'lucide-react'
import { AdminSidebar, AdminBottomBar } from './AdminNav'
import { useAdminBadges } from './useAdminBadges'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  useDocumentDir()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const counts = useAdminBadges()
  // Sub-pages of "More" (one level below it) get a common back link; two pages already have their own header with one.
  const showBack = /^\/admin\/more\/[^/]+$/.test(pathname) && pathname !== '/admin/more/norm-templates'

  return (
    <div className="min-h-screen bg-app app-glow flex flex-col lg:grid lg:grid-cols-[248px_1fr]">
      <AdminSidebar counts={counts} />

      {/* Main content: the bottom padding keeps the floating bar from covering the last block on a phone */}
      <main className="flex-1 lg:px-7 lg:py-6 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] lg:pb-8 max-w-[1180px] w-full">
        {/* Mobile top bar with language switcher */}
        <div className="lg:hidden flex items-center justify-between px-4 h-11 bg-surface border-b border-line sticky top-0 z-30 no-print">
          <span className="font-semibold text-ink text-sm">{t.app.name}</span>
          <div className="flex items-center gap-2"><ThemeToggle /><LangSwitcher compact /></div>
        </div>
        {showBack && (
          <button
            onClick={() => navigate('/admin/more')}
            aria-label={t.common.back}
            className="flex items-center gap-1.5 px-4 pt-4 -mb-2 text-sm text-muted hover:text-accent lg:px-0 lg:pt-0 lg:mb-2 no-print"
          >
            <ArrowLeft className="w-4 h-4" />
            {t.common.back}
          </button>
        )}
        {children}
      </main>

      <AdminBottomBar counts={counts} />
    </div>
  )
}
