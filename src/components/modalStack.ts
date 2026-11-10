/** Open dialogs, oldest first: only the topmost one reacts to Escape and traps Tab. */
export function pushModal(stack: readonly number[], id: number): number[] {
  return [...stack, id]
}

export function removeModal(stack: readonly number[], id: number): number[] {
  return stack.filter((entry) => entry !== id)
}

export function isTopmost(stack: readonly number[], id: number): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}

/** Next focus position inside a dialog, wrapping at both ends; -1 when nothing is focusable. */
export function nextFocusIndex(current: number, total: number, backwards: boolean): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return backwards ? total - 1 : 0
  return backwards ? (current - 1 + total) % total : (current + 1) % total
}

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
