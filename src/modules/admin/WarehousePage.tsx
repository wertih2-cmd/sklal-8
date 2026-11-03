import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchWarehouseStock, fetchStockMoves, fetchOwnerStock, fetchValuation, setGuestPrice, setItemCost } from '@/modules/admin/api'
import type { StockMoveRow, WarehouseValuationRow, ItemKind } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatQty, formatDateTime, formatEGP } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { ArrowLeftRight, Search } from 'lucide-react'
import { OwnerBadge } from '@/components/OwnerBadge'
import { ErrorState } from '@/components/ErrorState'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { mergeCompany, mergeOwner, type MergedStockRow, type MergedOwnerRow } from './stockRows'
import { summarize, formatPct } from './stockMetrics'
import { parseGuestPrice, parseCost } from './guestPrice'
import { canAddToSelection, getIneligibleReason, type IneligibleReason, type TransferCandidate, type TransferSelection } from './transferSelection'
import { TransferModal } from './TransferModal'
import { SelectCheckbox, TransferActionBar } from './TransferSelectionControls'

type KindFilter = 'all' | 'assets' | 'consumables'
type StockTab = 'company' | 'owner'

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <span className="block h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
      <span className="block h-full rounded-full" style={{ width: `${Math.min(value, 100)}%`, background: color }} />
    </span>
  )
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-line rounded-xl px-3 py-2.5">
      <div className="text-xs text-muted mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  )
}

interface SetCostTarget {
  itemId: number
  itemName: string
  apartmentId?: number
  code?: string
}

function SetCostModal({
  target, scope, labels, onClose, onApplied,
}: {
  target: SetCostTarget
  scope: 'company' | 'owner'
  labels: {
    apply: string
    cancel: string
    explanation: string
    note: string
    scopeLabel: string
    invalidCost: string
  }
  onClose: () => void
  onApplied: (result: { avg_cost_after: number | null }) => void
}) {
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleApply = async () => {
    if (saving) return
    const parsed = parseCost(input)
    if (!parsed.ok || parsed.value == null) {
      toast(labels.invalidCost, 'error')
      return
    }
    setSaving(true)
    try {
      const result = await setItemCost(target.itemId, parsed.value, note.trim() || null, scope === 'owner' ? target.apartmentId : undefined)
      onApplied(result)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="bg-surface border border-line rounded-xl p-4 mx-4 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-ink mb-1">{target.itemName}</div>
        <div className="text-xs text-muted mb-3">{labels.scopeLabel}</div>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApply() } if (e.key === 'Escape') onClose() }}
          inputMode="decimal"
          disabled={saving}
          placeholder="0"
          className="w-full min-h-[44px] bg-app rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none mb-2"
        />
        <p className="text-xs text-muted mb-3">{labels.explanation}</p>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
          placeholder={labels.note}
          className="w-full min-h-[44px] bg-app rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none mb-3"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-surface border border-line text-muted disabled:opacity-50"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={saving}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-50"
          >
            {labels.apply}
          </button>
        </div>
      </div>
    </div>
  )
}

function GuestPriceCell({
  itemId, guestPrice, onSave, saveLabel, cancelLabel, invalidPriceLabel, formatValue,
}: {
  itemId: number
  guestPrice: number | null
  onSave: (itemId: number, value: number | null) => Promise<void>
  saveLabel: string
  cancelLabel: string
  invalidPriceLabel: string
  formatValue: (v: number | null) => string
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setInput(guestPrice != null && guestPrice > 0 ? String(guestPrice) : '')
    setEditing(true)
  }

  const handleSave = async () => {
    if (saving) return
    const parsed = parseGuestPrice(input)
    if (!parsed.ok) {
      toast(invalidPriceLabel, 'error')
      return
    }
    setSaving(true)
    try {
      await onSave(itemId, parsed.value)
      setEditing(false)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); startEdit() }}
        className="text-sm text-ink hover:text-accent transition-colors"
      >
        {formatValue(guestPrice)}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleSave() }
          if (e.key === 'Escape') setEditing(false)
        }}
        inputMode="decimal"
        disabled={saving}
        className="w-20 bg-app rounded-lg px-2 py-1.5 text-sm border border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="min-h-[44px] px-3 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-50"
      >
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={saving}
        className="min-h-[44px] px-3 rounded-lg text-xs font-medium bg-surface border border-line text-muted disabled:opacity-50"
      >
        {cancelLabel}
      </button>
    </div>
  )
}

