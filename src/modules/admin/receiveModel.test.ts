import { describe, it, expect } from 'vitest'
import { isRecvInvalid, isOverReceipt } from './receiveModel'

describe('receiveModel', () => {
  it('isRecvInvalid: отрицательное и не число некорректны, ноль и пустое допустимы', () => {
    expect(isRecvInvalid('-1')).toBe(true)
    expect(isRecvInvalid('abc')).toBe(true)
    expect(isRecvInvalid('Infinity')).toBe(true)
    expect(isRecvInvalid('0')).toBe(false)
    expect(isRecvInvalid('')).toBe(false)
    expect(isRecvInvalid('2.5')).toBe(false)
  })

  it('isRecvInvalid: превышение остатка по заказу НЕ является ошибкой', () => {
    expect(isRecvInvalid('1000')).toBe(false)
  })

  it('isOverReceipt: больше остатка — предупреждение, равно или меньше — нет', () => {
    expect(isOverReceipt('12', 10)).toBe(true)
    expect(isOverReceipt('10', 10)).toBe(false)
    expect(isOverReceipt('9.5', 10)).toBe(false)
    expect(isOverReceipt('0.5', 0)).toBe(true)
    expect(isOverReceipt('10.0000000001', 10)).toBe(false)
  })

  it('isOverReceipt: некорректный ввод не считается превышением', () => {
    expect(isOverReceipt('abc', 10)).toBe(false)
    expect(isOverReceipt('', 10)).toBe(false)
  })
})
