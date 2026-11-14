import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { Users, Wrench, Phone, ExternalLink, CircleUser as UserCircle, ChevronRight, ClipboardList, FolderTree, FileText, ShoppingCart, ClipboardCheck, QrCode, ChartBar as BarChart3, History, BadgeCheck, CalendarDays } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/modules/core/store'
import { MORE_SECTIONS, formatBadge, type MoreKey, type MoreSectionKey } from './adminNavModel'
import { useAdminBadges } from './useAdminBadges'

const ICONS: Record<MoreKey, LucideIcon> = {
  orders: ShoppingCart,
  inventory: ClipboardCheck,
  documents: FileText,
  catalog: FolderTree,
  incidents: Wrench,
  cleaningApprovals: BadgeCheck,
  chessboard: CalendarDays,
  reports: BarChart3,
  history: History,
  normTemplates: ClipboardList,
  qr: QrCode,
  contacts: Phone,
  staff: UserCircle,
  users: Users,
}

export function AdminMore() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const signOut = useAuth((s) => s.signOut)
  const profile = useAuth((s) => s.profile)
  const counts = useAdminBadges()

  const sectionTitles: Record<MoreSectionKey, string> = {
    warehouse: t.admin.more.sectionWarehouse,
    control: t.admin.more.sectionControl,
    directories: t.admin.more.sectionDirectories,
    admin: t.admin.more.sectionAdmin,
  }

  return (
    <div className="px-4 pt-6 pb-28">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.more.title}</h1>

      {MORE_SECTIONS.map((section) => (
        <section key={section.key} className="mb-4">
          <h2 className="px-2 pb-1.5 text-xs font-medium tracking-wide uppercase text-glass-accent">{sectionTitles[section.key]}</h2>
          <div className="panel rounded-[20px] p-2 flex flex-col gap-1.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.key]
              const badge = item.badge ? formatBadge(counts[item.badge]) : null
              return (
                <button
                  key={item.to}
                  onClick={() => navigate(item.to)}
                  className="well w-full min-h-[52px] rounded-xl px-4 py-3 flex items-center gap-3 text-start transition-colors hover:border-accent"
                >
                  <Icon className="w-5 h-5 text-muted flex-none" />
                  <span className="flex-1 text-[15px] text-ink">{t.admin.more[item.key]}</span>
                  {badge && (
                    <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-warn text-xs font-semibold flex items-center justify-center">
                      {badge}
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted rtl:rotate-180 flex-none" />
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <button
        onClick={() => navigate('/sv')}
        className="tile w-full min-h-[48px] rounded-[20px] px-4 py-3.5 flex items-center gap-3 text-start transition-colors hover:border-accent"
      >
        <ExternalLink className="w-5 h-5 text-accent" />
        <span className="flex-1 text-sm text-accent font-medium">{t.admin.more.openAsSv}</span>
      </button>

      {profile && (
        <div className="mt-6">
          <div className="tile rounded-[20px] px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-on-accent" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-ink">{profile.full_name}</p>
              <p className="text-xs text-muted">{profile.login}</p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="tile w-full mt-3 min-h-[48px] text-bad rounded-[20px] py-3 font-medium transition-colors hover:border-bad"
          >
            {t.profile.logout}
          </button>
        </div>
      )}
    </div>
  )
}
