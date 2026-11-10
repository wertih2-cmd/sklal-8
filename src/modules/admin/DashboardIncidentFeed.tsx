import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wrench, Package, CircleAlert, ChevronRight, Search } from 'lucide-react'
import { useI18n } from '@/i18n'
import { fetchItems } from '@/modules/admin/api'
import type { Apartment, Incident, IncidentKind, IncidentStatus } from '@/lib/database.types'
import { relativeTime } from '@/lib/format'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { IncidentDetailModal, fetchProfileName } from '@/modules/incidents/IncidentDetailModal'
import {
  KIND_FILTERS, STATUS_FILTERS, filterIncidents, type KindFilter, type StatusFilter,
} from '@/modules/admin/incidentFilter'

const PAGE_SIZE = 8

const STATUS_CLASS: Record<IncidentStatus, string> = {
  new: 'bg-warn-soft text-warn',
  in_progress: 'bg-accent-soft text-accent',
  confirmed: 'bg-ok-soft text-ok',
  rejected: 'bg-bad-soft text-bad',
}

const KIND_ICON: Record<IncidentKind, ComponentType<{ className?: string }>> = {
  breakdown: Wrench,
  broken: CircleAlert,
  damaged: CircleAlert,
  lost: Package,
  other: CircleAlert,
}

export function DashboardIncidentFeed({ incidents, apartments }: { incidents: Incident[]; apartments: Apartment[] }) {
  const { t, n } = useI18n()
  const f = t.admin.dashboard.feed
  const cat = useCatalogName()
  const navigate = useNavigate()
  const [status, setStatus] = useState<StatusFilter>('open')
  const [kind, setKind] = useState<KindFilter>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [itemNames, setItemNames] = useState<Map<number, string>>(new Map())
  const [selected, setSelected] = useState<Incident | null>(null)
  const [authorName, setAuthorName] = useState<string | null>(null)
  const [resolverName, setResolverName] = useState<string | null>(null)

  // item names are only needed for search and row text; a failed load falls back to "#id"
  useEffect(() => {
    let cancelled = false
    fetchItems()
      .then((items) => { if (!cancelled) setItemNames(new Map(items.map((i) => [i.id, i.name]))) })
      .catch(() => { /* keep the fallback */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selected) return
    setAuthorName(null)
    setResolverName(null)
    if (selected.created_by) fetchProfileName(selected.created_by).then(setAuthorName)
    if (selected.resolved_by) fetchProfileName(selected.resolved_by).then(setResolverName)
  }, [selected])

  const aptCodes = useMemo(() => new Map(apartments.map((a) => [a.id, a.code])), [apartments])

  const statusLabel: Record<IncidentStatus, string> = {
    new: t.incidents.statusNew,
    in_progress: t.incidents.statusInProgress,
    confirmed: t.incidents.statusConfirmed,
    rejected: t.incidents.statusRejected,
  }
  const kindLabel: Record<IncidentKind, string> = {
    breakdown: t.incidents.kindBreakdown,
    broken: t.incidents.kindBroken,
    damaged: t.incidents.kindDamaged,
    lost: t.incidents.kindLost,
    other: t.incidents.kindOther,
  }
  const statusFilterLabel = (s: StatusFilter) => (s === 'open' ? f.statusOpen : s === 'all' ? f.statusAll : statusLabel[s])
  const kindFilterLabel = (k: KindFilter) => (k === 'all' ? f.kindAll : kindLabel[k])

  const filtered = useMemo(
    () => filterIncidents(incidents, { status, kind, query }, {
      apartmentCode: (id) => aptCodes.get(id),
      itemMatches: (token, itemId) => {
        const base = itemNames.get(itemId)
        return base != null && cat.matches(token, base, 'item')
      },
    }),
    [incidents, status, kind, query, aptCodes, itemNames, cat],
  )
  const shown = filtered.slice(0, visible)

  const itemText = (inc: Incident): string => {
    if (inc.free_text) return inc.free_text
    if (inc.item_id == null) return '—'
    const base = itemNames.get(inc.item_id)
    return base != null ? cat.itemName(base) : `#${n(String(inc.item_id))}`
  }

  const selectClass = 'bg-app rounded-lg px-2.5 py-2 text-sm text-ink border border-line focus:outline-none focus:border-accent'

  return (
    <section className="panel rounded-[20px] p-4 mb-5" data-testid="dash-incident-feed">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-ink">{f.title}</h2>
        <button
          type="button"
          onClick={() => navigate('/admin/more/incidents')}
          className="ms-auto text-xs text-accent hover:underline"
        >
          {f.openAll}
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE) }}
            placeholder={f.searchPlaceholder}
            aria-label={f.searchPlaceholder}
            data-testid="dash-feed-search"
            className="w-full bg-app rounded-lg ps-9 pe-3 py-2 text-sm text-ink border border-line focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as StatusFilter); setVisible(PAGE_SIZE) }}
          aria-label={f.statusLabel}
          data-testid="dash-feed-status"
          className={selectClass}
        >
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{statusFilterLabel(s)}</option>)}
        </select>
        <select
          value={kind}
          onChange={(e) => { setKind(e.target.value as KindFilter); setVisible(PAGE_SIZE) }}
          aria-label={f.kindLabel}
          data-testid="dash-feed-kind"
          className={selectClass}
        >
          {KIND_FILTERS.map((k) => <option key={k} value={k}>{kindFilterLabel(k)}</option>)}
        </select>
      </div>

      {incidents.length === 0 ? (
        <p className="text-sm text-muted">{t.admin.adminIncidents.noIncidents}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">{f.empty}</p>
      ) : (
        <>
          <p className="text-xs text-muted mb-1">{f.found}: {n(String(filtered.length))}</p>
          <ul>
            {shown.map((inc) => {
              const Icon = KIND_ICON[inc.kind]
              return (
                <li key={inc.id} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    onClick={() => setSelected(inc)}
                    className="w-full flex items-start gap-3 py-2.5 text-start hover:bg-app rounded-lg px-1"
                  >
                    <span className="w-8 h-8 bg-app rounded-lg flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-muted" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink">{aptCodes.get(inc.apartment_id) ?? `#${n(String(inc.apartment_id))}`}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CLASS[inc.status]}`}>{statusLabel[inc.status]}</span>
                      </span>
                      <span className="block text-sm text-ink truncate">{itemText(inc)}</span>
                      <span className="block text-xs text-muted">
                        {kindLabel[inc.kind]} · {n(String(inc.qty))} {t.common.units.pcs} · {n(relativeTime(inc.created_at))}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted shrink-0 mt-1 rtl:rotate-180" />
                  </button>
                </li>
              )
            })}
          </ul>
          {filtered.length > shown.length && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="mt-2 w-full bg-app rounded-lg py-2 text-sm text-ink hover:bg-accent-soft"
            >
              {f.showMore} ({n(String(filtered.length - shown.length))})
            </button>
          )}
        </>
      )}

      {selected && (
        <IncidentDetailModal
          incident={selected}
          apartmentCode={aptCodes.get(selected.apartment_id)}
          authorName={authorName}
          resolverName={resolverName}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}
