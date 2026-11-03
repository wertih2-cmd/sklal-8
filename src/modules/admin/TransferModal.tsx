import { useEffect, useMemo, useState } from 'react'
import { fetchApartmentsAdmin, transferCompanyOwner } from '@/modules/admin/api'
import type { Apartment, TransferDirection } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { formatQty } from '@/lib/format'
import { toast, errorMessage } from '@/lib/toast'
import { useCatalogName } from '@/modules/core/useCatalogName'
import { validateLines, type TransferSelection } from './transferSelection'

type ValidationKey = 'transferErrEmpty' | 'transferErrQty' | 'transferErrExceeds'

const VALIDATION_KEY: Record<'empty' | 'qty' | 'exceeds', ValidationKey> = {
  empty: 'transferErrEmpty',
  qty: 'transferErrQty',
  exceeds: 'transferErrExceeds',
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

  useEffect(() => {
    if (!isToOwner) return
    let cancelled = false
    fetchApartmentsAdmin()
      .then((list) => { if (!cancelled) setApartments(list.filter((a) => a.is_owner)) })
      .catch((e) => { if (!cancelled) setApartmentsError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [isToOwner])

  const entries = useMemo(
    () => selection.map((e) => ({ row: e.row, qty: parseQty(qtyTexts[e.row.key] ?? '') })),
    [selection, qtyTexts],
  )
  const validation = useMemo(() => validateLines(entries), [entries])

  const apartmentId = isToOwner ? pickedApartmentId : selection[0]?.row.apartment_id ?? null
  const noOwnerApartments = isToOwner && apartments !== null && apartments.length === 0
  const apartmentReady = isToOwner ? apartments !== null && apartmentsError === null : apartmentId != null
  const canConfirm = !saving && validation.ok && apartmentReady && apartmentId != null && !noOwnerApartments

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
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={closeIfIdle}
      onKeyDown={(e) => { if (e.key === 'Escape') closeIfIdle() }}
    >
      <div
        className="bg-surface border border-line rounded-xl p-4 mx-4 max-w-md w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-ink mb-3">{stock.transferTitle}</div>

        <div className="space-y-2 mb-3">
          {selection.map((entry) => {
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
                  className="w-24 min-h-[44px] bg-surface rounded-lg px-3 py-2 text-sm text-right border border-line focus:border-accent focus:outline-none disabled:opacity-50"
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
            className="min-h-[44px] px-4 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-50"
          >
            {stock.confirmCount.replace('{{count}}', n(String(selection.length)))}
          </button>
        </div>
      </div>
    </div>
  )
}
