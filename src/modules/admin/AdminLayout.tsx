import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ArrowLeft, Search } from 'lucide-react'
import { AdminSidebar, AdminBottomBar } from './AdminNav'
import { usePageTitle } from './useNavLabels'
import { AptSearch } from './AptSearch'
import { useAdminBadges } from './useAdminBadges'

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  useDocumentDir()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const counts = useAdminBadges()
  const title = usePageTitle()
  const [searchOpen, setSearchOpen] = useState(false)

  // Ctrl/Cmd+K from anywhere in the admin area. The physical key is checked, so it works in the Russian layout too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  // Sub-pages of "More" (one level below it) get a common back link; two pages already have their own header with one.
  const showBack = /^\/admin\/more\/[^/]+$/.test(pathname) && pathname !== '/admin/more/norm-templates'

  return (
    <div className="min-h-screen bg-app app-glow flex flex-col lg:grid lg:grid-cols-[248px_1fr]">
      <AdminSidebar counts={counts} onSearch={() => setSearchOpen(true)} />

      {/* Main content: the bottom padding keeps the floating bar from covering the last block on a phone */}
      <main className="flex-1 lg:px-7 lg:py-6 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] lg:pb-8 max-w-[1180px] w-full">
        {/* Mobile top bar: floating glass like the bottom bar, with the title of the current section */}
        <div
          className="lg:hidden sticky z-30 mx-3 mt-2 mb-1 h-12 glass rounded-2xl ps-4 pe-1.5 flex items-center gap-1.5 no-print"
          style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
        >
          <span className="flex-1 min-w-0 truncate font-semibold text-ink text-[15px]">{title}</span>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={t.admin.nav.search}
            data-testid="apt-search-open-mobile"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-ink flex-none"
          >
            <Search className="w-5 h-5" />
          </button>
          <ThemeToggle />
          <LangSwitcher compact />
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
      <AptSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
