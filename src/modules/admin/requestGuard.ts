// Защита от устаревших ответов: каждый новый запрос получает номер, применять результат
// и сбрасывать индикатор загрузки можно только для последнего номера.
export interface RequestGuard {
  next(): number
  isCurrent(id: number): boolean
  invalidate(): void
}

export function createRequestGuard(): RequestGuard {
  let current = 0
  return {
    next: () => ++current,
    isCurrent: (id) => id === current,
    invalidate: () => { current += 1 },
  }
}
