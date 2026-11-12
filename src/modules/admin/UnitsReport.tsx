import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchUnitsList, fetchUnitHistory, fetchWarehouseStock, fetchApartmentsAdmin, type UnitHistory } from '@/modules/admin/api'
import type { UnitStatus } from '@/lib/database.types'
import { toast, errorMessage } from '@/lib/toast'
import { ErrorState } from '@/components/ErrorState'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { downloadCsv, printReport } from '@/modules/admin/reportExport'
import {
  buildUnitRows, filterUnitRows, statusCounts, matchesCodeOrLocation, EVENT_LABEL_KEYS,
  type UnitRowView, type UnitStatusFilter,
} from '@/modules/admin/unitsView'

function money(value: number | null, currency: string): string {
  if (value == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

export function UnitsReport({ currency }: { currency: string }) {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const [rows, setRows] = useState<UnitRowView[]>([])
  const [aptCode, setAptCode] = useState<Map<number, string>>(new Map())
  const [status, setStatus] = useState<UnitStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [history, setHistory] = useState<UnitHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchUnitsList(), fetchWarehouseStock(), fetchApartmentsAdmin()])
      .then(([list, stock, apts]) => {
        if (cancelled) return
        setAptCode(new Map(apts.map((a) => [a.id, a.code])))
        setRows(buildUnitRows(
          list.units,
          new Map(list.locations.map((l) => [l.id, l.name])),
          new Map(stock.map((s) => [s.item_id, s.name])),
        ))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(errorMessage(e))
        toast(errorMessage(e), 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load, reloadToken])

  const counts = useMemo(() => statusCounts(rows), [rows])
  const visible = useMemo(() => {
    const q = search.trim()
    return filterUnitRows(rows, status, (r) => q === '' || cat.matches(q, r.name, 'item') || matchesCodeOrLocation(r, q))
  }, [rows, status, search, cat])

  const statusLabel = (s: UnitStatus): string => {
    switch (s) {
      case 'in_stock': return t.admin.reports.unitStatusInStock
      case 'issued': return t.admin.reports.unitStatusIssued
      case 'written_off': return t.admin.reports.unitStatusWrittenOff
      default: return t.admin.reports.unitStatusLost
    }
  }
  const eventLabel = (e: string): string => {
    const key = EVENT_LABEL_KEYS[e]
    return key ? t.admin.reports[key] : e
  }
  const owner = (r: UnitRowView): string => (r.ownerApartmentId != null ? aptCode.get(r.ownerApartmentId) ?? `#${r.ownerApartmentId}` : '')

  const openHistory = (id: string) => {
    if (openId === id) { setOpenId(null); setHistory(null); return }
    setOpenId(id)
    setHistory(null)
    setHistoryLoading(true)
    fetchUnitHistory(id)
      .then((h) => setHistory(h))
      .catch((e: unknown) => toast(errorMessage(e), 'error'))
      .finally(() => setHistoryLoading(false))
  }

  const exportCsv = () => downloadCsv('units.csv',
    [t.admin.reports.item, t.admin.reports.unitCode, t.admin.reports.unitStatus, t.admin.reports.unitLocation, t.admin.reports.apartment, t.admin.reports.unitCostCol],
    visible.map((r) => [r.name, r.code, statusLabel(r.status), r.location, owner(r), r.unitCost]))

  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm ${active ? 'bg-accent text-on-accent' : 'bg-app text-muted'}`
  const filters: Array<[UnitStatusFilter, string]> = [
    ['all', t.admin.reports.filterAll],
    ['in_stock', t.admin.reports.unitStatusInStock],
    ['issued', t.admin.reports.unitStatusIssued],
    ['written_off', t.admin.reports.unitStatusWrittenOff],
    ['lost', t.admin.reports.unitStatusLost],
  ]

  const historyPanel = history && (
    <div className="bg-app rounded-lg px-3 py-3 my-2">
      <div className="text-sm font-semibold text-ink mb-2">{t.admin.reports.unitHistory}: {history.unit.code}</div>
      {history.events.length === 0 ? <p className="text-xs text-muted">{t.admin.reports.noRows}</p> : (
        <ul className="space-y-2">
          {history.events.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="text-xs text-ink">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{eventLabel(ev.event)}</span>
                <span className="text-muted whitespace-nowrap">{new Date(ev.at).toLocaleString()}</span>
              </div>
              <div className="text-muted">
                {[ev.from_location, ev.to_location].filter(Boolean).join(' → ')}
                {ev.doc_number ? ` · ${ev.doc_number}` : ''}
              </div>
              {ev.note && <div className="text-muted">{ev.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <section className="bg-surface border border-line rounded-xl overflow-hidden print:border-0">
      <div className="flex items-center justify-between px-3 py-3 border-b border-line gap-2">
        <h2 className="font-semibold text-ink text-sm">{t.admin.reports.unitsTab}</h2>
        <div className="flex gap-3 no-print">
          <button onClick={exportCsv} disabled={visible.length === 0} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Download className="w-3.5 h-3.5" />{t.admin.reports.export}</button>
          <button onClick={printReport} disabled={visible.length === 0} className="text-xs text-accent flex items-center gap-1 disabled:opacity-40"><Printer className="w-3.5 h-3.5" />{t.admin.reports.printReport}</button>
        </div>
      </div>
      <div className="p-3">
        <div className="flex gap-2 flex-wrap mb-3 no-print">
          {filters.map(([value, label]) => (
            <button key={value} onClick={() => setStatus(value)} className={chip(status === value)}>{label} · {n(String(counts[value]))}</button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.admin.reports.unitsSearchPlaceholder}
          className="w-full bg-app border border-line rounded-lg px-3 py-2 text-sm text-ink mb-3 no-print"
        />
        {loading ? <p className="text-sm text-muted text-center py-6">{t.app.loading}</p>
          : error ? <ErrorState message={error} onRetry={() => setReloadToken((k) => k + 1)} />
          : rows.length === 0 ? <p className="text-sm text-muted text-center py-6">{t.admin.reports.noUnits}</p>
          : visible.length === 0 ? <p className="text-sm text-muted text-center py-6">{t.admin.reports.noRows}</p>
          : (
            <>
              <div className="hidden sm:block print:block overflow-x-auto print:overflow-visible">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <Th>{t.admin.reports.item}</Th><Th>{t.admin.reports.unitCode}</Th><Th>{t.admin.reports.unitStatus}</Th>
                      <Th>{t.admin.reports.unitLocation}</Th><Th>{t.admin.reports.apartment}</Th><Th>{t.admin.reports.unitCostCol}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.id} onClick={() => openHistory(r.id)} className="border-t border-line cursor-pointer hover:bg-app">
                        <Td>{cat.itemName(r.name)}</Td><Td>{r.code}</Td><Td>{statusLabel(r.status)}</Td>
                        <Td>{r.location}</Td><Td>{owner(r)}</Td><Td>{money(r.unitCost, currency)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sm:hidden print:hidden space-y-2">
                {visible.map((r) => (
                  <button key={`c-${r.id}`} type="button" onClick={() => openHistory(r.id)} className="w-full text-start bg-app rounded-lg px-3 py-2.5">
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{cat.itemName(r.name)}</span>
                      <span className="text-xs text-muted whitespace-nowrap">{r.code}</span>
                    </div>
                    <div className="text-xs text-muted">{[statusLabel(r.status), r.location, owner(r)].filter(Boolean).join(' · ')}</div>
                  </button>
                ))}
              </div>
              {openId && (historyLoading ? <p className="text-xs text-muted text-center py-3">{t.app.loading}</p> : historyPanel)}
            </>
          )}
      </div>
    </section>
  )
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-start font-medium text-muted text-xs px-2 py-2 whitespace-nowrap">{children}</th> }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-2 py-2 text-ink whitespace-nowrap">{children}</td> }
