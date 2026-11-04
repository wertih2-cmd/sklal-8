import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchValuation, fetchWarehouseStock, fetchApartmentsAdmin } from '@/modules/admin/api'
import type { Apartment, WarehouseStockRow } from '@/lib/database.types'
import { formatQty } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { ErrorState } from '@/components/ErrorState'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { downloadCsv, printReport } from '@/modules/admin/reportExport'
import {
  joinValuation, filterValuation, valuationTotals,
  type ValuationFilter, type ValuationView,
} from '@/modules/admin/reportView'

type Scope = 'company' | 'owner'

function money(value: number | null, currency: string): string {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

function pct(value: number | null): string {
  return value == null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}

export function ValuationReport({ currency }: { currency: string }) {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const [scope, setScope] = useState<Scope>('company')
  const [ownerApt, setOwnerApt] = useState<string>('all')
  const [filter, setFilter] = useState<ValuationFilter>('all')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ValuationView[]>([])
  const [stock, setStock] = useState<Map<number, WarehouseStockRow>>(new Map())
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const ownerApartments = useMemo(() => apartments.filter((a) => a.is_owner), [apartments])
  const aptCode = useMemo(() => new Map(apartments.map((a) => [a.id, a.code])), [apartments])

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const aptId = scope === 'owner' && ownerApt !== 'all' ? Number(ownerApt) : undefined
    Promise.all([fetchValuation(scope, aptId), fetchWarehouseStock(), fetchApartmentsAdmin()])
      .then(([val, st, apts]) => {
        if (cancelled) return
        const byId = new Map(st.map((s) => [s.item_id, s]))
        setStock(byId)
        setApartments(apts)
        setRows(joinValuation(val, new Map(st.map((s) => [s.item_id, { name: s.name, category: s.category }]))))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(errorMessage(e))
        toast(errorMessage(e), 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, ownerApt])

  useEffect(() => load(), [load, reloadToken])

  const visible = useMemo(() => {
    const q = search.trim()
    return filterValuation(rows, filter, (name, category) =>
      q === '' || cat.matches(q, name, 'item') || cat.matches(q, category, 'category'))
  }, [rows, filter, search, cat])

  const totals = useMemo(() => valuationTotals(visible), [visible])

  const qtyLabel = (r: ValuationView): string => {
    const s = stock.get(r.item_id)
    return s ? n(formatQty(r.on_hand, s)) : n(String(r.on_hand))
  }
  const owner = (r: ValuationView): string => (r.owner_apartment_id != null ? aptCode.get(r.owner_apartment_id) ?? `#${r.owner_apartment_id}` : '')

  const exportCsv = () => downloadCsv(`stock-valuation-${scope}.csv`,
    [t.admin.reports.item, t.admin.reports.category, t.admin.reports.apartment, t.admin.reports.colOnHand, t.admin.reports.minimum,
      t.admin.reports.colAvgCost, t.admin.reports.colGuestPrice, t.admin.reports.colStockValue, t.admin.reports.colPotential,
      t.admin.reports.colMarkup, t.admin.reports.colMargin],
    visible.map((r) => [r.name, r.category, owner(r), r.on_hand, r.min_stock, r.avg_cost, r.guest_price, r.stock_value, r.potential_revenue, r.markup_pct, r.margin_pct]))

  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-accent text-white' : 'bg-app text-muted'}`
  const filters: Array<[ValuationFilter, string]> = [
    ['all', t.admin.reports.filterAll],
    ['with_stock', t.admin.reports.filterWithStock],
    ['below_min', t.admin.reports.filterBelowMin],
    ['no_price', t.admin.reports.filterNoPrice],
  ]

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden print:border-0">
      <div className="flex items-center justify-between px-3 py-3 border-b border-line gap-2">
        <h2 className="font-semibold text-ink text-sm">{t.admin.reports.valuationTab}</h2>
        <div className="flex gap-3 no-print">
          <button onClick={exportCsv} disabled={visible.length === 0} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Download className="w-3.5 h-3.5" />{t.admin.reports.export}</button>
          <button onClick={printReport} disabled={visible.length === 0} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Printer className="w-3.5 h-3.5" />{t.admin.reports.printReport}</button>
        </div>
      </div>
      <div className="p-3">
        <div className="flex gap-2 flex-wrap mb-3 no-print">
          <button onClick={() => setScope('company')} className={chip(scope === 'company')}>{t.admin.reports.scopeCompany}</button>
          <button onClick={() => setScope('owner')} className={chip(scope === 'owner')}>{t.admin.reports.scopeOwner}</button>
          {scope === 'owner' && (
            <select value={ownerApt} onChange={(e) => setOwnerApt(e.target.value)} className="bg-app border border-line rounded-lg px-2 py-1.5 text-sm text-ink">
              <option value="all">{t.admin.reports.allApartments}</option>
              {ownerApartments.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-2 flex-wrap mb-3 no-print">
          {filters.map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={chip(filter === value)}>{label}</button>)}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.admin.reports.searchPlaceholder}
          className="w-full bg-app border border-line rounded-lg px-3 py-2 text-sm text-ink mb-3 no-print"
        />
        {loading ? <p className="text-sm text-muted text-center py-6">{t.app.loading}</p>
          : error ? <ErrorState message={error} onRetry={() => setReloadToken((k) => k + 1)} />
          : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <div className="bg-app rounded-lg px-3 py-2.5"><div className="text-xs text-muted">{t.admin.reports.itemsCount}</div><div className="text-base font-semibold text-ink">{n(String(totals.count))}</div></div>
                <div className="bg-app rounded-lg px-3 py-2.5"><div className="text-xs text-muted">{t.admin.reports.totalStockValue}</div><div className="text-base font-semibold text-ink">{money(totals.stockValue, currency)}</div></div>
                <div className="bg-app rounded-lg px-3 py-2.5"><div className="text-xs text-muted">{t.admin.reports.totalPotential}</div><div className="text-base font-semibold text-ink">{money(totals.potentialRevenue, currency)}</div></div>
                <div className="bg-app rounded-lg px-3 py-2.5"><div className="text-xs text-muted">{t.admin.reports.uncostedNote}</div><div className="text-base font-semibold text-warn">{n(String(totals.uncosted))}</div></div>
              </div>
              {visible.length === 0 ? <p className="text-sm text-muted text-center py-6">{t.admin.reports.noRows}</p> : (
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <Th>{t.admin.reports.item}</Th><Th>{t.admin.reports.category}</Th>
                        {scope === 'owner' && <Th>{t.admin.reports.apartment}</Th>}
                        <Th>{t.admin.reports.colOnHand}</Th><Th>{t.admin.reports.minimum}</Th><Th>{t.admin.reports.colAvgCost}</Th>
                        <Th>{t.admin.reports.colGuestPrice}</Th><Th>{t.admin.reports.colStockValue}</Th><Th>{t.admin.reports.colPotential}</Th>
                        <Th>{t.admin.reports.colMarkup}</Th><Th>{t.admin.reports.colMargin}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={`${r.owner_apartment_id ?? 'c'}-${r.item_id}`} className="border-t border-line">
                          <Td>{cat.itemName(r.name)}</Td><Td>{cat.categoryName(r.category)}</Td>
                          {scope === 'owner' && <Td>{owner(r)}</Td>}
                          <Td>{qtyLabel(r)}</Td><Td>{r.min_stock == null ? '—' : n(String(r.min_stock))}</Td><Td>{money(r.avg_cost, currency)}</Td>
                          <Td>{money(r.guest_price, currency)}</Td><Td>{money(r.stock_value, currency)}</Td><Td>{money(r.potential_revenue, currency)}</Td>
                          <Td>{pct(r.markup_pct)}</Td><Td>{pct(r.margin_pct)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </div>
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-left font-medium text-muted text-xs px-2 py-2 whitespace-nowrap">{children}</th> }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-2 py-2 text-ink whitespace-nowrap">{children}</td> }
