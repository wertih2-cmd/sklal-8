import { describe, it, expect } from 'vitest'
import { parseGuestPrice, parseCost } from './guestPrice'

describe('parseGuestPrice', () => {
  it('empty string returns null', () => {
    expect(parseGuestPrice('')).toEqual({ ok: true, value: null })
  })

  it('spaces only returns null', () => {
    expect(parseGuestPrice('   ')).toEqual({ ok: true, value: null })
  })

  it('integer', () => {
    expect(parseGuestPrice('12')).toEqual({ ok: true, value: 12 })
  })

  it('decimal with dot', () => {
    expect(parseGuestPrice('12.5')).toEqual({ ok: true, value: 12.5 })
  })

  it('decimal with comma', () => {
    expect(parseGuestPrice('12,5')).toEqual({ ok: true, value: 12.5 })
  })

  it('trims spaces', () => {
    expect(parseGuestPrice('  12  ')).toEqual({ ok: true, value: 12 })
  })

  it('trims spaces around decimal', () => {
    expect(parseGuestPrice('  12.5  ')).toEqual({ ok: true, value: 12.5 })
  })

  it('accepts two decimal places', () => {
    expect(parseGuestPrice('12.57')).toEqual({ ok: true, value: 12.57 })
    expect(parseGuestPrice('12,50')).toEqual({ ok: true, value: 12.5 })
  })

  it('rejects three or more decimal digits', () => {
    expect(parseGuestPrice('12.567')).toEqual({ ok: false })
    expect(parseGuestPrice('12.564')).toEqual({ ok: false })
  })

  it('rejects ambiguous thousands separators instead of saving a wrong price', () => {
    expect(parseGuestPrice('1,500')).toEqual({ ok: false })
    expect(parseGuestPrice('1.500')).toEqual({ ok: false })
    expect(parseGuestPrice('15,000')).toEqual({ ok: false })
  })

  it('accepts Arabic-Indic digits and the Arabic decimal separator', () => {
    expect(parseGuestPrice('\u0663\u0665\u0660')).toEqual({ ok: true, value: 350 })
    expect(parseGuestPrice('\u0661\u0662\u066B\u0665')).toEqual({ ok: true, value: 12.5 })
    expect(parseGuestPrice('\u06F1\u06F2')).toEqual({ ok: true, value: 12 })
  })

  it('rejects negative', () => {
    expect(parseGuestPrice('-5')).toEqual({ ok: false })
  })

  it('rejects non-number', () => {
    expect(parseGuestPrice('abc')).toEqual({ ok: false })
  })

  it('rejects value over 1e9', () => {
    expect(parseGuestPrice('1000000001')).toEqual({ ok: false })
  })

  it('accepts exactly 1e9', () => {
    expect(parseGuestPrice('1000000000')).toEqual({ ok: true, value: 1000000000 })
  })

  it('rejects multiple dots', () => {
    expect(parseGuestPrice('12.5.5')).toEqual({ ok: false })
  })

  it('rejects scientific notation', () => {
    expect(parseGuestPrice('1e5')).toEqual({ ok: false })
  })

  it('accepts zero', () => {
    expect(parseGuestPrice('0')).toEqual({ ok: true, value: 0 })
  })

  it('accepts leading zeros', () => {
    expect(parseGuestPrice('007')).toEqual({ ok: true, value: 7 })
  })

  it('accepts comma with spaces', () => {
    expect(parseGuestPrice('  12,5  ')).toEqual({ ok: true, value: 12.5 })
  })
})

describe('parseCost', () => {
  it('empty string is invalid', () => {
    expect(parseCost('')).toEqual({ ok: false })
  })

  it('spaces only is invalid', () => {
    expect(parseCost('   ')).toEqual({ ok: false })
  })

  it('accepts zero', () => {
    expect(parseCost('0')).toEqual({ ok: true, value: 0 })
  })

  it('accepts integer', () => {
    expect(parseCost('150')).toEqual({ ok: true, value: 150 })
  })

  it('accepts decimal with comma', () => {
    expect(parseCost('12,5')).toEqual({ ok: true, value: 12.5 })
  })

  it('rejects ambiguous thousands separators', () => {
    expect(parseCost('1,500')).toEqual({ ok: false })
  })

  it('accepts Arabic-Indic digits', () => {
    expect(parseCost('\u0661\u0665\u0660')).toEqual({ ok: true, value: 150 })
  })
})
