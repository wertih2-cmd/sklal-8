import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { friendlyMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { useAuth } from '@/modules/core/store'
import type { AptType } from '@/lib/database.types'
import type { TaskRole } from './tasksModel'
import { fetchChecklistItems, saveChecklist } from './checklistsApi'
import {
  APT_TYPES, areaOf, canEditTemplate, CHECKLIST_MAX_ITEMS, CHECKLIST_TEXT_MAX, draftFromItems, inspectionsPath, isTemplateChanged,
  moveItem, toSaveItems, validateTemplate, type ChecklistItem, type TemplateDraftItem, type TemplateError,
} from './checklistsModel'

/** One check list per apartment type. The manager and the admin edit; checks already made keep their own copy of the text. */
export function ChecklistTemplatesPage() {
  const { t, n } = useI18n()
  const p = t.inspections
  const { pathname } = useLocation()
  const role = useAuth((s) => s.profile?.role) as TaskRole | undefined
  const [saved, setSaved] = useState<ChecklistItem[]>([])
  const [drafts, setDrafts] = useState<Partial<Record<AptType, TemplateDraftItem[]>>>({})
  const [type, setType] = useState<AptType>('studio')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const items = await fetchChecklistItems()
      setSaved(items)
      setDrafts({})
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const savedOf = useCallback((x: AptType) => saved.filter((i) => i.apt_type === x), [saved])
  const draftOf = (x: AptType): TemplateDraftItem[] => drafts[x] ?? draftFromItems(savedOf(x))
  const changed = (x: AptType) => drafts[x] !== undefined && isTemplateChanged(savedOf(x), drafts[x]!)
  const current = draftOf(type)
  const problem: TemplateError | null = useMemo(() => validateTemplate(current), [current])

  const typeLabel: Record<AptType, string> = { studio: t.apartments.typeStudio, '1br': t.apartments.type1br, '2br': t.apartments.type2br }
  const errorText: Record<TemplateError, string> = { empty: p.errEmpty, long: p.errLong, tooMany: p.errTooMany }

  const update = (next: TemplateDraftItem[]) => setDrafts((prev) => ({ ...prev, [type]: next }))

  const save = async () => {
    if (problem) return
    setBusy(true)
    try {
      await saveChecklist(type, toSaveItems(current))
      toast(p.templateSaved, 'success')
      await load()
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!role) return null
  const editable = canEditTemplate(role)
  const iconBtn = 'w-11 h-11 rounded-xl well flex items-center justify-center text-muted disabled:opacity-40'

  return (
    <div className="px-4 py-4 max-w-3xl mx-auto pb-28">
      <NavLink to={inspectionsPath(areaOf(pathname))} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink min-h-[44px]">
        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />{p.title}
      </NavLink>
      <h1 className="text-lg font-semibold text-ink mb-1">{p.templateTitle}</h1>
      <p className="text-xs text-muted mb-4">{p.templateHint}</p>

      <div className="flex gap-2 mb-4 flex-wrap" role="tablist" aria-label={p.templateTitle}>
        {APT_TYPES.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={type === x} onClick={() => setType(x)}
            className={`rounded-xl px-4 min-h-[44px] text-sm ${type === x ? 'bg-accent-soft text-accent font-semibold' : 'well text-muted'}`}>
            {typeLabel[x]}{changed(x) ? ' •' : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted">{p.loading}</p>
      ) : failed ? (
        <div className="tile rounded-[20px] p-4">
          <p className="text-sm text-bad mb-2" role="alert">{p.loadFailed}</p>
          <button type="button" onClick={() => void load()} className="min-h-[44px] px-4 rounded-xl well text-sm text-ink">{p.retry}</button>
        </div>
      ) : (
        <>
          {current.length === 0 && <p className="text-sm text-muted mb-3">{p.noItems}</p>}
          <ol className="space-y-2">
            {current.map((it, i) => (
              <li key={it.key} className="tile rounded-2xl p-2 flex items-start gap-2">
                <span className="w-7 pt-3 text-center text-xs text-muted flex-none">{n(String(i + 1))}</span>
                <textarea
                  rows={2}
                  value={it.text}
                  disabled={!editable || busy}
                  maxLength={CHECKLIST_TEXT_MAX + 50}
                  placeholder={p.itemPlaceholder}
                  aria-label={`${p.item} ${n(String(i + 1))}`}
                  onChange={(e) => update(current.map((x) => (x.key === it.key ? { ...x, text: e.target.value } : x)))}
                  className="well flex-1 min-w-0 rounded-xl px-3 py-2 text-sm text-ink disabled:opacity-70"
                />
                {editable && (
                  <div className="flex flex-col gap-1 flex-none">
                    <div className="flex gap-1">
                      <button type="button" disabled={busy || i === 0} aria-label={p.moveUp} onClick={() => update(moveItem(current, i, -1))} className={iconBtn}><ArrowUp className="w-4 h-4" /></button>
                      <button type="button" disabled={busy || i === current.length - 1} aria-label={p.moveDown} onClick={() => update(moveItem(current, i, 1))} className={iconBtn}><ArrowDown className="w-4 h-4" /></button>
                    </div>
                    <button type="button" disabled={busy} aria-label={p.removeItem} onClick={() => update(current.filter((x) => x.key !== it.key))} className={`${iconBtn} hover:text-bad w-full`}><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </li>
            ))}
          </ol>

          {editable && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || current.length >= CHECKLIST_MAX_ITEMS} onClick={() => update([...current, { key: crypto.randomUUID(), id: null, text: '' }])}
                className="min-h-[48px] px-4 rounded-xl well text-sm text-accent inline-flex items-center gap-2 disabled:opacity-50">
                <Plus className="w-4 h-4" />{p.addItem}
              </button>
              <button type="button" disabled={busy || !changed(type) || problem !== null} onClick={() => void save()}
                className="min-h-[48px] px-5 rounded-xl bg-accent text-on-accent text-sm font-semibold disabled:opacity-50 ms-auto" data-testid="template-save">
                {busy ? p.saving : p.saveTemplate}
              </button>
              {changed(type) && problem === null && <p className="basis-full text-xs text-muted">{p.unsaved}</p>}
              {problem && <p className="basis-full text-sm text-bad" role="alert">{errorText[problem]}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
