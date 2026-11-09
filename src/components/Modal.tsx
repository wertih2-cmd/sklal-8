import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n'

type ModalSize = 'sm' | 'md' | 'lg'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  size?: ModalSize
  /** Glass look (see .glass in index.css). Default is the solid surface. */
  glass?: boolean
  /** Hide the built-in header (title stays as aria-label). */
  hideHeader?: boolean
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

// Several modals can be open at once: lock the page scroll until the last one closes.
let scrollLocks = 0
let savedOverflow = ''

function lockScroll() {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLocks += 1
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow
}

/**
 * Shared modal: centred dialog on desktop, bottom sheet on phones.
 * Rendered through a portal at layer z-modal (70); ConfirmDialog (80) opens above it.
 */
export function Modal({ open, title, onClose, children, size = 'md', glass = false, hideHeader = false }: ModalProps) {
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    lockScroll()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      unlockScroll()
    }
  }, [open, onClose])

  if (!open) return null

  const surface = glass ? 'glass text-ink' : 'bg-surface text-ink border border-line'

  return createPortal(
    <div className="fixed inset-0 z-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/45 anim-scrim" onClick={onClose} />
      <div
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${SIZE_CLASS[size]} max-h-[90dvh] overflow-auto rounded-2xl p-5 ${surface} max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:max-w-none max-md:max-h-[85dvh] max-md:rounded-b-none max-md:anim-sheet`}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 -m-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label={t.common.close}
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
