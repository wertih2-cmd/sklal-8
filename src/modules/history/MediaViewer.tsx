import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Loader as Loader2 } from 'lucide-react'
import { useModalLayer } from '@/components/useModalLayer'

interface MediaItem {
  path: string
  url: string | null
  isVideo: boolean
}

interface MediaViewerProps {
  bucket: string
  paths: string[]
  onClose: () => void
}

function isVideoPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'mp4' || ext === 'mov' || ext === 'webm'
}

export function MediaViewer({ bucket, paths, onClose }: MediaViewerProps) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const loadedRef = useRef(false)

  const loadUrls = useCallback(async () => {
    if (loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    setError(null)
    try {
      const { createSignedUrls } = await import('@/modules/history/api')
      const results = await createSignedUrls(bucket, paths)
      setItems(results.map((r) => ({ path: r.path, url: r.url, isVideo: isVideoPath(r.path) })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [bucket, paths])

  useEffect(() => {
    loadUrls()
  }, [loadUrls])

  // Escape closes the viewer only; the panel under it stays open.
  useModalLayer(true, onClose)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(paths.length - 1, i + 1))
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [paths.length])

  const prev = () => setIndex((i) => Math.max(0, i - 1))
  const next = () => setIndex((i) => Math.min(paths.length - 1, i + 1))

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/90 z-confirm flex items-center justify-center" onClick={onClose}>
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/90 z-confirm flex flex-col items-center justify-center gap-4" onClick={onClose}>
        <p className="text-white/70 text-sm">{error}</p>
        <button onClick={onClose} className="text-white/70 p-2"><X className="w-6 h-6" /></button>
      </div>
    )
  }

  const current = items[index]
  if (!current) return null

  return (
    <div className="fixed inset-0 bg-black/90 z-confirm flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-4" onClick={(e) => e.stopPropagation()}>
        <span className="text-white/70 text-sm">{index + 1} / {items.length}</span>
        <button onClick={onClose} className="text-white/70 p-2"><X className="w-6 h-6" /></button>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden px-4" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button onClick={prev} className="absolute start-2 text-white/70 p-2"><ChevronLeft className="w-8 h-8 rtl:rotate-180" /></button>
        )}
        {current.isVideo && current.url ? (
          <video src={current.url} controls className="max-w-full max-h-full rounded-lg" />
        ) : current.url ? (
          <img src={current.url} alt="" className="max-w-full max-h-full rounded-lg object-contain" />
        ) : (
          <p className="text-white/50 text-sm">—</p>
        )}
        {index < items.length - 1 && (
          <button onClick={next} className="absolute end-2 text-white/70 p-2"><ChevronRight className="w-8 h-8 rtl:rotate-180" /></button>
        )}
      </div>
    </div>
  )
}
