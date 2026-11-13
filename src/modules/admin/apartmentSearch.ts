/** Latin letters that look like the Cyrillic ones a keyboard in the other layout gives: A1/202 typed with Cyrillic letters. */
const LOOKALIKE: Record<string, string> = {
  '\u0430': 'a', '\u0432': 'b', '\u0435': 'e', '\u043a': 'k', '\u043c': 'm', '\u043d': 'h', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0442': 't', '\u0445': 'x',
}

/** Search key of an apartment code or a query: case, spaces, separators and the layout do not matter. */
export function searchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-/.]+/g, '')
    .replace(/[\u0430\u0432\u0435\u043a\u043c\u043d\u043e\u0440\u0441\u0442\u0445]/g, (c) => LOOKALIKE[c])
}

/** Codes that start with the query come first, then the ones that only contain it. Empty query: the first `limit`. */
export function filterApartments<T extends { code: string }>(list: readonly T[], query: string, limit = 8): T[] {
  const q = searchKey(query)
  if (!q) return list.slice(0, limit)
  const starts: T[] = []
  const contains: T[] = []
  for (const a of list) {
    const k = searchKey(a.code)
    if (k.startsWith(q)) starts.push(a)
    else if (k.includes(q)) contains.push(a)
  }
  return [...starts, ...contains].slice(0, limit)
}
