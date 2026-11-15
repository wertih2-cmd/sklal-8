import { useState } from 'react'
import { useI18n } from '@/i18n'
import { Modal } from '@/components/Modal'
import { friendlyMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { useAuth } from '@/modules/core/store'
import { recheckInspectionItem, uploadInspectionPhoto } from './checklistsApi'
import { NOTE_MAX, PHOTO_MAX, validateRecheck, type RecheckError, type ReworkEntry } from './checklistsModel'
import { PhotoPicker } from './PhotoPicker'

/** Second look at a failed item once its rework is done: fixed closes the item, not fixed sends the task back with the reason. */
export function RecheckModal({ entry, apartmentCode, onClose, onDone }: {
  entry: ReworkEntry
  apartmentCode: string
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useI18n()
  const p = t.inspections
  const userId = useAuth((s) => s.profile?.id)
  const [ok, setOk] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<Blob[]>([])
  const [error, setError] = useState<RecheckError | null>(null)
  const [busy, setBusy] = useState(false)

  const errorText: Record<RecheckError, string> = { choose: p.errChoose, note: p.errNote, noteLong: p.errNoteLong }

  const submit = async () => {
    const problem = validateRecheck(ok, note)
    if (problem || ok === null || !userId) { setError(problem ?? 'choose'); return }
    setError(null)
    setBusy(true)
    try {
      const paths: string[] = []
      for (const blob of photos) paths.push(await uploadInspectionPhoto(userId, blob))
      await recheckInspectionItem(entry.item.id, ok, note, paths)
      toast(p.recheckDone, 'success')
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
    <Modal open title={`${p.recheckTitle} · ${apartmentCode}`} onClose={onClose} glass closeOnBackdrop={false}>
      <p className="text-sm text-ink mb-1">{entry.item.body}</p>
      {entry.item.note && <p className="text-xs text-muted mb-3">{entry.item.note}</p>}
      <div className="flex gap-2 mb-3" role="radiogroup" aria-label={p.recheckTitle}>
        <button type="button" role="radio" aria-checked={ok === true} disabled={busy} onClick={() => setOk(true)} className={choice(ok === true, 'ok')}>{p.recheckOk}</button>
        <button type="button" role="radio" aria-checked={ok === false} disabled={busy} onClick={() => setOk(false)} className={choice(ok === false, 'bad')}>{p.recheckBad}</button>
      </div>
      <label htmlFor="recheck-note" className="block text-sm text-muted mb-1.5">{p.recheckNote}</label>
      <textarea
        id="recheck-note"
        rows={3}
        value={note}
        maxLength={NOTE_MAX}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        className="well w-full rounded-xl px-3 py-2.5 text-sm text-ink"
      />
      <div className="mt-3">
        <PhotoPicker photos={photos} onChange={setPhotos} max={PHOTO_MAX} disabled={busy} />
      </div>
      {error && <p className="text-sm text-bad mt-3" role="alert">{errorText[error]}</p>}
      <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className="min-h-[48px] px-4 rounded-xl well text-sm text-muted disabled:opacity-60">{p.cancel}</button>
        <button type="button" onClick={() => void submit()} disabled={busy} className="min-h-[48px] px-5 rounded-xl bg-accent text-on-accent text-sm font-semibold disabled:opacity-50">
          {busy ? p.saving : p.recheckSave}
        </button>
      </div>
    </Modal>
  )
}