export function WarehousePage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: StockTab = searchParams.get('tab') === 'owner' ? 'owner' : 'company'

  const setTab = (next: StockTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'owner') params.set('tab', 'owner')
    else params.delete('tab')
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="px-4 pt-5 pb-28 lg:px-0 lg:pt-0">
      <h1 className="text-xl font-semibold text-ink mb-4">{t.admin.stock.title}</h1>

      <div className="inline-flex bg-surface border border-line rounded-lg p-0.5 mb-4">
        <button
          onClick={() => setTab('company')}
          className={`px-4 py-2 rounded-md text-sm transition-colors ${tab === 'company' ? 'bg-accent text-white' : 'text-muted'}`}
        >
          {t.admin.stock.tabCompany}
        </button>
        <button
          onClick={() => setTab('owner')}
          className={`px-4 py-2 rounded-md text-sm transition-colors ${tab === 'owner' ? 'bg-accent text-white' : 'text-muted'}`}
        >
          {t.admin.stock.tabOwner}
        </button>
      </div>

      <StockView key={tab} scope={tab} />
    </div>
  )
}

function StockView({ scope }: { scope: 'company' | 'owner' }) {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const [rows, setRows] = useState<MergedStockRow[]>([])
  const [ownerRows, setOwnerRows] = useState<MergedOwnerRow[]>([])
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [apartmentFilter, setApartmentFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [valuationFailed, setValuationFailed] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [moves, setMoves] = useState<StockMoveRow[]>([])
  const [movesLoading, setMovesLoading] = useState(false)
  const [movesOffset, setMovesOffset] = useState(0)
  const [hasMoreMoves, setHasMoreMoves] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const belowOnly = searchParams.get('below') === '1'
  const noGuestPrice = searchParams.get('noprice') === '1'
  const [costTarget, setCostTarget] = useState<SetCostTarget | null>(null)

  const isOwner = scope === 'owner'
  const [selectionMode, setSelectionMode] = useState(false)
  const [selection, setSelection] = useState<TransferSelection>([])
  const [transferOpen, setTransferOpen] = useState(false)
  const transferDirection = isOwner ? 'to_company' : 'to_owner'
  const selectedKeys = useMemo(() => new Set(selection.map((e) => e.row.key)), [selection])

  const toCandidate = (row: MergedStockRow): TransferCandidate => {
    const apartmentId = isOwner ? (row as MergedOwnerRow).apartment_id : null
    return {
      key: `${row.item_id}-${apartmentId ?? ''}`,
      item_id: row.item_id,
      name: row.name,
      kind: row.kind,
      qty: row.qty,
      apartment_id: apartmentId,
      unit: { base_unit: row.base_unit, pack_size: row.pack_size, pack_label: row.pack_label },
    }
  }

  const toggleRow = (row: MergedStockRow) => {
    const candidate = toCandidate(row)
    setSelection((prev) => {
      if (prev.some((e) => e.row.key === candidate.key)) return prev.filter((e) => e.row.key !== candidate.key)
      return canAddToSelection(prev, candidate) ? [...prev, { row: candidate, qty: 1 }] : prev
    })
  }

  const selectEligibleVisible = () => {
    setSelection((prev) => {
      let next = prev
      for (const row of filtered) {
        const candidate = toCandidate(row)
        if (canAddToSelection(next, candidate)) next = [...next, { row: candidate, qty: 1 }]
      }
      return next
    })
  }

  const toggleSelectionMode = () => {
    setSelectionMode((v) => !v)
    setSelection([])
  }

  const handleTransferDone = () => {
    setTransferOpen(false)
    setSelectionMode(false)
    setSelection([])
    loadData(true)
  }

  const loadData = useCallback((silent?: boolean) => {
    const quiet = silent === true
    if (!quiet) { setLoading(true); setError(false) }
    if (isOwner) {
      const valPromise = fetchValuation('owner').catch((e) => { if (!quiet) toast(errorMessage(e), 'error'); return null })
      const ownerPromise = fetchOwnerStock().catch((e) => { if (!quiet) { setError(true); toast(errorMessage(e), 'error') }; return null })
      const stockPromise = fetchWarehouseStock().catch(() => null)
      Promise.allSettled([valPromise, ownerPromise, stockPromise]).then(([valRes, ownerRes, stockRes]) => {
        const valuation = valRes.status === 'fulfilled' ? valRes.value : null
        const ownerStock = ownerRes.status === 'fulfilled' ? ownerRes.value : null
        const warehouseStock = stockRes.status === 'fulfilled' ? stockRes.value : null
        if (ownerStock == null) { if (!quiet) setLoading(false); return }
        const meta = new Map<number, { category: string; kind: ItemKind }>()
        for (const s of warehouseStock ?? []) {
          meta.set(s.item_id, { category: s.category, kind: s.kind })
        }
        const merged = mergeOwner(ownerStock, valuation ?? [], meta)
        setValuationFailed(valuation == null)
        if (valuation == null && !quiet) toast(t.admin.stock.valuationError, 'error')
        setOwnerRows(merged)
        if (!quiet) setLoading(false)
      })
    } else {
      const valPromise = fetchValuation('company').catch((e) => { if (!quiet) toast(errorMessage(e), 'error'); return null })
      const stockPromise = fetchWarehouseStock().catch((e) => { if (!quiet) { setError(true); toast(errorMessage(e), 'error') }; return null })
      Promise.allSettled([valPromise, stockPromise]).then(([valRes, stockRes]) => {
        const valuation = valRes.status === 'fulfilled' ? valRes.value : null
        const stock = stockRes.status === 'fulfilled' ? stockRes.value : null
        if (stock == null) { if (!quiet) setLoading(false); return }
        const merged = mergeCompany(stock, valuation ?? [])
        setValuationFailed(valuation == null)
        if (valuation == null && !quiet) toast(t.admin.stock.valuationError, 'error')
        setRows(merged)
        if (!quiet) setLoading(false)
      })
    }
  }, [isOwner, t])

  useEffect(() => { loadData() }, [loadData])
  useLiveRefresh(['stock_moves', 'items', 'locations'], () => loadData(true))

  const handleGuestPriceSave = useCallback(async (itemId: number, value: number | null) => {
    await setGuestPrice(itemId, value)
    toast(t.admin.stock.priceSaved, 'success')
    loadData(true)
  }, [loadData, t])

  const handleCostApplied = useCallback((result: { avg_cost_after: number | null }) => {
    toast(t.admin.stock.costApplied.replace('{{cost}}', result.avg_cost_after != null ? n(formatEGP(result.avg_cost_after)) : '—'), 'success')
    setCostTarget(null)
    loadData(true)
  }, [loadData, t, n])

  const costModalLabels = useMemo(() => ({
    apply: t.admin.stock.apply,
    cancel: t.admin.stock.cancel,
    explanation: t.admin.stock.costExplanation,
    note: t.admin.stock.costNote,
    invalidCost: t.admin.stock.invalidCost,
  }), [t])

  const formatGuestPriceDisplay = (v: number | null) =>
    v != null && v > 0 ? n(formatEGP(v)) : '—'

  const apartments = useMemo(() => {
    if (!isOwner) return []
    const map = new Map<number, string>()
    for (const r of ownerRows) map.set(r.apartment_id, r.code)
    return Array.from(map.entries()).map(([id, code]) => ({ id, code })).sort((a, b) => a.code.localeCompare(b.code))
  }, [ownerRows, isOwner])

  const categories = useMemo(() => {
    const src = isOwner ? ownerRows : rows
    const set = new Set<string>()
    for (const s of src) set.add(s.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows, ownerRows, isOwner])

  const filtered = useMemo(() => {
    const src = isOwner ? ownerRows : rows
    return src.filter((s) => {
      if (kindFilter === 'assets' && s.kind !== 'asset') return false
      if (kindFilter === 'consumables' && s.kind !== 'consumable') return false
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
      if (belowOnly && !s.below_min) return false
      if (noGuestPrice && s.guest_price != null && s.guest_price > 0) return false
      if (isOwner && apartmentFilter !== 'all' && (s as MergedOwnerRow).apartment_id !== Number(apartmentFilter)) return false
      if (search.trim()) {
        const nameRow = s as MergedStockRow & { name: string }
        if (!cat.matches(search.trim(), nameRow.name, 'item')) return false
      }
      return true
    })
  }, [rows, ownerRows, isOwner, kindFilter, categoryFilter, belowOnly, noGuestPrice, apartmentFilter, search, cat])

  const summary = useMemo(() => {
    const valRows: WarehouseValuationRow[] = filtered.map((r) => ({
      scope: isOwner ? 'owner' : 'company',
      owner_apartment_id: isOwner ? (r as MergedOwnerRow).apartment_id : null,
      item_id: r.item_id,
      on_hand: r.qty,
      min_stock: r.min_stock,
      avg_cost: r.avg_cost,
      guest_price: r.guest_price,
      stock_value: r.stock_value,
      potential_revenue: null,
      markup_pct: r.markup_pct,
      margin_pct: r.margin_pct,
    }))
    return summarize(valRows)
  }, [filtered, isOwner])

  const grouped = useMemo(() => {
    if (isOwner) {
      const map = new Map<number, { code: string; items: MergedOwnerRow[] }>()
      for (const r of filtered as MergedOwnerRow[]) {
        const entry = map.get(r.apartment_id) ?? { code: r.code, items: [] }
        entry.items.push(r)
        map.set(r.apartment_id, entry)
      }
      return Array.from(map.entries()).map(([id, entry]) => ({
        key: String(id),
        label: entry.code,
        isOwnerGroup: true,
        items: entry.items.sort((a, b) => a.name.localeCompare(b.name)),
        subtotal: entry.items.reduce((sum, r) => sum + (r.stock_value ?? 0), 0),
      }))
    }
    const map = new Map<string, MergedStockRow[]>()
    for (const r of filtered as MergedStockRow[]) {
      const list = map.get(r.category) ?? []
      list.push(r)
      map.set(r.category, list)
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      key: category,
      label: cat.categoryName(category),
      isOwnerGroup: false,
      items: items.sort((a, b) => Number(b.below_min) - Number(a.below_min) || a.name.localeCompare(b.name)),
      subtotal: null,
    })).sort((a, b) => a.label.localeCompare(b.label))
  }, [filtered, isOwner, cat])

  const ownerLocLabel = (location: StockMoveRow['from_location']) => {
    if (!location) return '—'
    if (location.type === 'warehouse') return t.admin.stock.warehouse
    if (location.type === 'sink') return t.admin.stock.expense
    if (location.type === 'owner_stock' && (location as { name: string }).name) {
      const code = (location as { name: string }).name.replace(/^Owner:\s*/, '')
      return t.admin.stock.ownerWarehouseCode.replace('{{code}}', code)
    }
    return location.name
  }

  const loadMoves = (itemId: number, offset: number, append: boolean) => {
    setMovesLoading(true)
    fetchStockMoves(itemId, offset)
      .then((nextMoves) => {
        setMoves((previous) => append ? [...previous, ...nextMoves] : nextMoves)
        setMovesOffset(offset + nextMoves.length)
        setHasMoreMoves(nextMoves.length === 50)
      })
      .catch((error) => toast(errorMessage(error), 'error'))
      .finally(() => setMovesLoading(false))
  }

  const toggleExpand = (itemId: number) => {
    if (expandedId === itemId) {
      setExpandedId(null)
      return
    }
    setExpandedId(itemId)
    setMoves([])
    setMovesOffset(0)
    setHasMoreMoves(false)
    loadMoves(itemId, 0, false)
  }

  const toggleBelowMin = () => {
    const params = new URLSearchParams(searchParams)
    if (belowOnly) params.delete('below')
    else params.set('below', '1')
    setSearchParams(params, { replace: true })
  }

  const toggleNoGuestPrice = () => {
    const params = new URLSearchParams(searchParams)
    if (noGuestPrice) params.delete('noprice')
    else params.set('noprice', '1')
    setSearchParams(params, { replace: true })
  }

  const selectedOwnerCode = useMemo(() => {
    const apartmentId = selection[0]?.row.apartment_id
    if (apartmentId == null) return null
    return ownerRows.find((r) => r.apartment_id === apartmentId)?.code ?? null
  }, [selection, ownerRows])

  const selectState = (row: MergedStockRow): { checked: boolean; reason: IneligibleReason | null } => {
    if (selectedKeys.has(toCandidate(row).key)) return { checked: true, reason: null }
    return { checked: false, reason: getIneligibleReason(selection, toCandidate(row)) }
  }

  const reasonText = (reason: IneligibleReason) => {
    if (reason === 'consumable') return t.admin.stock.reasonConsumable
    if (reason === 'noStock') return t.admin.stock.reasonNoStock
    return t.admin.stock.reasonOtherApartment
  }

  const renderSelectBox = (row: MergedStockRow) => {
    const { checked, reason } = selectState(row)
    return (
      <SelectCheckbox
        checked={checked}
        disabled={reason !== null}
        label={cat.itemName(row.name)}
        title={reason ? reasonText(reason) : undefined}
        onToggle={() => toggleRow(row)}
      />
    )
  }

  const renderReasonLine = (row: MergedStockRow) => {
    const { reason } = selectState(row)
    return reason ? <span className="block text-xs text-muted mt-0.5">{reasonText(reason)}</span> : null
  }

  if (loading) {
    return <div className="px-4 pt-8 text-center text-muted">{t.app.loading}</div>
  }

  if (error) {
    return <ErrorState onRetry={() => loadData()} />
  }

  const stock = t.admin.stock
  const showSummary = filtered.length > 0

  return (
    <>
      {showSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
          <SummaryTile label={stock.positions} value={n(String(summary.positions))} />
          <SummaryTile label={stock.stockValue} value={valuationFailed ? '—' : n(formatEGP(summary.totalStockValue))} />
          <SummaryTile label={stock.potentialRevenue} value={valuationFailed ? '—' : n(formatEGP(summary.totalPotentialRevenue))} />
          <SummaryTile label={stock.markup} value={formatPct(summary.weightedMarkupPct)} />
          <SummaryTile label={stock.margin} value={formatPct(summary.weightedMarginPct)} />
        </div>
      )}

      <div className="flex gap-2.5 flex-wrap mb-3.5">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={stock.search}
            className="w-full bg-surface rounded-lg pl-10 pr-4 py-2 text-sm border border-line focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-surface rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none"
        >
          <option value="all">{stock.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{cat.categoryName(c)}</option>
          ))}
        </select>
        {isOwner && (
          <select
            value={apartmentFilter}
            onChange={(e) => setApartmentFilter(e.target.value)}
            className="bg-surface rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none"
          >
            <option value="all">{stock.allApartments}</option>
            {apartments.map((a) => (
              <option key={a.id} value={String(a.id)}>{a.code}</option>
            ))}
          </select>
        )}
        <div className="inline-flex bg-surface border border-line rounded-lg p-0.5">
          {(['all', 'assets', 'consumables'] as KindFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setKindFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                kindFilter === f ? 'bg-accent text-white' : 'text-muted'
              }`}
            >
              {f === 'all' ? stock.all : f === 'assets' ? stock.assets : stock.consumables}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleSelectionMode}
          aria-pressed={selectionMode}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap ${selectionMode ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-line'}`}
        >
          <ArrowLeftRight className="w-4 h-4" />
          {isOwner ? stock.transferToCompany : stock.transferToOwner}
        </button>
        {!isOwner && (
          <button
            onClick={toggleBelowMin}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${belowOnly ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-line'}`}
          >
            {stock.belowMin}
          </button>
        )}
        <button
          onClick={toggleNoGuestPrice}
          className={`px-3 py-2 rounded-lg text-sm border transition-colors whitespace-nowrap ${noGuestPrice ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-line'}`}
        >
          {stock.noGuestPrice}
        </button>
      </div>

      <div className="space-y-5">
        {grouped.map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <h2 className="font-semibold text-sm text-ink">{group.label}</h2>
              {group.isOwnerGroup && <OwnerBadge />}
              {group.subtotal != null && group.subtotal > 0 && (
                <span className="text-xs text-muted">{n(formatEGP(group.subtotal))}</span>
              )}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block bg-surface border border-line rounded-xl overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {selectionMode && <th className="w-11 border-b border-line" />}
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line">{stock.title}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{t.common.balance} / {stock.min}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{stock.avgCost}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{stock.guestPrice}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{stock.markup}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{stock.margin}</th>
                    <th className="text-left font-medium text-muted text-xs px-2.5 py-2 border-b border-line whitespace-nowrap">{stock.stockValue}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const expanded = !isOwner && !selectionMode && expandedId === item.item_id
                    const minPct = !isOwner && item.min_stock ? Math.min((item.qty / item.min_stock) * 100, 100) : 100
                    const itemRow = item as MergedStockRow
                    return (
                      <Fragment key={`${item.item_id}-${isOwner ? (item as MergedOwnerRow).apartment_id : ''}`}>
                        <tr
                          onClick={() => (selectionMode ? toggleRow(itemRow) : !isOwner && toggleExpand(item.item_id))}
                          className={selectionMode || !isOwner ? 'cursor-pointer transition-colors hover:bg-app' : ''}
                        >
                          {selectionMode && <td className="px-1 py-2.5 border-b border-line">{renderSelectBox(itemRow)}</td>}
                          <td className="px-2.5 py-2.5 border-b border-line">
                            <span className="text-sm text-ink">{cat.itemName(itemRow.name)}</span>
                            {selectionMode && renderReasonLine(itemRow)}
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap" style={{ minWidth: '140px' }}>
                            <span className={itemRow.below_min ? 'text-bad' : 'text-ink'}>{n(formatQty(itemRow.qty, itemRow))}</span>
                            {!isOwner && (
                              <>
                                <span className="text-muted text-xs"> / {itemRow.min_stock != null ? n(formatQty(itemRow.min_stock, itemRow)) : '—'}</span>
                                <ProgressBar value={minPct} color={itemRow.below_min ? 'var(--bad)' : 'var(--ok)'} />
                              </>
                            )}
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap text-sm text-ink" onClick={(e) => e.stopPropagation()}>
                            {itemRow.avg_cost != null
                              ? n(formatEGP(itemRow.avg_cost))
                              : itemRow.qty > 0
                                ? <button type="button" onClick={() => setCostTarget({ itemId: item.item_id, itemName: cat.itemName(itemRow.name), apartmentId: isOwner ? (item as MergedOwnerRow).apartment_id : undefined, code: isOwner ? (item as MergedOwnerRow).code : undefined })} className="text-xs text-accent hover:underline">{stock.setCost}</button>
                                : '—'}
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <GuestPriceCell
                              itemId={item.item_id}
                              guestPrice={itemRow.guest_price}
                              onSave={handleGuestPriceSave}
                              saveLabel={stock.save}
                              cancelLabel={stock.cancel}
                              invalidPriceLabel={stock.invalidPrice}
                              formatValue={formatGuestPriceDisplay}
                            />
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap text-sm text-ink">
                            {formatPct(itemRow.markup_pct)}
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap text-sm text-ink">
                            {formatPct(itemRow.margin_pct)}
                          </td>
                          <td className="px-2.5 py-2.5 border-b border-line whitespace-nowrap text-sm text-ink">
                            {itemRow.stock_value != null ? n(formatEGP(itemRow.stock_value)) : '—'}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={7} className="px-2.5 py-3 border-b border-line bg-app">
                              <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{stock.history}</div>
                              {movesLoading && moves.length === 0 ? (
                                <div className="text-sm text-muted">{t.app.loading}</div>
                              ) : moves.length === 0 ? (
                                <div className="text-sm text-muted">{stock.noHistory}</div>
                              ) : (
                                <div className="space-y-2">
                                  {moves.map((m) => {
                                    const sourceTypes = stock.sourceTypes
                                    const sourceLabel = sourceTypes[m.source_type as keyof typeof sourceTypes] ?? m.source_type
                                    return (
                                      <div key={m.id} className="text-xs border-b border-line last:border-0 pb-2 last:pb-0">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <span className="text-ink font-medium">{sourceLabel}</span>
                                            <span className="text-muted block">{n(formatDateTime(m.moved_at))}</span>
                                            <span className="text-muted block">{ownerLocLabel(m.from_location)} → {ownerLocLabel(m.to_location)}</span>
                                            {m.owner_code && (
                                              <span className="inline-flex items-center gap-1 mt-0.5">
                                                <OwnerBadge />
                                                <span className="text-muted">{m.owner_code}</span>
                                              </span>
                                            )}
                                            {m.author && <span className="text-muted block">{stock.author}: {m.author}</span>}
                                            {m.note && <span className="text-muted block">{m.note}</span>}
                                          </div>
                                          <span className="text-muted shrink-0">{n(formatQty(m.qty, itemRow))}</span>
                                        </div>
                                      </div>
                                    )
                                  })}
                                  {hasMoreMoves && (
                                    <button onClick={() => loadMoves(item.item_id, movesOffset, true)} disabled={movesLoading} className="text-xs text-accent font-medium disabled:opacity-50">
                                      {movesLoading ? t.app.loading : stock.loadMore}
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden bg-surface border border-line rounded-xl divide-y divide-line">
              {group.items.map((item) => {
                const itemRow = item as MergedStockRow
                const expanded = !isOwner && !selectionMode && expandedId === item.item_id
                return (
                  <div key={`${item.item_id}-${isOwner ? (item as MergedOwnerRow).apartment_id : ''}`} className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      {selectionMode && <div className="pt-1 -ml-1">{renderSelectBox(itemRow)}</div>}
                      <div className="flex-1 min-w-0">
                    <div
                      onClick={() => (selectionMode ? toggleRow(itemRow) : !isOwner && toggleExpand(item.item_id))}
                      className={selectionMode || !isOwner ? 'cursor-pointer' : ''}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="text-sm text-ink font-medium">{cat.itemName(itemRow.name)}</span>
                        <span className={`text-sm shrink-0 ${itemRow.below_min ? 'text-bad' : 'text-ink'}`}>
                          {n(formatQty(itemRow.qty, itemRow))}
                        </span>
                      </div>
                      {!isOwner && itemRow.min_stock != null && (
                        <div className="mb-2">
                          <span className="text-muted text-xs">/ {n(formatQty(itemRow.min_stock, itemRow))}</span>
                          <div className="mt-1">
                            <ProgressBar value={Math.min((itemRow.qty / itemRow.min_stock) * 100, 100)} color={itemRow.below_min ? 'var(--bad)' : 'var(--ok)'} />
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <div className="flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
                          <span className="text-muted">{stock.avgCost}</span>
                          <span className="text-ink">
                            {itemRow.avg_cost != null
                              ? n(formatEGP(itemRow.avg_cost))
                              : itemRow.qty > 0
                                ? <button type="button" onClick={() => setCostTarget({ itemId: item.item_id, itemName: cat.itemName(itemRow.name), apartmentId: isOwner ? (item as MergedOwnerRow).apartment_id : undefined, code: isOwner ? (item as MergedOwnerRow).code : undefined })} className="text-xs text-accent hover:underline">{stock.setCost}</button>
                                : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted">{stock.markup}</span>
                          <span className="text-ink">{formatPct(itemRow.markup_pct)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted">{stock.margin}</span>
                          <span className="text-ink">{formatPct(itemRow.margin_pct)}</span>
                        </div>
                        <div className="flex justify-between items-center col-span-2" onClick={(e) => e.stopPropagation()}>
                          <span className="text-muted">{stock.guestPrice}</span>
                          <GuestPriceCell
                            itemId={item.item_id}
                            guestPrice={itemRow.guest_price}
                            onSave={handleGuestPriceSave}
                            saveLabel={stock.save}
                            cancelLabel={stock.cancel}
                            invalidPriceLabel={stock.invalidPrice}
                            formatValue={formatGuestPriceDisplay}
                          />
                        </div>
                        <div className="flex justify-between col-span-2">
                          <span className="text-muted">{stock.stockValue}</span>
                          <span className="text-ink">{itemRow.stock_value != null ? n(formatEGP(itemRow.stock_value)) : '—'}</span>
                        </div>
                      </div>
                    </div>
                      </div>
                    </div>
                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-line">
                        <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{stock.history}</div>
                        {movesLoading && moves.length === 0 ? (
                          <div className="text-sm text-muted">{t.app.loading}</div>
                        ) : moves.length === 0 ? (
                          <div className="text-sm text-muted">{stock.noHistory}</div>
                        ) : (
                          <div className="space-y-2">
                            {moves.map((m) => {
                              const sourceTypes = stock.sourceTypes
                              const sourceLabel = sourceTypes[m.source_type as keyof typeof sourceTypes] ?? m.source_type
                              return (
                                <div key={m.id} className="text-xs border-b border-line last:border-0 pb-2 last:pb-0">
                                  <span className="text-ink font-medium">{sourceLabel}</span>
                                  <span className="text-muted block">{n(formatDateTime(m.moved_at))}</span>
                                  <span className="text-muted block">{ownerLocLabel(m.from_location)} → {ownerLocLabel(m.to_location)}</span>
                                  {m.note && <span className="text-muted block">{m.note}</span>}
                                </div>
                              )
                            })}
                            {hasMoreMoves && (
                              <button onClick={() => loadMoves(item.item_id, movesOffset, true)} disabled={movesLoading} className="text-xs text-accent font-medium disabled:opacity-50">
                                {movesLoading ? t.app.loading : stock.loadMore}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="bg-surface border border-line rounded-xl px-4 py-6 text-center text-muted text-sm">
            {isOwner ? stock.ownerEmpty : t.common.noResults}
          </div>
        )}
      </div>

      {selectionMode && (
        <TransferActionBar
          count={selection.length}
          canContinue={selection.length > 0}
          onSelectEligible={selectEligibleVisible}
          onContinue={() => setTransferOpen(true)}
          onCancel={toggleSelectionMode}
        />
      )}
      {transferOpen && selection.length > 0 && (
        <TransferModal
          direction={transferDirection}
          selection={selection}
          ownerCode={selectedOwnerCode}
          onClose={() => setTransferOpen(false)}
          onDone={handleTransferDone}
        />
      )}
      {costTarget && (
        <SetCostModal
          target={costTarget}
          scope={scope}
          labels={{
            ...costModalLabels,
            scopeLabel: costTarget.code != null
              ? t.admin.stock.costModalOwner.replace('{{code}}', costTarget.code)
              : t.admin.stock.costModalCompany,
          }}
          onClose={() => setCostTarget(null)}
          onApplied={handleCostApplied}
        />
      )}
    </>
  )
}
