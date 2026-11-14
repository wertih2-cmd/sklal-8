import { NavLink, useLocation } from 'react-router-dom'
import { House, BadgeCheck, Wrench, CalendarDays, Building2, QrCode, Users, UserCheck, ListChecks } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/modules/core/store'
import { formatBadge, type NavCounts } from '@/modules/admin/adminNavModel'
import { MANAGER_NAV_ITEMS, QR_APP_PATH, isManagerNavActive, type ManagerNavKey } from './managerNavModel'
import { useManagerLabels } from './useManagerLabels'

const ICONS: Record<ManagerNavKey, LucideIcon> = {
  home: House,
  cleanings: BadgeCheck,
  incidents: Wrench,
  chessboard: CalendarDays,
  attendance: UserCheck,
  tasks: ListChecks,
  apartments: Building2,
}

/** Desktop: a glass side panel with the profile, the sections, the link to the QR app and the switchers. */
export function ManagerSidebar({ counts }: { counts: NavCounts }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const profile = useAuth((s) => s.profile)
  const labels = useManagerLabels()

  return (
    <aside className="hidden lg:flex flex-col gap-4 glass rounded-[22px] sticky top-3 m-3 me-0 h-[calc(100vh-1.5rem)] overflow-y-auto p-4 no-print">
      <span className="px-1 text-lg font-semibold text-ink">{t.app.name}</span>

      {profile && (
        <div className="glass-inset rounded-2xl px-3 py-2.5 flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center flex-none">
            <Users className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate">{profile.full_name}</p>
            <p className="text-xs text-muted truncate">{profile.login}</p>
          </div>
        </div>
      )}

      <nav className="flex flex-col gap-0.5">
        {MANAGER_NAV_ITEMS.map((item) => {
          const active = isManagerNavActive(pathname, item)
          const Icon = ICONS[item.key]
          const badge = item.badge ? formatBadge(counts[item.badge]) : null
          return (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              className={`flex items-center gap-2.5 rounded-xl px-2.5 min-h-[40px] text-sm transition-colors ${
                active ? 'bg-accent-soft text-accent font-semibold' : 'text-muted hover:text-ink hover:bg-[var(--line)]'
              }`}
            >
              <Icon className="w-[18px] h-[18px] flex-none" strokeWidth={active ? 2.2 : 1.8} />
              <span className="truncate">{labels[item.key]}</span>
              {badge && (
                <span className="ms-auto min-w-[22px] h-[22px] px-1.5 rounded-full bg-warn text-xs font-semibold flex items-center justify-center">
                  {badge}
                </span>
              )}
            </NavLink>
          )
        })}
        <a
          href={QR_APP_PATH}
          className="flex items-center gap-2.5 rounded-xl px-2.5 min-h-[40px] text-sm text-muted hover:text-ink hover:bg-[var(--line)] transition-colors"
        >
          <QrCode className="w-[18px] h-[18px] flex-none" strokeWidth={1.8} />
          <span className="truncate">{t.nav.qr}</span>
        </a>
      </nav>

      <div className="mt-auto flex items-stretch gap-2">
        <ThemeToggle compact />
        <LangSwitcher compact />
      </div>
    </aside>
  )
}

/** Phone: a floating glass bar with the sections (seven: the labels are short, the full name is for the screen reader). */
export function ManagerBottomBar({ counts }: { counts: NavCounts }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const labels = useManagerLabels()
  // The full name of the section does not fit under an icon: the bar shows a short one, the screen reader the full one.
  const barLabel = (key: ManagerNavKey) => (key === 'cleanings' ? t.admin.nav.cleaningsShort : labels[key])

  return (
    <nav
      className="lg:hidden fixed inset-x-3 z-nav no-print"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="glass rounded-[22px] flex items-end justify-between px-1.5 py-1.5">
        {MANAGER_NAV_ITEMS.map((item) => {
          const active = isManagerNavActive(pathname, item)
          const Icon = ICONS[item.key]
          const badge = item.badge ? formatBadge(counts[item.badge]) : null
          return (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              aria-label={labels[item.key]}
              className="flex-1 min-w-0 min-h-[44px] flex flex-col items-center justify-center gap-0.5"
            >
              <span className="relative">
                <Icon className={`w-5 h-5 ${active ? 'text-accent' : 'text-muted'}`} strokeWidth={active ? 2.2 : 1.8} />
                {badge && (
                  <span className="absolute -top-2 -end-3 min-w-[18px] h-[18px] px-1 rounded-full bg-warn text-[11px] font-semibold leading-none flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </span>
              <span className={`max-w-full truncate text-[11px] ${active ? 'text-accent font-medium' : 'text-muted'}`}>{barLabel(item.key)}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
