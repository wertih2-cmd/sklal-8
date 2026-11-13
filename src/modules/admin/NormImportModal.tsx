import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { toast, errorMessage } from '@/lib/toast'
import { applyImportPlan, fetchAllNormRules } from '@/modules/admin/norms'
import {
  buildNormsTable, buildTemplateTable, decodeCsvBytes, parseCsv, parseNormRows, planImport,
  type ExistingRule, type ImportMode, type ImportIssue, type ParsedImport,
} from '@/modules/admin/normImport'
import { catalogRows, fileLabels, importContext, loadImportCatalog, saveTable, type ImportCatalog } from '@/modules/admin/normImportFiles'

const MAX_ISSUES_SHOWN = 40
const MAX_FILE_BYTES = 5 * 1024 * 1024

const btn = 'well rounded-xl px-3 py-2 text-xs font-medium text-accent min-h-[44px] flex items-center gap-1.5 disabled:opacity-60'

/** Import of norms (by apartment type and by apartment) from a CSV file, with a check before anything is written. */
export function NormImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, n } = useI18n()
  const a = t.admin.normImport
  const fileRef = useRef<HTMLInputElement>(null)
  const [catalog, setCatalog] = useState<ImportCatalog | null>(null)
  const [existing, setExisting] = useState<ExistingRule[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [skipErrors, setSkipErrors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoadFailed(false)
    Promise.all([loadImportCatalog(), fetchAllNormRules()])
      .then(([cat, rules]) => { setCatalog(cat); setExisting(rules) })
      .catch((e) => { setLoadFailed(true); toast(errorMessage(e), 'error') })
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  const labels = useMemo(() => fileLabels(t), [t])
  const plan = useMemo(() => (parsed && parsed.rows.length > 0 ? planImport(parsed.rows, existing, mode) : null), [parsed, existing, mode])
  const nothingToDo = plan != null && plan.inserts.length + plan.updates.length + plan.deletes.length === 0
  const blocked = parsed != null && parsed.issues.length > 0 && !skipErrors
  const canApply = !busy && catalog != null && plan != null && !nothingToDo && !blocked

  const downloadTemplate = () => {
    if (!catalog) return
    const first = catalog.items.find((i) => i.active) ?? catalog.items[0]
    const cats = new Map(catalog.categories.map((c) => [c.id, c.name]))
    saveTable('norms-template.csv', buildTemplateTable(labels, {
      apartment: catalog.apartments[0]?.code ?? '',
      item: first?.name ?? '',
      category: first ? cats.get(first.category_id) ?? '' : '',
      unit: first?.base_unit ?? '',
    }))
  }

  const downloadCurrent = () => {
    if (!catalog) return
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
      setParsed(parseNormRows(parseCsv(text), importContext(catalog)))
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
      item_inactive: a.issueInactive, bad_qty: a.issueBadQty, duplicate: a.issueDuplicate,
    }
    return `${a.line} ${n(String(i.line))}: ${messages[i.code]}${i.value ? ` «${i.value}»` : ''}`
  }

  const missingText = (m: ParsedImport['missing'][number]): string =>
    ({ item: a.missingItem, qty: a.missingQty, normType: a.missingNormType, scope: a.missingScope })[m]

  return (
    <Modal open={open} title={a.title} onClose={() => { if (!busy) onClose() }} size="lg" closeOnBackdrop={false}>
      <div className="space-y-3">
        <p className="text-xs text-muted bg-app rounded-xl px-3 py-2.5">{a.hint}</p>
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
                  {` · ${a.scopeTypes}: ${n(String(plan.types.length))}, ${a.scopeApartments}: ${n(String(plan.apartments.length))}`}
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
                <span>{a.modeReplace}<span className="block text-xs text-muted">{a.modeReplaceNote}</span></span>
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
