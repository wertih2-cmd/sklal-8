import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, Printer } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchItems, fetchReceiptDocuments, fetchSuppliers, fetchToOrder, fetchValuation } from '@/modules/admin/api'
import { formatDate, formatNum, formatQty } from '@/lib/format'
import { errorMessage } from '@/lib/toast'
import { ErrorState } from '@/components/ErrorState'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { downloadCsv, printReport } from '@/modules/admin/reportExport'
import { searchRows } from '@/modules/admin/reportSearch'
import {
  buildDeficit, deficitFields, deficitTotals, groupBySupplier, purchaseDocFields, purchaseTotals,
  type DeficitRow, type PurchaseDoc,
} from '@/modules/admin/purchaseReport'

type View = 'deficit' | 'suppliers'

function money(value: number | null, currency: string): string {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

function Th({ children, end }: { children: ReactNode; end?: boolean }) {
  return <th className={`${end ? 'text-end' : 'text-start'} font-medium text-muted text-xs px-2 py-2 whitespace-nowrap`}>{children}</th>
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="bg-app rounded-lg px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-base font-semibold ${tone === 'warn' ? 'text-warn' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-accent text-white' : 'bg-app text-muted'}`

/** Shortage to order (current state) and receipts per supplier (for the page period). `range.to` is exclusive. */
export function PurchasesReport({ range, currency }: { range: { from: string; to: string }; currency: string }) {
  const { t, n } = useI18n()
  const r = t.admin.reports
  const cat = useCatalogName()
  const [view, setView] = useState<View>('deficit')
  const [query, setQuery] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [supplierNames, setSupplierNames] = useState<Map<number, string>>(new Map())
  const [deficit, setDeficit] = useState<DeficitRow[] | null>(null)
  const [receipts, setReceipts] = useState<PurchaseDoc[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (view !== 'deficit') return
    let cancelled = false
    setDeficit(null)
    setError(null)
    Promise.all([fetchToOrder(), fetchValuation('company'), fetchItems(), fetchSuppliers()])
      .then(([toOrder, valuation, items, suppliers]) => {
        if (cancelled) return
        const avgCosts = new Map<number, number | null>(valuation.map((v) => [v.item_id, v.avg_cost == null ? null : Number(v.avg_cost)]))
        const targets = new Map<number, number | null>(items.map((i) => [i.id, i.target_stock == null ? null : Number(i.target_stock)]))
        const itemSuppliers = new Map<number, number | null>(items.map((i) => [i.id, i.supplier_id]))
        setSupplierNames(new Map(suppliers.map((s) => [s.id, s.name])))
        setDeficit(buildDeficit(toOrder, targets, avgCosts, itemSuppliers))
      })
      .catch((e: unknown) => { if (!cancelled) setError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [view, reloadToken])

  useEffect(() => {
    if (view !== 'suppliers') return
    let cancelled = false
    setReceipts(null)
    setError(null)
    Promise.all([fetchReceiptDocuments(range.from, range.to), fetchSuppliers()])
      .then(([docs, suppliers]) => {
        if (cancelled) return
        setSupplierNames(new Map(suppliers.map((s) => [s.id, s.name])))
        setReceipts(docs)
      })
      .catch((e: unknown) => { if (!cancelled) setError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [view, range.from, range.to, reloadToken])

  const searchCtx = useMemo(() => ({
    itemMatches: (token: string, base: string) => cat.matches(token, base, 'item'),
    categoryMatches: (token: string, base: string) => cat.matches(token, base, 'category'),
  }), [cat])

  const nameOf = (supplierId: number | null): string | null => (supplierId == null ? null : supplierNames.get(supplierId) ?? null)
  const supplierLabel = (supplierId: number | null): string =>
    supplierId == null ? r.purchasesNoSupplier : supplierNames.get(supplierId) ?? `#${n(String(supplierId))}`

  const deficitRows = useMemo(
    () => searchRows<DeficitRow>(deficit ?? [], query, searchCtx, (row) => deficitFields(row, row.supplierId == null ? null : supplierNames.get(row.supplierId) ?? null)),
    [deficit, query, searchCtx, supplierNames],
  )
  const deficitSummary = useMemo(() => deficitTotals(deficitRows), [deficitRows])

  const supplierGroups = useMemo(() => {
    const docs = searchRows<PurchaseDoc>(receipts ?? [], query, searchCtx, (doc) =>
      purchaseDocFields(doc, doc.supplier_id == null ? r.purchasesNoSupplier : supplierNames.get(doc.supplier_id) ?? null))
    return groupBySupplier(docs)
  }, [receipts, query, searchCtx, supplierNames, r.purchasesNoSupplier])
  const supplierSummary = useMemo(() => purchaseTotals(supplierGroups), [supplierGroups])

  const loading = !error && (view === 'deficit' ? deficit == null : receipts == null)
  const hasRows = view === 'deficit' ? deficitRows.length > 0 : supplierGroups.length > 0

  const exportCsv = () => {
    if (view === 'deficit') {
      downloadCsv('purchases-deficit.csv',
        [r.item, r.category, r.purchasesSupplier, r.colOnHand, r.minimum, r.purchasesTarget, r.purchasesToOrder, r.purchasesEstCost],
        deficitRows.map((row) => [row.name, row.category, nameOf(row.supplierId), row.onHand, row.minStock, row.target, row.orderQty, row.estCost]))
    } else {
      downloadCsv('purchases-by-supplier.csv',
        [r.purchasesSupplier, r.purchasesDoc, r.date, r.purchasesAmount, r.purchasesNote],
        supplierGroups.flatMap((g) => g.docs.map((d) => [supplierLabel(g.supplierId), d.number, d.doc_date, d.total_cost, d.note])))
    }
  }

  const itemLike = (row: DeficitRow) => ({ base_unit: row.baseUnit, pack_size: row.packSize, pack_label: row.packLabel })

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden print:border-0">
      <div className="flex items-center justify-between px-3 py-3 border-b border-line gap-2">
        <h2 className="font-semibold text-ink text-sm">{r.purchasesTab}</h2>
        <div className="flex gap-3 no-print">
          <button onClick={exportCsv} disabled={!hasRows} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Download className="w-3.5 h-3.5" />{r.export}</button>
          <button onClick={printReport} disabled={!hasRows} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Printer className="w-3.5 h-3.5" />{r.printReport}</button>
        </div>
      </div>
      <div className="p-3">
        <div className="flex gap-2 flex-wrap mb-3 no-print">
          <button onClick={() => setView('deficit')} className={chip(view === 'deficit')}>{r.purchasesDeficit}</button>
          <button onClick={() => setView('suppliers')} className={chip(view === 'suppliers')}>{r.purchasesSuppliers}</button>
        </div>
        <p className="text-xs text-muted mb-3">{view === 'deficit' ? r.purchasesSnapshotNote : r.purchasesCompanyOnly}</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={r.purchasesSearch}
          aria-label={r.purchasesSearch}
          data-testid="purchases-search"
          className="w-full bg-app border border-line rounded-lg px-3 py-2 text-sm text-ink mb-3 no-print"
        />
        {query.trim() && <p className="print-only text-xs text-muted mb-2">{r.searchPrint}: {query.trim()}</p>}

        {loading ? <p className="text-sm text-muted text-center py-6">{t.app.loading}</p>
          : error ? <ErrorState message={error} onRetry={() => setReloadToken((k) => k + 1)} />
          : view === 'deficit' ? (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label={r.purchasesPositions} value={n(formatNum(deficitSummary.count))} />
                <Stat label={r.purchasesEstTotal} value={money(deficitSummary.estTotal, currency)} />
                <Stat label={r.purchasesUncosted} value={n(formatNum(deficitSummary.uncosted))} tone={deficitSummary.uncosted > 0 ? 'warn' : undefined} />
              </div>
              {deficitRows.length === 0 ? (
                <p className="text-sm text-muted text-center py-6">{deficit && deficit.length > 0 ? t.common.noResults : r.purchasesDeficitEmpty}</p>
              ) : (
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <Th>{r.item}</Th><Th>{r.purchasesSupplier}</Th><Th end>{r.colOnHand}</Th><Th end>{r.minimum}</Th><Th end>{r.purchasesToOrder}</Th><Th end>{r.purchasesEstCost}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {deficitRows.map((row) => (
                        <tr key={row.itemId} className="border-t border-line">
                          <td className="px-2 py-2 text-ink">
                            {cat.itemName(row.name)}
                            <span className="block text-[11px] text-muted">{cat.categoryName(row.category)}</span>
                          </td>
                          <td className="px-2 py-2 text-ink">{row.supplierId == null ? '—' : supplierLabel(row.supplierId)}</td>
                          <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">{n(formatQty(row.onHand, itemLike(row)))}</td>
                          <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">{n(formatQty(row.minStock, itemLike(row)))}</td>
                          <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">
                            {row.packSize > 1 ? `${n(formatNum(row.orderPacks))} ${row.packLabel}` : n(formatNum(row.orderQty, { maximumFractionDigits: 3 }))}
                          </td>
                          <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">{money(row.estCost, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label={r.purchasesDocsCount} value={n(formatNum(supplierSummary.docs))} />
                <Stat label={r.purchasesAmount} value={money(supplierSummary.total, currency)} />
                <Stat label={r.purchasesUnpricedDocs} value={n(formatNum(supplierSummary.unpriced))} tone={supplierSummary.unpriced > 0 ? 'warn' : undefined} />
              </div>
              {supplierGroups.length === 0 ? (
                <p className="text-sm text-muted text-center py-6">{receipts && receipts.length > 0 ? t.common.noResults : r.purchasesEmpty}</p>
              ) : (
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead>
                      <tr><Th>{r.purchasesSupplier}</Th><Th>{r.date}</Th><Th end>{r.purchasesAmount}</Th></tr>
                    </thead>
                    <tbody>
                      {supplierGroups.map((g) => (
                        <Fragment key={g.key}>
                          <tr className="border-t border-line bg-app">
                            <td className="px-2 py-2 text-ink font-semibold">{supplierLabel(g.supplierId)} <span className="text-xs text-muted font-normal">({n(formatNum(g.docs.length))})</span></td>
                            <td />
                            <td className="px-2 py-2 text-ink font-semibold text-end tabular-nums whitespace-nowrap">{money(g.total, currency)}{g.unpriced > 0 ? ' *' : ''}</td>
                          </tr>
                          {g.docs.map((d) => (
                            <tr key={d.id} className="border-t border-line">
                              <td className="ps-6 pe-2 py-2 text-ink">
                                {d.number}
                                {d.note && <span className="block text-[11px] text-muted">{d.note}</span>}
                              </td>
                              <td className="px-2 py-2 text-ink whitespace-nowrap">{n(formatDate(d.doc_date))}</td>
                              <td className="px-2 py-2 text-ink text-end tabular-nums whitespace-nowrap">{money(d.total_cost, currency)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                  {supplierSummary.unpriced > 0 && <p className="text-xs text-muted mt-2">{r.costPartialNote}</p>}
                </div>
              )}
            </>
          )}
      </div>
    </section>
  )
}
