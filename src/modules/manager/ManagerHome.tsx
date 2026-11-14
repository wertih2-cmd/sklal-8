import { NavLink } from 'react-router-dom'
import { BadgeCheck, Wrench, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useAdminBadges } from '@/modules/admin/useAdminBadges'

/** Start page of the manager: what waits for a decision. No warehouse data: the manager has no access to it. */
export function ManagerHome() {
  const { t, n } = useI18n()
  const m = t.admin.manager
  const counts = useAdminBadges()
  const tiles = [
    { to: '/manager/cleaning-approvals', icon: BadgeCheck, label: m.pendingCleanings, count: counts.cleanings },
    { to: '/manager/incidents', icon: Wrench, label: m.newIncidents, count: counts.incidents },
  ]

  return (
    <div className="px-4 pt-6 pb-28 lg:px-0 lg:pt-0">
      <h1 className="text-xl font-semibold text-ink mb-4">{m.title}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <NavLink key={tile.to} to={tile.to} className="tile rounded-[20px] p-4 flex items-center gap-3 min-h-[72px]">
              <div className="w-10 h-10 well rounded-xl flex items-center justify-center flex-none">
                <Icon className="w-5 h-5 text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-semibold text-ink leading-none">{tile.count == null ? '—' : n(String(tile.count))}</p>
                <p className="text-sm text-muted mt-1 truncate">{tile.label}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted flex-none rtl:rotate-180" />
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}
