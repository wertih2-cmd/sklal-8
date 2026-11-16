// Чистая логика приёмки по заказу. Решение владельца: приёмка сверх заказа РАЗРЕШЕНА,
// поэтому превышение остатка по заказу не ошибка, а только предупреждение.

/** Введённое количество некорректно: не число или отрицательное. Пустое поле считается нулём. */
export function isRecvInvalid(value: string): boolean {
  const r = Number(value)
  return !Number.isFinite(r) || r < 0
}

/** Принимаем больше, чем осталось по заказу (left — в тех же единицах, что и введённое значение). */
export function isOverReceipt(value: string, left: number): boolean {
  const r = Number(value)
  return Number.isFinite(r) && r > left + 1e-9
}
