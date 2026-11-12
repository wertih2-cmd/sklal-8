import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { FOCUSABLE_SELECTOR, nextFocusIndex } from '@/components/modalStack'
import { useModalLayer } from '@/components/useModalLayer'

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
  /** Close on a click outside the dialog (default true). Off for forms where a stray click would lose input. */
  closeOnBackdrop?: boolean
  /** Off for a dialog that must be closed by its own button only: no Esc, no backdrop click, no close icon. Default true. */
  dismissible?: boolean
}

const noop = () => {}

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
export function Modal({ open, title, onClose, children, size = 'md', glass = false, hideHeader = false, closeOnBackdrop = true, dismissible = true }: ModalProps) {
  const { t } = useI18n()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes only the topmost dialog (a ConfirmDialog opened above this modal is closed first).
  const isTop = useModalLayer(open, dismissible ? onClose : noop)

  useEffect(() => {
    if (!open) return
    lockScroll()
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    panel?.focus()

    // Keep Tab inside the dialog while it is on top.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel || !isTop()) return
      const items: HTMLElement[] = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const index = items.indexOf(document.activeElement as HTMLElement)
      const atEdge = index === -1 || (e.shiftKey && index === 0) || (!e.shiftKey && index === items.length - 1)
      if (atEdge) {
        e.preventDefault()
        items[nextFocusIndex(index, items.length, e.shiftKey)].focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      unlockScroll()
      previous?.focus()
    }
  }, [open, isTop])

  if (!open) return null

  const surface = glass ? 'glass text-ink' : 'bg-surface text-ink border border-line'

  return createPortal(
    <div className="fixed inset-0 z-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 bg-black/45 anim-scrim" onClick={closeOnBackdrop && dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full ${SIZE_CLASS[size]} max-h-[90dvh] overflow-auto rounded-2xl p-5 ${surface} max-md:bottom-0 max-md:left-0 max-md:top-auto max-md:translate-x-0 max-md:translate-y-0 max-md:max-w-none max-md:max-h-[85dvh] max-md:rounded-b-none max-md:anim-sheet focus:outline-none`}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between mb-4">
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {dismissible && (
              <button
                onClick={onClose}
                className="p-2 -m-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label={t.common.close}
              >
                <X className="w-5 h-5 text-muted" />
              </button>
            )}
          </div>
        )}
        {hideHeader && <span id={titleId} className="sr-only">{title}</span>}
        {children}
      </div>
    </div>,
    document.body,
  )
}
