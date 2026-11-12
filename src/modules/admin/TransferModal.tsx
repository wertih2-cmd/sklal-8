import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { fetchApartmentsAdmin, fetchItems, fetchTrackedUnits, transferCompanyOwner } from '@/modules/admin/api'
import type { Apartment, ItemUnit, TransferDirection } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatQty } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { validateLines, type TransferSelection } from './transferSelection'
import { candidateUnits, toggleUnit, type UnitLocation, type UnitSource } from './unitSelection'

type ValidationKey = 'transferErrEmpty' | 'transferErrQty' | 'transferErrExceeds' | 'transferErrUnits'

const VALIDATION_KEY: Record<'empty' | 'qty' | 'exceeds' | 'units', ValidationKey> = {
  empty: 'transferErrEmpty',
  qty: 'transferErrQty',
  exceeds: 'transferErrExceeds',
  units: 'transferErrUnits',
}

function parseQty(text: string): number {
  return Number(text.replace(',', '.').trim())
}

export function TransferModal({
  direction, selection, ownerCode, onClose, onDone,
}: {
  direction: TransferDirection
  selection: TransferSelection
  ownerCode: string | null
  onClose: () => void
  onDone: () => void
}) {
  const { t, n } = useI18n()
  const cat = useCatalogName()
  const stock = t.admin.stock
  const isToOwner = direction === 'to_owner'

  const [qtyTexts, setQtyTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(selection.map((e) => [e.row.key, String(e.qty)])),
  )
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [apartments, setApartments] = useState<Apartment[] | null>(null)
  const [apartmentsError, setApartmentsError] = useState<string | null>(null)
  const [pickedApartmentId, setPickedApartmentId] = useState<number | null>(null)
  const [trackedIds, setTrackedIds] = useState<Set<number>>(new Set())
  const [units, setUnits] = useState<ItemUnit[]>([])
  const [unitLocs, setUnitLocs] = useState<Map<number, UnitLocation>>(new Map())
  const [unitsReady, setUnitsReady] = useState(false)
  const [unitPick, setUnitPick] = useState<Record<string, string[]>>({})

  const itemIdsKey = selection.map((e) => e.row.item_id).join(',')
  useEffect(() => {
    let cancelled = false
    const ids = new Set(itemIdsKey.split(',').filter(Boolean).map(Number))
    fetchItems()
      .then(async (items) => {
        const tracked = new Set(items.filter((i) => i.track_units && ids.has(i.id)).map((i) => i.id))
        const loaded = tracked.size > 0 ? await fetchTrackedUnits([...tracked]) : { units: [], locations: [] }
        if (cancelled) return
        setTrackedIds(tracked)
        setUnits(loaded.units)
        setUnitLocs(new Map(loaded.locations.map((l): [number, UnitLocation] => [l.id, l])))
        setUnitsReady(true)
      })
      .catch((e) => { if (!cancelled) toast(errorMessage(e), 'error') })
    return () => { cancelled = true }
  }, [itemIdsKey])

  useEffect(() => {
    if (!isToOwner) return
    let cancelled = false
    fetchApartmentsAdmin()
      .then((list) => { if (!cancelled) setApartments(list.filter((a) => a.is_owner)) })
      .catch((e) => { if (!cancelled) setApartmentsError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [isToOwner])

  const apartmentId = isToOwner ? pickedApartmentId : selection[0]?.row.apartment_id ?? null
  const unitSrc = useMemo<UnitSource | null>(
    () => (isToOwner ? { kind: 'warehouse' } : apartmentId != null ? { kind: 'owner_stock', apartmentId } : null),
    [isToOwner, apartmentId],
  )
  const entries = useMemo<TransferSelection>(
    () => selection.map((e) => {
      if (trackedIds.has(e.row.item_id)) {
        const ok = new Set(candidateUnits(units, unitLocs, e.row.item_id, unitSrc).map((u) => u.id))
        const unitIds = (unitPick[e.row.key] ?? []).filter((id) => ok.has(id))
        return { row: e.row, qty: unitIds.length, unitIds }
      }
      return { row: e.row, qty: parseQty(qtyTexts[e.row.key] ?? '') }
    }),
    [selection, qtyTexts, trackedIds, units, unitLocs, unitSrc, unitPick],
  )
  const validation = useMemo(() => validateLines(entries), [entries])

  const noOwnerApartments = isToOwner && apartments !== null && apartments.length === 0
  const apartmentReady = isToOwner ? apartments !== null && apartmentsError === null : apartmentId != null
  const canConfirm = !saving && unitsReady && validation.ok && apartmentReady && apartmentId != null && !noOwnerApartments

  const handleConfirm = async () => {
    if (!canConfirm || !validation.ok || apartmentId == null) return
    setSaving(true)
    try {
      await transferCompanyOwner(direction, apartmentId, validation.lines, note.trim() || null)
      toast(stock.transferDone, 'success')
      onDone()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const closeIfIdle = () => { if (!saving) onClose() }

  return (
    <Modal open title={stock.transferTitle} onClose={closeIfIdle} size="md">

        <div className="space-y-2 mb-3">
          {selection.map((entry) => {
            if (trackedIds.has(entry.row.item_id)) {
              const cands = candidateUnits(units, unitLocs, entry.row.item_id, unitSrc)
              const picked = entries.find((e) => e.row.key === entry.row.key)?.unitIds ?? []
              return (
                <div key={entry.row.key} className="bg-app rounded-lg px-3 py-2">
                  <div className="text-sm text-ink truncate">{cat.itemName(entry.row.name)}</div>
                  <div className="text-xs text-muted mb-1.5">{t.admin.move.unitsBadge}</div>
                  {cands.length === 0 ? (
                    <p className="text-xs text-bad">{t.admin.move.unitsEmpty}</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-ink">
                          {t.admin.move.unitsPick}: {n(String(picked.length))} / {n(String(cands.length))}
                        </span>
                        <span className="flex gap-3">
                          <button type="button" disabled={saving} onClick={() => setUnitPick((prev) => ({ ...prev, [entry.row.key]: cands.map((u) => u.id) }))} className="text-xs text-accent">
                            {t.admin.move.unitsAll}
                          </button>
                          <button type="button" disabled={saving} onClick={() => setUnitPick((prev) => ({ ...prev, [entry.row.key]: [] }))} className="text-xs text-muted">
                            {t.admin.move.unitsNone}
                          </button>
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto well rounded-lg border border-line">
                        {cands.map((u) => (
                          <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm text-ink border-b border-line last:border-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={picked.includes(u.id)}
                              disabled={saving}
                              onChange={() => setUnitPick((prev) => ({ ...prev, [entry.row.key]: toggleUnit(picked, u.id) }))}
                              className="w-4 h-4 rounded accent-accent"
                            />
                            <span className="truncate">{u.code}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            }
            const qtyText = qtyTexts[entry.row.key] ?? ''
            return (
              <div key={entry.row.key} className="flex items-center justify-between gap-3 bg-app rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm text-ink truncate">{cat.itemName(entry.row.name)}</div>
                  <div className="text-xs text-muted">
                    {stock.maxQty.replace('{{max}}', n(formatQty(entry.row.qty, entry.row.unit)))}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${stock.quantity}: ${cat.itemName(entry.row.name)}`}
                  value={qtyText}
                  disabled={saving}
                  onChange={(e) => setQtyTexts((prev) => ({ ...prev, [entry.row.key]: e.target.value }))}
                  className="w-24 min-h-[44px] well rounded-lg px-3 py-2 text-sm text-end border border-line focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </div>
            )
          })}
        </div>

        {!validation.ok && (
          <p className="text-xs text-bad mb-3">{stock[VALIDATION_KEY[validation.error]]}</p>
        )}

        <div className="mb-3">
          <div className="text-xs text-muted mb-1">{stock.ownerApartment}</div>
          {isToOwner ? (
            apartmentsError ? (
              <p className="text-xs text-bad">{apartmentsError}</p>
            ) : apartments === null ? (
              <div className="text-sm text-muted">{t.app.loading}</div>
            ) : noOwnerApartments ? (
              <p className="text-xs text-bad">{stock.noOwnerApartments}</p>
            ) : (
              <select
                value={pickedApartmentId ?? ''}
                onChange={(e) => setPickedApartmentId(e.target.value ? Number(e.target.value) : null)}
                disabled={saving}
                className="w-full min-h-[44px] bg-app rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="" disabled>{stock.ownerApartment}</option>
                {apartments.map((a) => (
                  <option key={a.id} value={a.id}>{a.code}</option>
                ))}
              </select>
            )
          ) : (
            <div className="text-sm text-ink">{ownerCode ?? '—'}</div>
          )}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
          placeholder={stock.transferNote}
          className="w-full min-h-[44px] bg-app rounded-lg px-3 py-2 text-sm border border-line focus:border-accent focus:outline-none mb-4 disabled:opacity-50"
        />

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={closeIfIdle}
            disabled={saving}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-surface border border-line text-muted disabled:opacity-50"
          >
            {stock.cancel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-accent text-on-accent disabled:opacity-50"
          >
            {stock.confirmCount.replace('{{count}}', n(String(selection.length)))}
          </button>
        </div>
    </Modal>
  )
}
