import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SOURCE = path.join(ROOT, 'schemas')
const TARGET = path.join(ROOT, 'website/public/schemas')

if (!existsSync(SOURCE)) {
  console.error(`schemas directory not found: ${SOURCE}`)
  process.exit(1)
}

rmSync(TARGET, { recursive: true, force: true })
mkdirSync(TARGET, { recursive: true })
cpSync(SOURCE, TARGET, { recursive: true })
console.log(`docs assets synced: ${path.relative(ROOT, TARGET)}`)
