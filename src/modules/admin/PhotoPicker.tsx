import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { compressImage } from '@/lib/compress'
import { isHeicFile, isImageFile } from '@/lib/files'
import { toast } from '@/lib/toast'

/** Photos of one item: picked, shrunk to a JPEG and kept as blobs; the parent uploads them when the form is saved. */
export function PhotoPicker({
  photos, onChange, max, disabled,
}: {
  photos: readonly Blob[]
  onChange: (next: Blob[]) => void
  max: number
  disabled?: boolean
}) {
  const { t, n } = useI18n()
  const p = t.inspections
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const urls = useMemo(() => photos.map((b) => URL.createObjectURL(b)), [photos])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const pick = async (files: File[]) => {
    if (files.length === 0) return
    const room = max - photos.length
    if (room <= 0) { toast(p.photoLimit, 'error'); return }
    if (files.length > room) toast(p.photoLimit, 'error')
    setBusy(true)
    const added: Blob[] = []
    try {
      for (const f of files.slice(0, room)) {
        if (!isImageFile(f) && !isHeicFile(f)) { toast(p.photoFormat, 'error'); continue }
        try {
          added.push(await compressImage(f))
        } catch {
          toast(p.photoFailed, 'error')
        }
      }
    } finally {
      setBusy(false)
    }
    if (added.length > 0) onChange([...photos, ...added])
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {urls.map((u, i) => (
        <div key={u} className="relative w-16 h-16 rounded-xl overflow-hidden border border-line">
          <img src={u} alt="" className="w-full h-full object-cover" />
          <button
            type="button"
            disabled={disabled}
            aria-label={p.removePhoto}
            onClick={() => onChange(photos.filter((_, j) => j !== i))}
            className="absolute top-0.5 end-0.5 w-6 h-6 rounded-full bg-app text-ink flex items-center justify-center"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {photos.length < max && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
          className="min-h-[64px] px-3 rounded-xl well text-sm text-muted inline-flex items-center gap-2 disabled:opacity-60"
        >
          <Camera className="w-4 h-4" />
          {busy ? p.photoProcessing : p.addPhoto}
          <span className="text-xs">{n(String(photos.length))}/{n(String(max))}</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          void pick(files)
        }}
      />
    </div>
  )
}
