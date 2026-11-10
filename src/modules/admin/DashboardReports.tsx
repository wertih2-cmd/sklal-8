import { useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ClipboardList, CreditCard, History, Package, Receipt, RefreshCw, ShoppingCart } from 'lucide-react'
import { useI18n } from '@/i18n'
import {
  PERIOD_TABS, PRESET_PERIODS, reportLink, type PresetPeriod, type ReportTab,
} from '@/modules/admin/reportLinks'

const TILE_ICON: Record<ReportTab, ComponentType<{ className?: string }>> = {
  expense: Receipt,
  stock: Boxes,
  moves: History,
  charges: CreditCard,
  valuation: ClipboardList,
  turnover: RefreshCw,
  units: Package,
  purchases: ShoppingCart,
}

const TILE_ORDER: ReportTab[] = ['expense', 'purchases', 'stock', 'moves', 'charges', 'valuation', 'turnover', 'units']

export function DashboardReports() {
  const { t } = useI18n()
  const r = t.admin.reports
  const b = t.admin.dashboard.reportsBlock
  const navigate = useNavigate()
  const [period, setPeriod] = useState<PresetPeriod>('7')

  const tabLabel: Record<ReportTab, string> = {
    expense: r.expense,
    stock: r.currentStock,
    moves: r.moves,
    charges: r.charges,
    valuation: r.valuationTab,
    turnover: r.turnoverTab,
    units: r.unitsTab,
    purchases: r.purchasesTab,
  }
  const periodLabel: Record<PresetPeriod, string> = { today: r.today, '7': r.days7, '30': r.days30 }

  return (
    <section className="panel rounded-[20px] p-4 mb-5" data-testid="dash-reports">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-ink">{b.title}</h2>
        <div role="group" aria-label={b.periodLabel} className="ms-auto flex rounded-lg border border-line overflow-hidden">
          {PRESET_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              data-testid={`dash-reports-period-${p}`}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs ${period === p ? 'bg-accent text-on-accent font-medium' : 'bg-surface text-muted hover:text-ink'}`}
            >
              {periodLabel[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {TILE_ORDER.map((tab) => {
          const Icon = TILE_ICON[tab]
          const byPeriod = PERIOD_TABS.includes(tab)
          return (
            <button
              key={tab}
              type="button"
              data-testid={`dash-report-${tab}`}
              onClick={() => navigate(reportLink(tab, byPeriod ? period : undefined))}
              className="text-start bg-app rounded-lg px-3 py-3 border border-transparent hover:border-accent transition-colors"
            >
              <Icon className="w-4 h-4 text-muted mb-1.5" />
              <span className="block text-sm font-medium text-ink line-clamp-2">{tabLabel[tab]}</span>
              <span className="block text-[11px] text-muted mt-0.5">{byPeriod ? b.hintPeriod : b.hintNow}</span>
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted mt-3">{b.printNote}</p>
    </section>
  )
}
