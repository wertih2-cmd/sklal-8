import { useMemo, useState } from 'react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { friendlyMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useAuth } from '@/modules/core/store'
import type { CleaningFeedRow } from './cleaningFeed'
import { createInspection, uploadInspectionPhoto } from './checklistsApi'
import {
  answeredAll, buildResults, emptyResults, failedCount, noteTooLong, PHOTO_MAX, NOTE_MAX,
  type ChecklistItem, type ResultDraft,
} from './checklistsModel'
import { PhotoPicker } from './PhotoPicker'

/** The check list of a cleaning: an answer for every item (ok or not ok), a comment and photos where wanted. A not ok item makes a rework task. */
export function InspectionFormModal({
  cleaning, apartmentCode, template, onClose, onDone,
}: {
  cleaning: CleaningFeedRow
  apartmentCode: string
  template: readonly ChecklistItem[]
  onClose: () => void
  onDone: () => void
}) {
  const { t, n } = useI18n()
  const p = t.inspections
  const userId = useAuth((s) => s.profile?.id)
  const [results, setResults] = useState<ResultDraft[]>(() => emptyResults(template))
  const [photos, setPhotos] = useState<ReadonlyMap<number, Blob[]>>(new Map())
  const [busy, setBusy] = useState(false)
  const items = useMemo(() => [...template].sort((a, b) => a.position - b.position || a.id - b.id), [template])

  const setResult = (itemId: number, patch: Partial<ResultDraft>) =>
    setResults((prev) => prev.map((r) => (r.itemId === itemId ? { ...r, ...patch } : r)))

  const canSend = answeredAll(results) && !results.some((r) => noteTooLong(r.note)) && !busy && !!userId

  const submit = async () => {
    if (!canSend || !userId) return
    setBusy(true)
    try {
      const uploaded = new Map<number, string[]>()
      for (const [itemId, blobs] of photos) {
        const paths: string[] = []
        for (const blob of blobs) paths.push(await uploadInspectionPhoto(userId, blob))
        uploaded.set(itemId, paths)
      }
      const res = await createInspection(cleaning.id, buildResults(results, uploaded))
      toast(res.failed > 0 ? `${p.savedRework}${n(String(res.failed))}` : p.saved, 'success')
      onDone()
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const choice = (active: boolean, tone: 'ok' | 'bad') =>
    `min-h-[44px] px-4 rounded-xl text-sm font-medium border transition-colors ${
      active ? (tone === 'ok' ? 'bg-ok-soft border-ok text-ok' : 'bg-bad-soft border-bad text-bad') : 'well text-muted border-transparent'
    }`

  return (
    <Modal open title={`${p.formTitle} · ${apartmentCode}`} onClose={onClose} size="lg" glass closeOnBackdrop={false}>
      <p className="text-xs text-muted mb-3">{p.cleanedAt}: {formatDateTime(cleaning.cleaned_at)}</p>
      <ol className="space-y-3">
        {items.map((item, idx) => {
          const r = results.find((x) => x.itemId === item.id)!
          return (
            <li key={item.id} className="tile rounded-2xl p-3">
              <p className="text-sm text-ink mb-2"><span className="text-muted">{n(String(idx + 1))}. </span>{item.body}</p>
              <div className="flex gap-2" role="radiogroup" aria-label={item.body}>
                <button type="button" role="radio" aria-checked={r.ok === true} disabled={busy} onClick={() => setResult(item.id, { ok: true })} className={choice(r.ok === true, 'ok')}>{p.itemOk}</button>
                <button type="button" role="radio" aria-checked={r.ok === false} disabled={busy} onClick={() => setResult(item.id, { ok: false })} className={choice(r.ok === false, 'bad')}>{p.itemNotOk}</button>
              </div>
              {r.ok !== null && (
                <div className="mt-2 space-y-2">
                  <input
                    value={r.note}
                    disabled={busy}
                    maxLength={NOTE_MAX}
                    onChange={(e) => setResult(item.id, { note: e.target.value })}
                    placeholder={p.note}
                    aria-label={p.note}
                    className="well w-full rounded-xl px-3 min-h-[44px] text-sm text-ink"
                  />
                  <PhotoPicker
                    photos={photos.get(item.id) ?? []}
                    disabled={busy}
                    max={PHOTO_MAX}
                    onChange={(next) => setPhotos((prev) => new Map(prev).set(item.id, next))}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex flex-col-reverse sm:flex-row sm:items-center gap-2">
        <p className="text-xs text-muted sm:me-auto">
          {answeredAll(results) ? `${p.reworkWillBe}: ${n(String(failedCount(results)))}` : p.answerAll}
        </p>
        <button type="button" onClick={onClose} disabled={busy} className="min-h-[48px] px-4 rounded-xl well text-sm text-muted disabled:opacity-60">{p.cancel}</button>
        <button type="button" onClick={() => void submit()} disabled={!canSend} className="min-h-[48px] px-5 rounded-xl bg-accent text-on-accent text-sm font-semibold disabled:opacity-50" data-testid="inspection-submit">
          {busy ? p.saving : p.submit}
        </button>
      </div>
    </Modal>
  )
}
