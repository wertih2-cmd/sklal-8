// Чистая логика инвентаризации (без React и сети): единая формула расхождения и прогресс пересчёта.
// Сервер при закрытии считает: дельта = факт − остаток системы на момент пересчёта (system_qty_at_count).

export const round3 = (x: number) => Math.round(x * 1000) / 1000

export interface CountLine {
  expected: number
  actual: number
  pack_size: number
  counted: boolean
  system_qty_at_count: number | null
  actStr: string
  touched: boolean
  reject: boolean
}

/** Остаток системы, от которого считается расхождение: на момент пересчёта, а для непросчитанной строки — на старт. */
export function baseline(l: Pick<CountLine, 'expected' | 'counted' | 'system_qty_at_count'>): number {
  return l.counted && l.system_qty_at_count != null ? l.system_qty_at_count : l.expected
}

/** Введённый факт в базовых единицах (штуки). */
export function factInBase(l: Pick<CountLine, 'actStr' | 'pack_size'>): number {
  return round3(Number(l.actStr || 0) * l.pack_size)
}

export function lineDiff(l: CountLine): number {
  return round3(factInBase(l) - baseline(l))
}

export function isInvalid(l: Pick<CountLine, 'actStr'>): boolean {
  const s = l.actStr.trim()
  return s === '' || !(Number.isFinite(Number(s)) && Number(s) >= 0)
}

/** Значение в поле отличается от сохранённого на сервере. */
export function isChanged(l: Pick<CountLine, 'actStr' | 'actual' | 'pack_size'>): boolean {
  return Number(l.actStr) !== round3(l.actual / l.pack_size)
}

/** Строку нужно отправить на сервер: изменена или подтверждена пользователем как «совпадает». */
export function needsSave(l: CountLine): boolean {
  return isChanged(l) || (!l.counted && l.touched)
}

/** Сколько позиций ещё не пересчитано (пропущенные «Не применять» не считаются). */
export function uncountedCount(lines: Pick<CountLine, 'counted' | 'reject'>[]): number {
  return lines.filter((l) => !l.counted && !l.reject).length
}

export function countProgress(lines: Pick<CountLine, 'counted' | 'reject'>[]): { counted: number; total: number } {
  const active = lines.filter((l) => !l.reject)
  return { counted: active.filter((l) => l.counted).length, total: active.length }
}

/** Можно ли закрывать: всё сохранено, значения корректны, непросчитанных нет. */
export function canClose(lines: CountLine[]): boolean {
  return lines.length > 0
    && !lines.some(needsSave)
    && !lines.some(isInvalid)
    && uncountedCount(lines) === 0
}
