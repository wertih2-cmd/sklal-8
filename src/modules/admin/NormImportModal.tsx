import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast, errorMessage } from '@/lib/toast'
import type { AptType } from '@/lib/database.types'
import { applyImportPlan, fetchAllNormRules, loadApartmentNormsForClear } from '@/modules/admin/norms'
import {
  buildApartmentTemplateTable, buildNormsTable, buildTemplateTable, decodeCsvBytes, effectiveRules, parseCsv, parseNormRows, planImport,
  type ExistingRule, type ImportMode, type ImportIssue, type ParsedImport,
} from '@/modules/admin/normImport'
import { catalogRows, fileLabels, importContext, loadImportCatalog, saveTable, type ImportCatalog } from '@/modules/admin/normImportFiles'

const MAX_ISSUES_SHOWN = 40
const MAX_FILE_BYTES = 5 * 1024 * 1024

const btn = 'well rounded-xl px-3 py-2 text-xs font-medium text-accent min-h-[44px] flex items-center gap-1.5 disabled:opacity-60'

/**
 * Import of norms (by apartment type and by apartment) from a CSV file, with a check before anything is written.
 * With `apartment` the file belongs to that one apartment: rows without an apartment go to it, rows for anything else are issues.
 */
export function NormImportModal({ open, onClose, onDone, apartment }: {
  open: boolean
  onClose: () => void
  onDone: () => void
  apartment?: { id: number; code?: string; type: AptType }
}) {
  const { t, n } = useI18n()
  const a = t.admin.normImport
  const fileRef = useRef<HTMLInputElement>(null)
  const [catalog, setCatalog] = useState<ImportCatalog | null>(null)
  const [existing, setExisting] = useState<ExistingRule[]>([])
  const [template, setTemplate] = useState<ExistingRule[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [skipErrors, setSkipErrors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const apartmentId = apartment?.id
  const apartmentType = apartment?.type

  const load = useCallback(() => {
    setLoadFailed(false)
    // For one apartment only its own rules matter for the plan; the template is read to save the norms it has now.
    const rules = apartmentId != null && apartmentType != null
      ? loadApartmentNormsForClear(apartmentId, apartmentType).then(({ own, template: tpl }) => ({ own, tpl }))
      : fetchAllNormRules().then((all) => ({ own: all, tpl: [] as ExistingRule[] }))
    Promise.all([loadImportCatalog(), rules])
      .then(([cat, r]) => { setCatalog(cat); setExisting(r.own); setTemplate(r.tpl) })
      .catch((e) => { setLoadFailed(true); toast(errorMessage(e), 'error') })
  }, [apartmentId, apartmentType])

  useEffect(() => { if (open) load() }, [open, load])

  const labels = useMemo(() => fileLabels(t), [t])
  const plan = useMemo(() => (parsed && parsed.rows.length > 0 ? planImport(parsed.rows, existing, mode) : null), [parsed, existing, mode])
  const nothingToDo = plan != null && plan.inserts.length + plan.updates.length + plan.deletes.length === 0
  const blocked = parsed != null && parsed.issues.length > 0 && !skipErrors
  const canApply = !busy && catalog != null && plan != null && !nothingToDo && !blocked

  const apartmentCode = apartment && catalog
    ? catalog.apartments.find((x) => x.id === apartment.id)?.code ?? apartment.code ?? String(apartment.id)
    : ''
  const fileSuffix = apartmentCode.replace(/[^\p{L}\p{N}]+/gu, '-')

  const downloadTemplate = () => {
    if (!catalog) return
    const first = catalog.items.find((i) => i.active) ?? catalog.items[0]
    const cats = new Map(catalog.categories.map((c) => [c.id, c.name]))
    const sample = {
      apartment: apartment ? apartmentCode : catalog.apartments[0]?.code ?? '',
      item: first?.name ?? '',
      category: first ? cats.get(first.category_id) ?? '' : '',
      unit: first?.base_unit ?? '',
    }
    saveTable('norms-template.csv', apartment ? buildApartmentTemplateTable(labels, sample) : buildTemplateTable(labels, sample))
  }

  const downloadCurrent = () => {
    if (!catalog) return
    if (apartment) {
      // The norms the apartment has now: its own rules over the template of its type.
      const asApartment = effectiveRules(existing, template).map((r) => ({ ...r, apt_type: null, apartment_id: apartment.id }))
      saveTable(`norms-${fileSuffix}.csv`, buildNormsTable(asApartment, catalogRows(catalog), new Map([[apartment.id, apartmentCode]]), labels))
      return
    }
    const codes = new Map(catalog.apartments.map((x) => [x.id, x.code]))
    saveTable('norms-current.csv', buildNormsTable(existing, catalogRows(catalog), codes, labels))
  }

  const onFile = async (file: File | undefined) => {
    if (!file || !catalog) return
    setParsed(null)
    setSkipErrors(false)
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) { toast(a.fileTooBig, 'error'); return }
    try {
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
      setParsed(parseNormRows(parseCsv(text), importContext(catalog), apartment ? { apartmentId: apartment.id } : undefined))
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const apply = async () => {
    if (!plan) return
    setConfirming(false)
    setBusy(true)
    try {
      await applyImportPlan(plan)
      toast(`${a.done}: ${a.added} ${n(String(plan.inserts.length))}, ${a.updated} ${n(String(plan.updates.length))}, ${a.deleted} ${n(String(plan.deletes.length))}`, 'success')
      setParsed(null)
      setFileName('')
      if (fileRef.current) fileRef.current.value = ''
      load()
      onDone()
    } catch (e) {
      toast(`${errorMessage(e)} ${a.runAgain}`, 'error')
      load()
    } finally {
      setBusy(false)
    }
  }

  const issueText = (i: ImportIssue): string => {
    const messages: Record<ImportIssue['code'], string> = {
      no_scope: a.issueNoScope, both_scopes: a.issueBothScopes, unknown_type: a.issueUnknownType,
      unknown_apartment: a.issueUnknownApartment, ambiguous_apartment: a.issueAmbiguousApartment,
      unknown_norm_type: a.issueUnknownNormType, unknown_category: a.issueUnknownCategory, unknown_item: a.issueUnknownItem,
      ambiguous_item: a.issueAmbiguousItem, item_category_mismatch: a.issueCategoryMismatch,
      item_inactive: a.issueInactive, bad_qty: a.issueBadQty, duplicate: a.issueDuplicate, other_scope: a.issueOtherScope,
    }
    return `${a.line} ${n(String(i.line))}: ${messages[i.code]}${i.value ? ` «${i.value}»` : ''}`
  }

  const missingText = (m: ParsedImport['missing'][number]): string =>
    ({ item: a.missingItem, qty: a.missingQty, normType: a.missingNormType, scope: a.missingScope })[m]

  return (
    <Modal open={open} title={apartment ? `${a.titleApartment}${apartmentCode ? `: ${apartmentCode}` : ''}` : a.title} onClose={() => { if (!busy) onClose() }} size="lg" closeOnBackdrop={false}>
      <div className="space-y-3">
        <p className="text-xs text-muted bg-app rounded-xl px-3 py-2.5">{apartment ? a.hintApartment : a.hint}</p>
        {loadFailed && <p className="text-bad text-sm">{a.loadFailed}</p>}

        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={!catalog} onClick={downloadTemplate}><Download className="w-4 h-4" />{a.downloadTemplate}</button>
          <button type="button" className={btn} disabled={!catalog} onClick={downloadCurrent}><Download className="w-4 h-4" />{a.downloadCurrent}</button>
        </div>

        <div className="bg-app rounded-xl px-3 py-3 space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <button type="button" className={btn} disabled={!catalog || busy} onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" />{a.chooseFile}
          </button>
          {fileName && <p className="text-xs text-muted break-all" dir="ltr">{fileName}</p>}
        </div>

        {parsed && parsed.missing.length > 0 && (
          <div className="bg-app rounded-xl px-3 py-3 space-y-1">
            <p className="text-sm text-bad">{a.missingColumns}</p>
            <ul className="list-disc ps-4 text-xs text-ink">{parsed.missing.map((m) => <li key={m}>{missingText(m)}</li>)}</ul>
          </div>
        )}

        {parsed && parsed.missing.length === 0 && (
          <div className="space-y-3" data-testid="norm-import-result">
            <div className="bg-app rounded-xl px-3 py-3 text-sm text-ink space-y-1">
              <p>{a.linesRead}: {n(String(parsed.lines))}; {a.rowsOk}: {n(String(parsed.rows.length))}; <span className={parsed.issues.length > 0 ? 'text-bad' : ''}>{a.issues}: {n(String(parsed.issues.length))}</span></p>
              {plan && (
                <p className="text-xs text-muted">
                  {a.willAdd}: {n(String(plan.inserts.length))}; {a.willUpdate}: {n(String(plan.updates.length))}; {a.unchanged}: {n(String(plan.unchanged))}
                  {mode === 'replace' ? `; ${a.willDelete}: ${n(String(plan.deletes.length))}` : ''}
                  {!apartment && ` · ${a.scopeTypes}: ${n(String(plan.types.length))}, ${a.scopeApartments}: ${n(String(plan.apartments.length))}`}
                </p>
              )}
            </div>

            {parsed.issues.length > 0 && (
              <div className="bg-app rounded-xl px-3 py-3 space-y-2">
                <ul className="text-xs text-ink space-y-1 max-h-48 overflow-y-auto">
                  {parsed.issues.slice(0, MAX_ISSUES_SHOWN).map((i, idx) => <li key={idx}>{issueText(i)}</li>)}
                </ul>
                {parsed.issues.length > MAX_ISSUES_SHOWN && <p className="text-xs text-muted">{a.moreIssues}: {n(String(parsed.issues.length - MAX_ISSUES_SHOWN))}</p>}
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} className="accent-[var(--accent)]" />
                  {a.skipErrors}
                </label>
              </div>
            )}

            <div className="bg-app rounded-xl px-3 py-3 space-y-2">
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="radio" name="norm-import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1 accent-[var(--accent)]" />
                <span>{a.modeMerge}</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="radio" name="norm-import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1 accent-[var(--accent)]" />
                <span>{apartment ? a.modeReplaceApartment : a.modeReplace}<span className="block text-xs text-muted">{apartment ? a.modeReplaceNoteApartment : a.modeReplaceNote}</span></span>
              </label>
            </div>

            {nothingToDo && <p className="text-sm text-muted">{a.nothingToDo}</p>}
            <button
              type="button"
              disabled={!canApply}
              onClick={() => setConfirming(true)}
              className="w-full bg-accent text-on-accent rounded-xl px-4 py-2.5 text-sm font-medium min-h-[44px] disabled:opacity-50"
            >
              {busy ? a.applying : a.apply}
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={a.confirmTitle}
        message={`${a.confirmBody} ${plan ? `${a.willAdd}: ${n(String(plan.inserts.length))}, ${a.willUpdate}: ${n(String(plan.updates.length))}, ${a.willDelete}: ${n(String(plan.deletes.length))}.` : ''}`}
        tone="warn"
        onConfirm={() => void apply()}
        onCancel={() => setConfirming(false)}
      />
    </Modal>
  )
}
