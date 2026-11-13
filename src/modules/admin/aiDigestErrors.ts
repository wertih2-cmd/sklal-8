export type AiDigestErrorCode = 'not_configured' | 'rate_limited' | 'unavailable'

export class AiDigestError extends Error {
  code: AiDigestErrorCode
  /** Technical codes and counts for the administrator, e.g. "http=502, reason=empty". Never text of the data. */
  detail: string
  constructor(code: AiDigestErrorCode, detail = '') {
    super(code)
    this.code = code
    this.detail = detail
  }
}

export function errorCodeFromServer(code: string | undefined): AiDigestErrorCode {
  if (code === 'ai_not_configured') return 'not_configured'
  if (code === 'ai_rate_limited') return 'rate_limited'
  return 'unavailable'
}

const DETAIL_KEYS = [
  'error', 'reason', 'finish_reason', 'block_reason', 'candidates', 'parts',
  'text_length', 'prompt_tokens', 'output_tokens', 'thoughts_tokens',
  'upstream_status', 'upstream_code', 'upstream_reason', 'upstream_error',
] as const

const SAFE_WORD = /^[A-Za-z0-9_]{1,40}$/

/** One short line from the fixed fields of a server error body; anything else in the body is ignored. */
export function describeServerBody(body: unknown, httpStatus?: number): string {
  const parts: string[] = []
  if (typeof httpStatus === 'number' && Number.isInteger(httpStatus)) parts.push(`http=${httpStatus}`)
  if (typeof body === 'object' && body !== null) {
    const rec = body as Record<string, unknown>
    for (const key of DETAIL_KEYS) {
      const v = rec[key]
      if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${key}=${v}`)
      else if (typeof v === 'string' && SAFE_WORD.test(v)) parts.push(`${key}=${v}`)
    }
  }
  return parts.join(', ')
}
