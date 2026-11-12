export type AiDigestErrorCode = 'not_configured' | 'rate_limited' | 'unavailable'

export class AiDigestError extends Error {
  code: AiDigestErrorCode
  constructor(code: AiDigestErrorCode) {
    super(code)
    this.code = code
  }
}

export function errorCodeFromServer(code: string | undefined): AiDigestErrorCode {
  if (code === 'ai_not_configured') return 'not_configured'
  if (code === 'ai_rate_limited') return 'rate_limited'
  return 'unavailable'
}
