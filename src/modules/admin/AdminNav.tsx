import { NavLink, useLocation } from 'react-router-dom'
import { Plus, House, Package, Building2, Ellipsis, Wrench, BadgeCheck, ChartBar, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useI18n } from '@/i18n'
import { LangSwitcher } from '@/components/LangSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/modules/core/store'
import {
  MOBILE_NAV_ITEMS, sidebarItems, isNavActive, formatBadge, totalBadge,
  type NavItem, type NavKey, type NavCounts,
} from './adminNavModel'

const ICONS: Record<NavKey, LucideIcon> = {
  home: House,
  stock: Package,
  move: Plus,
  apartments: Building2,
  incidents: Wrench,
  cleanings: BadgeCheck,
  reports: ChartBar,
  more: Ellipsis,
}

function useNavLabels(): Record<NavKey, string> {
  const { t } = useI18n()
  const n = t.admin.nav
  return {
    home: n.home, stock: n.stock, move: n.move, apartments: n.apartments,
    incidents: n.incidents, cleanings: n.cleanings, reports: n.reports, more: n.more,
  }
}

function countFor(item: NavItem, counts: NavCounts): number | null {
  return item.badge ? counts[item.badge] : null
}

/** Desktop: a glass side panel with the profile, two groups, the main "new operation" button and the switchers. */
export function AdminSidebar({ counts }: { counts: NavCounts }) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const profile = useAuth((s) => s.profile)
  const labels = useNavLabels()
  const groups = [
    { title: t.admin.nav.groupWork, items: sidebarItems('work') },
    { title: t.admin.nav.groupControl, items: sidebarItems('control') },
  ]

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

      <NavLink
        to="/admin/move"
        className="flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
        style={{ boxShadow: '0 0 24px var(--glow-1)' }}
      >
        <Plus className="w-4 h-4" strokeWidth={2.4} />
        {t.admin.nav.newOperation}
      </NavLink>

      <nav className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g.title} className="flex flex-col gap-0.5">
            <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide uppercase text-glass-accent">{g.title}</p>
            {g.items.map((item) => {
              const active = isNavActive(pathname, item)
              const Icon = ICONS[item.key]
              const badge = formatBadge(countFor(item, counts))
              return (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.end}
                  className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
                    active ? 'bg-accent-soft text-accent font-semibold' : 'text-muted hover:text-ink hover:bg-[var(--line)]'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px] flex-none" strokeWidth={active ? 2.2 : 1.8} />
                  <span className="truncate">{labels[item.key]}</span>
                  {badge && (
                    <span className="ms-auto min-w-5 h-5 px-1.5 rounded-full bg-warn text-[11px] font-semibold flex items-center justify-center">
                      {badge}
                    </span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto flex items-stretch gap-2">
        <ThemeToggle compact />
        <LangSwitcher compact />
      </div>
    </aside>
  )
}

/** Phone: a floating glass bar. The middle button (new operation) is the big neon one. */
export function AdminBottomBar({ counts }: { counts: NavCounts }) {
  const { pathname } = useLocation()
  const labels = useNavLabels()
  const moreBadge = formatBadge(totalBadge(counts))

  return (
    <nav
      className="lg:hidden fixed inset-x-3 z-nav no-print"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="glass rounded-[22px] flex items-end justify-between px-1.5 py-1.5">
        {MOBILE_NAV_ITEMS.map((item) => {
          const active = isNavActive(pathname, item, MOBILE_NAV_ITEMS)
          const Icon = ICONS[item.key]
          if (item.key === 'move') {
            return (
              <NavLink key={item.key} to={item.to} end aria-label={labels.move} className="flex-1 flex flex-col items-center gap-0.5">
                <span
                  className="-mt-6 w-14 h-14 rounded-full bg-accent flex items-center justify-center"
                  style={{ boxShadow: '0 0 22px var(--glow-1)' }}
                >
                  <Icon className="w-7 h-7" strokeWidth={2.4} />
                </span>
                <span className={`text-[10px] ${active ? 'text-accent font-medium' : 'text-muted'}`}>{labels.move}</span>
              </NavLink>
            )
          }
          const badge = item.key === 'more' ? moreBadge : null
          return (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              aria-label={labels[item.key]}
              className="flex-1 min-h-[44px] flex flex-col items-center justify-center gap-0.5"
            >
              <span className="relative">
                <Icon className={`w-5 h-5 ${active ? 'text-accent' : 'text-muted'}`} strokeWidth={active ? 2.2 : 1.8} />
                {badge && (
                  <span className="absolute -top-2 -end-3 min-w-4 h-4 px-1 rounded-full bg-warn text-[10px] font-semibold leading-none flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </span>
              <span className={`text-[10px] ${active ? 'text-accent font-medium' : 'text-muted'}`}>{labels[item.key]}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
