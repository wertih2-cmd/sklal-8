import { useCallback, useEffect, useState } from 'react'
import type { Apartment, AptType } from '@/lib/database.types'
import { useI18n } from '@/i18n'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NormImportModal } from '@/modules/admin/NormImportModal'
import { toast, errorMessage } from '@/lib/toast'
import { useLiveRefresh } from '@/lib/realtime'
import { fetchApartmentsAdmin } from '@/modules/admin/api'
import {
  clearApartmentNorms, fetchApartmentNormCount, loadApartmentNormsForClear, makeApartmentNormsIndividual, replaceApartmentNormsFrom, resetApartmentNormsToType,
} from '@/modules/admin/norms'
import { normMode } from '@/modules/admin/aptNormsModel'
import { buildNormsTable, effectiveRules } from '@/modules/admin/normImport'
import { catalogRows, fileLabels, loadImportCatalog, saveTable } from '@/modules/admin/normImportFiles'

type Pending = { kind: 'make' } | { kind: 'copy'; sourceId: number } | { kind: 'back' } | { kind: 'clear' }

const btn = 'well rounded-xl px-3 py-2 text-xs font-medium text-accent min-h-[44px] disabled:opacity-60'

/**
 * Switch of an apartment between the template of its type and norms of its own.
 * Everything downstream (cleanings, supervisor and QR apps, reports) reads the effective norms,
 * so a change here is picked up there without further work.
 */
