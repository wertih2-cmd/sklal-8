import { useCallback, useEffect, useRef } from 'react'
import { isTopmost, pushModal, removeModal } from '@/components/modalStack'

let seq = 0
let stack: number[] = []

/**
 * Registers an open dialog in the shared stack. Escape reaches only the topmost dialog,
 * so closing a confirmation does not also close the modal underneath it.
 */
export function useModalLayer(active: boolean, onEscape: () => void): () => boolean {
  const escapeRef = useRef(onEscape)
  const idRef = useRef<number | null>(null)
  useEffect(() => { escapeRef.current = onEscape })
  const isTop = useCallback(() => idRef.current != null && isTopmost(stack, idRef.current), [])

  useEffect(() => {
    if (!active) return
    const id = ++seq
    idRef.current = id
    stack = pushModal(stack, id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopmost(stack, id)) escapeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      stack = removeModal(stack, id)
      idRef.current = null
    }
  }, [active])

  /** Stable; true while this dialog is the topmost one (read when a key is pressed, not at render time). */
  return isTop
}
