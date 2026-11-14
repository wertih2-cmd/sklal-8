import { useState } from 'react'
import { useI18n } from '@/i18n'
import { friendlyMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'
import { saveCleaningCoef } from './payrollApi'
import { parseCoef } from './payrollExtraModel'

/** The coefficient of one cleaning for the premium (admin). Empty means 1; the base premium of the category is multiplied by it. */
export function CleaningCoefField({ eventId, current, onSaved }: {
  eventId: string
  current: number | undefined
  onSaved: () => void
}) {
  const { t } = useI18n()
  const c = t.admin.chessboard
  const [text, setText] = useState(current === undefined ? '' : String(current))
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const r = parseCoef(text)
    if (!r.ok) { setInvalid(true); return }
    setInvalid(false)
    setBusy(true)
    try {
      await saveCleaningCoef(eventId, r.value)
      toast(c.coefSaved, 'success')
      onSaved()
    } catch (e) {
      toast(friendlyMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-1 pb-1">
      <div className="flex items-end gap-2">
        <label className="block text-xs text-muted flex-1">{c.coefLabel}
          <input inputMode="decimal" value={text} disabled={busy} placeholder="1" onChange={(e) => setText(e.target.value)} className="well w-full rounded-xl px-3 min-h-[44px] text-ink text-sm mt-1 disabled:opacity-60" />
        </label>
        <button type="button" disabled={busy} onClick={() => void save()} className="well rounded-xl px-4 min-h-[44px] text-sm text-ink disabled:opacity-60">{c.coefSave}</button>
      </div>
      {invalid && <p className="text-xs text-bad mt-1" role="alert">{c.coefInvalid}</p>}
    </div>
  )
}
