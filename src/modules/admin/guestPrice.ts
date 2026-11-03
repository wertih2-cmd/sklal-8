export type ParseResult = { ok: true; value: number | null } | { ok: false }

function toAsciiDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
}

// A separator followed by exactly three digits ("1,500", "1.500") is ambiguous
// (thousands vs decimals) and is rejected instead of silently saving 1.5.
export function parseGuestPrice(input: string): ParseResult {
  const trimmed = toAsciiDigits(input.trim())
  if (trimmed === '') return { ok: true, value: null }
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return { ok: false }
  const num = Number(trimmed.replace(',', '.'))
  if (num > 1e9) return { ok: false }
  return { ok: true, value: Math.round(num * 100) / 100 }
}

// Like parseGuestPrice, but a cost is required: empty string is invalid.
// Zero is a valid cost.
export function parseCost(input: string): ParseResult {
  const trimmed = toAsciiDigits(input.trim())
  if (trimmed === '') return { ok: false }
  if (!/^\d+([.,]\d{1,2})?$/.test(trimmed)) return { ok: false }
  const num = Number(trimmed.replace(',', '.'))
  if (num > 1e9) return { ok: false }
  return { ok: true, value: Math.round(num * 100) / 100 }
}
