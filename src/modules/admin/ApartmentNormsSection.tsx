import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import type { Apartment, AptType, Building } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { ErrorState } from '@/components/ErrorState'
import { friendlyMessage } from '@/lib/errors'
import { useLiveRefresh } from '@/lib/realtime'
import { fetchApartmentsAdmin, fetchBuildings } from '@/modules/admin/api'
import { fetchApartmentNormCounts } from '@/modules/admin/norms'
import { buildAptNormRows, filterAptNormRows, summarize, type ModeFilter } from '@/modules/admin/aptNormsModel'
import { ApartmentNormMode } from '@/modules/admin/ApartmentNormMode'

/** "By apartment" view of the norms page: who follows the template of the type and who has norms of their own. */
export function ApartmentNormsSection({ typeLabels }: { typeLabels: Record<AptType, string> }) {
  const { t, n } = useI18n()
  const a = t.admin.aptNorms
  const navigate = useNavigate()
  const [apartments, setApartments] = useState<Apartment[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [counts, setCounts] = useState<Map<number, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ModeFilter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback((quiet = false) => {
    if (!quiet) { setLoading(true); setLoadError(false) }
    Promise.all([fetchApartmentsAdmin(), fetchBuildings(), fetchApartmentNormCounts()])
      .then(([apts, blds, cnt]) => { setApartments(apts); setBuildings(blds); setCounts(cnt) })
      .catch((e) => { if (!quiet) { console.error(friendlyMessage(e)); setLoadError(true) } })
      .finally(() => { if (!quiet) setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['norm_rules', 'apartments'], () => load(true))

  const rows = useMemo(() => buildAptNormRows(apartments, buildings, counts), [apartments, buildings, counts])
  const shown = useMemo(() => filterAptNormRows(rows, query, filter), [rows, query, filter])
  const sum = summarize(rows)
  const selected = apartments.find((x) => x.id === selectedId) ?? null

  if (loading) return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  if (loadError) return <ErrorState onRetry={() => load()} />

  const chips: Array<{ id: ModeFilter; label: string }> = [
    { id: 'all', label: a.filterAll },
    { id: 'individual', label: a.filterIndividual },
    { id: 'type', label: a.filterType },
  ]

  return (
    <div className="px-4 pt-4 pb-28">
      <p className="text-xs text-muted bg-app rounded-xl px-3 py-2.5 mb-3">{a.hint}</p>
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-muted absolute start-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={a.search}
          className="w-full well rounded-xl ps-10 pe-4 py-2.5 text-sm focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={`rounded-full px-3 py-1.5 text-xs min-h-[36px] ${filter === c.id ? 'bg-accent text-on-accent font-medium' : 'well text-muted'}`}
          >
            {c.label}
          </button>
        ))}
        <span className="text-xs text-muted ms-auto">{a.summary}: {n(String(sum.individual))} / {n(String(sum.total))}</span>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted px-3">{a.empty}</p>
      ) : (
        <div className="tile rounded-[20px] divide-y divide-[var(--line)]">
          {shown.map((r) => (
            <button
              key={r.apartment.id}
              type="button"
              onClick={() => setSelectedId(r.apartment.id)}
              className="w-full px-4 py-3 flex items-center justify-between gap-3 text-start min-h-[52px]"
            >
              <span className="min-w-0">
                <span className="text-sm text-ink block truncate">{r.apartment.code}</span>
                <span className="text-xs text-muted block truncate">{[r.buildingName, typeLabels[r.apartment.type]].filter(Boolean).join(' · ')}</span>
              </span>
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${r.mode === 'individual' ? 'bg-accent text-on-accent' : 'well text-muted'}`}>
                {r.mode === 'individual' ? `${a.modeIndividual} · ${n(String(r.count))}` : a.modeType}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <Modal open title={selected.code} onClose={() => setSelectedId(null)} size="sm">
          <div className="space-y-3">
            <ApartmentNormMode apartment={selected} typeLabels={typeLabels} />
            <button
              type="button"
              onClick={() => navigate(`/admin/apartments/${selected.id}`)}
              className="w-full bg-accent text-on-accent rounded-xl px-4 py-2.5 text-sm font-medium min-h-[44px]"
            >
              {a.openApt}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
