import { useLocation } from 'react-router-dom'
import { QrCode } from 'lucide-react'
import { useI18n, useDocumentDir } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAdminBadges } from '@/modules/admin/useAdminBadges'
import { ManagerSidebar, ManagerBottomBar } from './ManagerNav'
import { QR_APP_PATH, managerTitleKey } from './managerNavModel'
import { useManagerLabels } from './useManagerLabels'

/** Frame of the manager area: a side panel on a desktop, a floating bottom bar and a top bar on a phone. */
export function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  useDocumentDir()
  const { pathname } = useLocation()
  const counts = useAdminBadges()
  const labels = useManagerLabels()
  const key = managerTitleKey(pathname)
  const title = key ? labels[key] : t.app.name

  return (
    <div className="min-h-screen bg-app app-glow flex flex-col lg:grid lg:grid-cols-[248px_1fr]">
      <ManagerSidebar counts={counts} />

      <main className="flex-1 lg:px-7 lg:py-6 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] lg:pb-8 max-w-[1180px] w-full">
        <div
          className="lg:hidden sticky z-30 mx-3 mt-2 mb-1 h-12 glass rounded-2xl ps-4 pe-1.5 flex items-center gap-1.5 no-print"
          style={{ top: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
        >
          <span className="flex-1 min-w-0 truncate font-semibold text-ink text-[15px]">{title}</span>
          <a
            href={QR_APP_PATH}
            aria-label={t.nav.qr}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-muted hover:text-ink flex-none"
          >
            <QrCode className="w-5 h-5" />
          </a>
          <ThemeToggle />
          <LangSwitcher compact />
        </div>
        {children}
      </main>

      <ManagerBottomBar counts={counts} />
    </div>
  )
}
