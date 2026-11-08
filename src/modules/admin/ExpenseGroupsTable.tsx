import { Fragment, type ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { formatNum } from '@/lib/format'
import { groupTotals, type ExpenseGroup } from '@/modules/admin/expenseGroups'

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

function Th({ children, end }: { children: ReactNode; end?: boolean }) {
  return <th className={`${end ? 'text-end' : 'text-start'} font-medium text-muted text-xs px-2 py-2 whitespace-nowrap`}>{children}</th>
}

/** Expense totals per apartment, or per building with its apartments underneath. */
export function ExpenseGroupsTable({ groups, view, currency }: { groups: ExpenseGroup[]; view: 'apartments' | 'buildings'; currency: string }) {
  const { t, n } = useI18n()
  const r = t.admin.reports
  const totals = groupTotals(groups)
  const cost = (g: { priced: boolean; cost: number; partial: boolean }) => (g.priced ? `${money(g.cost, currency)}${g.partial ? ' *' : ''}` : '—')
  const first = view === 'buildings' ? r.groupBuilding : r.apartment
  const emptyFirst = view === 'buildings' ? r.groupNoBuilding : r.groupNoApartment
  const anyPartial = groups.some((g) => g.partial && g.priced)

  if (groups.length === 0) return <p className="text-sm text-muted text-center py-6">{t.common.noResults}</p>

  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-sm">
        <thead>
          <tr><Th>{first}</Th><Th end>{r.groupLines}</Th><Th end>{r.cost}</Th></tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr className={`border-t border-line ${view === 'buildings' ? 'bg-app' : ''}`}>
                <td className={`px-2 py-2 text-ink ${view === 'buildings' ? 'font-semibold' : ''}`}>{g.label || emptyFirst}</td>
                <td className="px-2 py-2 text-ink text-end tabular-nums">{n(formatNum(g.lines))}</td>
                <td className={`px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap ${view === 'buildings' ? 'font-semibold' : ''}`}>{cost(g)}</td>
              </tr>
              {g.children.map((c) => (
                <tr key={`${g.key}/${c.key}`} className="border-t border-line">
                  <td className="ps-6 pe-2 py-2 text-ink">{c.label || r.groupNoApartment}</td>
                  <td className="px-2 py-2 text-muted text-end tabular-nums">{n(formatNum(c.lines))}</td>
                  <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">{cost(c)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line font-semibold">
            <td className="px-2 py-2 text-ink">{r.groupTotal}</td>
            <td className="px-2 py-2 text-ink text-end tabular-nums">{n(formatNum(totals.lines))}</td>
            <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">{cost(totals)}</td>
          </tr>
        </tfoot>
      </table>
      {anyPartial && <p className="text-xs text-muted mt-2">{r.costPartialNote}</p>}
    </div>
  )
}
