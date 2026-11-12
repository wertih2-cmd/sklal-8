import { supabase } from '@/lib/supabase'
import type { AiPayload } from '@/modules/admin/digest'
import { AiDigestError, errorCodeFromServer } from '@/modules/admin/aiDigestErrors'

export interface AiDigestResult {
  headline: string
  bullets: string[]
  model: string
  generated_at: string
}

function isResult(v: unknown): v is AiDigestResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.headline === 'string' && Array.isArray(r.bullets) && r.bullets.every((b) => typeof b === 'string')
}

/** Asks the ai-digest function to put the rule-based facts into words. Never throws anything but AiDigestError. */
export async function fetchAiDigest(payload: AiPayload, lang: 'ru' | 'en' | 'ar'): Promise<AiDigestResult> {
  const { data, error } = await supabase.functions.invoke('ai-digest', { body: { payload, lang } })
  if (!error && isResult(data)) return data
  let code: string | undefined
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    code = (data as { error: string }).error
  } else {
    const context = (error as { context?: Response } | null)?.context
    if (context instanceof Response) {
      try {
        const body = JSON.parse(await context.text()) as { error?: string }
        code = body.error
      } catch { /* not JSON: treated as unavailable */ }
    }
  }
  throw new AiDigestError(errorCodeFromServer(code))
}
