import { useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchStockTurnover, fetchOwnerVsCompany, fetchApartmentsAdmin } from '@/modules/admin/api'
import type { Apartment, OwnerVsCompanyReport, StockTurnoverRow } from '@/lib/database.types'
import { toast, errorMessage } from '@/lib/toast'
import { ErrorState } from '@/components/ErrorState'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { downloadCsv, printReport } from '@/modules/admin/reportExport'
import { filterTurnover, turnoverTotals } from '@/modules/admin/reportView'

type Scope = 'company' | 'owner'

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

/** from и to — включительные даты YYYY-MM-DD (границы по Africa/Cairo считает база). */
export function TurnoverReport({ from, to, currency }: { from: string; to: string; currency: string }) {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const [scope, setScope] = useState<Scope>('company')
  const [ownerApt, setOwnerApt] = useState('')
  const [onlyMovement, setOnlyMovement] = useState(true)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<StockTurnoverRow[]>([])
  const [summary, setSummary] = useState<OwnerVsCompanyReport | null>(null)
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const ownerApartments = useMemo(() => apartments.filter((a) => a.is_owner), [apartments])
  const needsApartment = scope === 'owner' && ownerApt === ''

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      needsApartment ? Promise.resolve([] as StockTurnoverRow[]) : fetchStockTurnover(from, to, scope, scope === 'owner' ? Number(ownerApt) : null),
      fetchOwnerVsCompany(from, to),
      fetchApartmentsAdmin(),
    ])
      .then(([turnover, ovc, apts]) => {
        if (cancelled) return
        setRows(turnover)
        setSummary(ovc)
        setApartments(apts)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(errorMessage(e))
        toast(errorMessage(e), 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to, scope, ownerApt, needsApartment, reloadToken])

  const visible = useMemo(() => {
    const q = search.trim()
    return filterTurnover(rows, onlyMovement, (name, category) =>
      q === '' || cat.matches(q, name, 'item') || cat.matches(q, category, 'category'))
  }, [rows, onlyMovement, search, cat])
  const totals = useMemo(() => turnoverTotals(visible), [visible])

  const exportCsv = () => downloadCsv(`stock-turnover-${scope}-${from}_${to}.csv`,
    [t.admin.reports.item, t.admin.reports.category, t.admin.reports.colInQty, t.admin.reports.colOutQty, t.admin.reports.colTransferInQty,
      t.admin.reports.colTransferOutQty, t.admin.reports.colInValue, t.admin.reports.colOutValue, t.admin.reports.colTransferInValue, t.admin.reports.colTransferOutValue],
    visible.map((r) => [r.item_name, r.category, r.in_qty, r.out_qty, r.transfer_in_qty, r.transfer_out_qty, r.in_value, r.out_value, r.transfer_in_value, r.transfer_out_value]))

  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-accent text-white' : 'bg-app text-muted'}`
  const card = (label: string, value: string) => (
    <div className="bg-app rounded-lg px-3 py-2.5"><div className="text-xs text-muted">{label}</div><div className="text-base font-semibold text-ink">{value}</div></div>
  )

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden print:border-0">
      <div className="flex items-center justify-between px-3 py-3 border-b border-line gap-2">
        <h2 className="font-semibold text-ink text-sm">{t.admin.reports.turnoverTab}</h2>
        <div className="flex gap-3 no-print">
          <button onClick={exportCsv} disabled={visible.length === 0} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Download className="w-3.5 h-3.5" />{t.admin.reports.export}</button>
          <button onClick={printReport} disabled={visible.length === 0} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Printer className="w-3.5 h-3.5" />{t.admin.reports.printReport}</button>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs text-muted mb-3">{from} — {to}</p>
        {error ? <ErrorState message={error} onRetry={() => setReloadToken((k) => k + 1)} /> : (
          <>
            {summary && (
              <>
                <h3 className="text-xs font-medium text-muted mb-2">{t.admin.reports.ovcTitle}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {card(t.admin.reports.ovcCompanyStock, money(Number(summary.company.stock_value), currency))}
                  {card(t.admin.reports.ovcOwnerStock, money(Number(summary.owner.stock_value), currency))}
                  {card(t.admin.reports.ovcOwnerApartments, n(String(summary.owner.total_apartments)))}
                  {card(t.admin.reports.totalPotential, money(Number(summary.company.potential_revenue) + Number(summary.owner.potential_revenue), currency))}
                  {card(t.admin.reports.ovcToOwner, `${n(String(summary.transfers.to_owner_count))} · ${money(Number(summary.transfers.to_owner_value), currency)}`)}
                  {card(t.admin.reports.ovcToCompany, `${n(String(summary.transfers.to_company_count))} · ${money(Number(summary.transfers.to_company_value), currency)}`)}
                </div>
              </>
            )}
            <div className="flex gap-2 flex-wrap mb-3 no-print">
              <button onClick={() => setScope('company')} className={chip(scope === 'company')}>{t.admin.reports.scopeCompany}</button>
              <button onClick={() => setScope('owner')} className={chip(scope === 'owner')}>{t.admin.reports.scopeOwner}</button>
              {scope === 'owner' && (
                <select value={ownerApt} onChange={(e) => setOwnerApt(e.target.value)} className="bg-app border border-line rounded-lg px-2 py-1.5 text-sm text-ink">
                  <option value="">{t.admin.reports.ownerApartmentPick}</option>
                  {ownerApartments.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm text-ink ms-auto">
                <input type="checkbox" checked={onlyMovement} onChange={(e) => setOnlyMovement(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
                {t.admin.reports.onlyMovement}
              </label>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.admin.reports.searchPlaceholder}
              className="w-full bg-app border border-line rounded-lg px-3 py-2 text-sm text-ink mb-3 no-print"
            />
            {needsApartment ? <p className="text-sm text-muted text-center py-6">{t.admin.reports.ownerApartmentPick}</p>
              : loading ? <p className="text-sm text-muted text-center py-6">{t.app.loading}</p>
              : visible.length === 0 ? <p className="text-sm text-muted text-center py-6">{t.admin.reports.noRows}</p>
              : (
                <>
                <div className="hidden sm:block print:block overflow-x-auto print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <Th>{t.admin.reports.item}</Th><Th>{t.admin.reports.category}</Th>
                        <Th>{t.admin.reports.colInQty}</Th><Th>{t.admin.reports.colOutQty}</Th>
                        <Th>{t.admin.reports.colTransferInQty}</Th><Th>{t.admin.reports.colTransferOutQty}</Th>
                        <Th>{t.admin.reports.colInValue}</Th><Th>{t.admin.reports.colOutValue}</Th>
                        <Th>{t.admin.reports.colTransferInValue}</Th><Th>{t.admin.reports.colTransferOutValue}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((r) => (
                        <tr key={r.item_id} className="border-t border-line">
                          <Td>{cat.itemName(r.item_name)}</Td><Td>{cat.categoryName(r.category)}</Td>
                          <Td>{n(String(r.in_qty))}</Td><Td>{n(String(r.out_qty))}</Td>
                          <Td>{n(String(r.transfer_in_qty))}</Td><Td>{n(String(r.transfer_out_qty))}</Td>
                          <Td>{money(r.in_value, currency)}</Td><Td>{money(r.out_value, currency)}</Td>
                          <Td>{money(r.transfer_in_value, currency)}</Td><Td>{money(r.transfer_out_value, currency)}</Td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line font-semibold">
                        <Td>{n(String(visible.length))}</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td><Td>{''}</Td>
                        <Td>{money(totals.inValue, currency)}</Td><Td>{money(totals.outValue, currency)}</Td>
                        <Td>{money(totals.transferInValue, currency)}</Td><Td>{money(totals.transferOutValue, currency)}</Td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="sm:hidden print:hidden space-y-2">
                  {visible.map((r) => (
                    <div key={`c-${r.item_id}`} className="bg-app rounded-lg px-3 py-2.5">
                      <div className="text-sm font-medium text-ink">{cat.itemName(r.item_name)}</div>
                      <div className="text-xs text-muted">{cat.categoryName(r.category)}</div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                        <Kv label={t.admin.reports.colInQty} value={n(String(r.in_qty))} />
                        <Kv label={t.admin.reports.colOutQty} value={n(String(r.out_qty))} />
                        <Kv label={t.admin.reports.colTransferInQty} value={n(String(r.transfer_in_qty))} />
                        <Kv label={t.admin.reports.colTransferOutQty} value={n(String(r.transfer_out_qty))} />
                        <Kv label={t.admin.reports.colInValue} value={money(r.in_value, currency)} />
                        <Kv label={t.admin.reports.colOutValue} value={money(r.out_value, currency)} />
                        <Kv label={t.admin.reports.colTransferInValue} value={money(r.transfer_in_value, currency)} />
                        <Kv label={t.admin.reports.colTransferOutValue} value={money(r.transfer_out_value, currency)} />
                      </dl>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2 px-1 pt-1 text-xs font-semibold text-ink">
                    <span>{n(String(visible.length))}</span>
                    <span>{money(totals.inValue, currency)} / {money(totals.outValue, currency)}</span>
                  </div>
                </div>
                </>
              )}
          </>
        )}
      </div>
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-left font-medium text-muted text-xs px-2 py-2 whitespace-nowrap">{children}</th> }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-2 py-2 text-ink whitespace-nowrap">{children}</td> }

function Kv({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-muted">{label}</dt><dd className="text-ink whitespace-nowrap">{value}</dd></div>
}
