// Pure rules for `npm run check:ui`. No file system access here, so they are unit-testable.

export interface UiViolation {
  rule: 'arbitrary-z' | 'text-white-on-fill' | 'physical-rtl'
  line: number
  text: string
  hint: string
}

// Modal centres itself with left-1/2 + -translate-x-1/2; that is symmetric in RTL.
const PHYSICAL_ALLOW: { file: RegExp; pattern: RegExp }[] = [
  { file: /(^|\/)components\/Modal\.tsx$/, pattern: /left-1\/2|-translate-x-1\/2/ },
]

const PREFIX = '(?:[a-z0-9-]+:)*'
const START = '(?<![\\w\\[/-])'
const END = '(?![\\w/-])'

const Z_RE = new RegExp(`${START}${PREFIX}z-(?:\\[[^\\]]+\\]|50)${END}`)
const SOLID_FILL_RE = new RegExp(`${START}${PREFIX}bg-(?:accent|bad|ok|warn)${END}`)
const TEXT_WHITE_RE = new RegExp(`${START}${PREFIX}text-white${END}`)
const PHYSICAL_RE = new RegExp(
  `${START}${PREFIX}(?:` +
    [
      '-?(?:ml|mr|pl|pr)-(?:[\\d\\[]|auto\\b|px\\b)',
      'text-(?:left|right)(?![\\w-])',
      '(?:left|right)-(?:[\\d\\[]|full\\b|px\\b|auto\\b|1/2)',
      'border-[lr](?![a-z])',
      'rounded-(?:[lr]|tl|tr|bl|br)(?![a-z])',
      '-?translate-x-',
    ].join('|') +
    ')',
)

function stripLineComment(line: string): string {
  const i = line.indexOf('//')
  if (i === -1) return line
  // keep `//` inside strings such as https://…
  const before = line.slice(0, i)
  const quotes = (before.match(/["'`]/g) ?? []).length
  return quotes % 2 === 1 ? line : before
}

export function scanSource(file: string, source: string): UiViolation[] {
  const out: UiViolation[] = []
  const normalized = file.replace(/\\/g, '/')
  let inBlock = false
  source.split(/\r?\n/).forEach((raw, idx) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) return
      line = line.slice(end + 2)
      inBlock = false
    }
    const start = line.indexOf('/*')
    if (start !== -1) {
      const end = line.indexOf('*/', start + 2)
      if (end === -1) {
        inBlock = true
        line = line.slice(0, start)
      } else {
        line = line.slice(0, start) + line.slice(end + 2)
      }
    }
    line = stripLineComment(line)
    const n = idx + 1
    const text = raw.trim().slice(0, 160)
    if (Z_RE.test(line)) {
      out.push({ rule: 'arbitrary-z', line: n, text, hint: 'use z-nav / z-drawer / z-modal / z-confirm / z-toast' })
    }
    if (TEXT_WHITE_RE.test(line) && SOLID_FILL_RE.test(line)) {
      out.push({ rule: 'text-white-on-fill', line: n, text, hint: 'use text-on-accent on bg-accent/bad/ok/warn' })
    }
    if (PHYSICAL_RE.test(line)) {
      const allowed = PHYSICAL_ALLOW.some((a) => a.file.test(normalized) && a.pattern.test(line))
      if (!allowed) {
        out.push({ rule: 'physical-rtl', line: n, text, hint: 'use logical classes: text-start/end, ms-/me-, ps-/pe-, start-/end-, border-s/e, rounded-s/e' })
      }
    }
  })
  return out
}
