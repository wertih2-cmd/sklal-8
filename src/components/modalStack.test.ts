import { describe, it, expect } from 'vitest'
import { isTopmost, nextFocusIndex, pushModal, removeModal } from './modalStack'

describe('modal stack', () => {
  it('the last pushed dialog is the topmost', () => {
    let stack: number[] = []
    stack = pushModal(stack, 1)
    stack = pushModal(stack, 2)
    expect(isTopmost(stack, 2)).toBe(true)
    expect(isTopmost(stack, 1)).toBe(false)
  })

  it('closing the top one makes the one below topmost again', () => {
    const stack = removeModal(pushModal(pushModal([], 1), 2), 2)
    expect(isTopmost(stack, 1)).toBe(true)
  })

  it('removing a dialog from the middle keeps the order of the rest', () => {
    const stack = removeModal(pushModal(pushModal(pushModal([], 1), 2), 3), 2)
    expect(stack).toEqual([1, 3])
    expect(isTopmost(stack, 3)).toBe(true)
  })

  it('an empty stack has no topmost dialog, and the input is not mutated', () => {
    expect(isTopmost([], 1)).toBe(false)
    const original = [1]
    pushModal(original, 2)
    removeModal(original, 1)
    expect(original).toEqual([1])
  })
})

describe('nextFocusIndex', () => {
  it('moves forward and wraps to the first item', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1)
    expect(nextFocusIndex(2, 3, false)).toBe(0)
  })

  it('moves backward and wraps to the last item', () => {
    expect(nextFocusIndex(1, 3, true)).toBe(0)
    expect(nextFocusIndex(0, 3, true)).toBe(2)
  })

  it('starts at the first or last item when focus is outside the list', () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0)
    expect(nextFocusIndex(-1, 3, true)).toBe(2)
    expect(nextFocusIndex(7, 3, false)).toBe(0)
  })

  it('returns -1 when nothing is focusable', () => {
    expect(nextFocusIndex(-1, 0, false)).toBe(-1)
  })
})