export function ApartmentNormMode({ apartment, typeLabels, disabled = false }: {
  apartment: Pick<Apartment, 'id' | 'type'> & { code?: string }
  typeLabels: Record<AptType, string>
  /** True while the type of the apartment is being changed: the tools work on the saved type. */
  disabled?: boolean
}) {
  const { t, n } = useI18n()
  const a = t.admin.aptNorms
  const ni = t.admin.normImport
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [chooser, setChooser] = useState<'make' | 'copy' | null>(null)
  const [source, setSource] = useState<'template' | 'apartment'>('template')
  const [others, setOthers] = useState<Apartment[] | null>(null)
  const [srcId, setSrcId] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(() => {
    fetchApartmentNormCount(apartment.id).then(setCount).catch((e) => toast(errorMessage(e), 'error'))
  }, [apartment.id])

  useEffect(() => { load() }, [load])
  useLiveRefresh(['norm_rules'], load)

  const openChooser = (kind: 'make' | 'copy') => {
    setChooser(kind)
    setSource(kind === 'copy' ? 'apartment' : 'template')
    if (!others) {
      fetchApartmentsAdmin()
        .then((list) => setOthers(list.filter((x) => x.id !== apartment.id)))
        .catch((e) => toast(errorMessage(e), 'error'))
    }
  }

  const needsSource = chooser === 'copy' || source === 'apartment'
  const canContinue = chooser != null && (!needsSource || srcId !== '')

  const proceed = () => {
    if (!canContinue) return
    setPending(needsSource ? { kind: 'copy', sourceId: Number(srcId) } : { kind: 'make' })
  }

  const run = async () => {
    const p = pending
    if (!p) return
    setPending(null)
    setBusy(true)
    try {
      if (p.kind === 'make') {
        const added = await makeApartmentNormsIndividual(apartment.id)
        toast(added === 0 && (count ?? 0) === 0 ? a.emptyTemplate : a.doneMake, added === 0 && (count ?? 0) === 0 ? 'info' : 'success')
      } else if (p.kind === 'copy') {
        await replaceApartmentNormsFrom(p.sourceId, apartment.id)
        toast(a.doneCopy, 'success')
      } else if (p.kind === 'back') {
        await resetApartmentNormsToType(apartment.id)
        toast(a.doneBack, 'success')
      } else {
        // The file with the current norms is saved first; if that fails, nothing is cleared.
        const { own, template } = await loadApartmentNormsForClear(apartment.id, apartment.type)
        const had = effectiveRules(own, template).filter((r) => r.qty !== 0 || r.apartment_id != null)
        if (had.length === 0) {
          toast(ni.clearNothing, 'info')
        } else {
          const cat = await loadImportCatalog()
          const code = cat.apartments.find((x) => x.id === apartment.id)?.code ?? String(apartment.id)
          const asApartment = effectiveRules(own, template).map((r) => ({ ...r, apt_type: null, apartment_id: apartment.id }))
          saveTable(`norms-backup-${code.replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`, buildNormsTable(asApartment, catalogRows(cat), new Map([[apartment.id, code]]), fileLabels(t)))
          await clearApartmentNorms(apartment.id, own, template)
          toast(ni.clearDone, 'success')
        }
      }
      setChooser(null)
      setSrcId('')
      load()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const mode = count == null ? null : normMode(count)
  const off = disabled || busy || mode == null

  return (
    <div className="bg-app rounded-xl px-3 py-3 space-y-2" data-testid="apt-norm-mode">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ink">{a.title}</span>
        {mode && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${mode === 'individual' ? 'bg-accent text-on-accent' : 'tile text-muted'}`}>
            {mode === 'individual' ? a.modeIndividual : a.modeType}
          </span>
        )}
      </div>
      {mode && (
        <p className="text-xs text-muted">
          {mode === 'individual'
            ? `${a.nowIndividual} (${n(String(count))} ${a.positions})`
            : `${a.nowType}: ${typeLabels[apartment.type]}`}
        </p>
      )}
      {disabled && <p className="text-xs text-warn">{a.typeFirst}</p>}

      {chooser == null && mode === 'type' && (
        <button type="button" className={btn} disabled={off} onClick={() => openChooser('make')}>{a.makeIndividual}</button>
      )}
      {chooser == null && mode === 'individual' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={off} onClick={() => openChooser('copy')}>{a.replaceFrom}</button>
          <button type="button" className={btn} disabled={off} onClick={() => setPending({ kind: 'back' })}>{a.backToType}</button>
        </div>
      )}

      {chooser == null && mode != null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={off} onClick={() => setImportOpen(true)} data-testid="apt-norms-import">{ni.importApartmentButton}</button>
          <button type="button" className={`${btn} !text-bad`} disabled={off} onClick={() => setPending({ kind: 'clear' })} data-testid="apt-norms-clear">{ni.clearButton}</button>
        </div>
      )}

      {chooser != null && (
        <div className="space-y-2">
          {chooser === 'make' && (
            <>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name={`norm-src-${apartment.id}`} checked={source === 'template'} onChange={() => setSource('template')} className="accent-[var(--accent)]" />
                {a.sourceTemplate}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name={`norm-src-${apartment.id}`} checked={source === 'apartment'} onChange={() => setSource('apartment')} className="accent-[var(--accent)]" />
                {a.sourceApartment}
              </label>
            </>
          )}
          {needsSource && (
            <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className="w-full well rounded-xl px-3 py-2.5 text-sm focus:outline-none">
              <option value="">{a.pickApartment}</option>
              {(others ?? []).map((o) => <option key={o.id} value={String(o.id)}>{`${o.code} · ${typeLabels[o.type]}`}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button type="button" className={btn} disabled={!canContinue || off} onClick={proceed}>{a.continue}</button>
            <button type="button" className={btn} disabled={busy} onClick={() => { setChooser(null); setSrcId('') }}>{a.cancel}</button>
          </div>
        </div>
      )}

      <NormImportModal
        open={importOpen}
        apartment={{ id: apartment.id, code: apartment.code, type: apartment.type }}
        onClose={() => setImportOpen(false)}
        onDone={load}
      />
      <ConfirmDialog
        open={pending?.kind === 'make'}
        title={a.confirmMakeTitle}
        message={a.confirmMakeBody}
        tone="warn"
        onConfirm={() => void run()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === 'copy'}
        title={a.confirmCopyTitle}
        message={a.confirmCopyBody}
        tone="warn"
        onConfirm={() => void run()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === 'clear'}
        title={ni.clearTitle}
        message={ni.clearBody}
        tone="bad"
        onConfirm={() => void run()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === 'back'}
        title={a.confirmBackTitle}
        message={a.confirmBackBody}
        tone="warn"
        onConfirm={() => void run()}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}
