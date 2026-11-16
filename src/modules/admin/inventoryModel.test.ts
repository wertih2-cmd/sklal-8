import { describe, it, expect } from 'vitest'
import {
  baseline, lineDiff, isChanged, needsSave, isInvalid, uncountedCount, countProgress, canClose, type CountLine,
} from './inventoryModel'

const line = (p: Partial<CountLine> = {}): CountLine => ({
  expected: 10, actual: 10, pack_size: 1, counted: false, system_qty_at_count: null,
  actStr: '10', touched: false, reject: false, ...p,
})

describe('inventoryModel', () => {
  it('baseline: до пересчёта — остаток на старт, после — на момент пересчёта', () => {
    expect(baseline(line())).toBe(10)
    expect(baseline(line({ counted: true, system_qty_at_count: 13 }))).toBe(13)
  })

  it('lineDiff считает от baseline, а не только от expected', () => {
    expect(lineDiff(line({ actStr: '7' }))).toBe(-3)
    expect(lineDiff(line({ counted: true, system_qty_at_count: 13, actual: 10, actStr: '10' }))).toBe(-3)
    expect(lineDiff(line({ counted: true, system_qty_at_count: 10, actual: 10, actStr: '10' }))).toBe(0)
  })

  it('lineDiff учитывает размер упаковки и округляет до 3 знаков', () => {
    expect(lineDiff(line({ pack_size: 12, expected: 24, actual: 24, actStr: '2.5' }))).toBe(6)
    expect(lineDiff(line({ expected: 0.1, actual: 0.1, actStr: '0.3' }))).toBe(0.2)
  })

  it('needsSave: изменение или подтверждение «совпадает» у непросчитанной строки', () => {
    expect(needsSave(line())).toBe(false)
    expect(needsSave(line({ actStr: '9' }))).toBe(true)
    expect(needsSave(line({ touched: true }))).toBe(true)
    expect(needsSave(line({ counted: true, touched: true }))).toBe(false)
    expect(isChanged(line({ actStr: '10.0' }))).toBe(false)
  })

  it('isInvalid: пусто, отрицательное, не число, бесконечность', () => {
    expect(isInvalid(line({ actStr: '' }))).toBe(true)
    expect(isInvalid(line({ actStr: '-1' }))).toBe(true)
    expect(isInvalid(line({ actStr: 'abc' }))).toBe(true)
    expect(isInvalid(line({ actStr: 'Infinity' }))).toBe(true)
    expect(isInvalid(line({ actStr: '0' }))).toBe(false)
  })

  it('uncountedCount и countProgress не считают пропущенные позиции', () => {
    const ls = [line(), line({ counted: true }), line({ reject: true })]
    expect(uncountedCount(ls)).toBe(1)
    expect(countProgress(ls)).toEqual({ counted: 1, total: 2 })
  })

  it('canClose: нельзя без пересчёта, с несохранённым, с пустым списком; можно при пропуске', () => {
    expect(canClose([])).toBe(false)
    expect(canClose([line()])).toBe(false)
    expect(canClose([line({ counted: true, system_qty_at_count: 10 })])).toBe(true)
    expect(canClose([line({ counted: true, actStr: '9' })])).toBe(false)
    expect(canClose([line({ reject: true })])).toBe(true)
    expect(canClose([line({ counted: true }), line({ actStr: '' , reject: true })])).toBe(false)
  })
})
