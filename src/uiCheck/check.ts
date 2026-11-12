import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { scanSource, type UiViolation } from './rules'

const SRC = join(process.cwd(), 'src')
const EXT = new Set(['.ts', '.tsx', '.css'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'uiCheck') continue
      walk(full, out)
    } else if (EXT.has(extname(name)) && !/\.test\.[tj]sx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

let total = 0
const files = walk(SRC)
for (const file of files) {
  const rel = relative(SRC, file).replace(/\\/g, '/')
  const found: UiViolation[] = scanSource(rel, readFileSync(file, 'utf8'))
  for (const v of found) {
    total++
    console.error(`src/${rel}:${v.line} [${v.rule}] ${v.text}\n    -> ${v.hint}`)
  }
}

if (total > 0) {
  console.error(`\ncheck:ui: ${total} violation(s)`)
  process.exit(1)
}
console.log(`check:ui: OK (${files.length} files)`)
