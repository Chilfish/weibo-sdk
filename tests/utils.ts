import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../')
export const cacheDir = path.join(rootDir, '.cache')

export async function writeJson(data: any, filePath: string): Promise<void> {
  let destPath = filePath
  if (!path.isAbsolute(filePath))
    destPath = path.join(cacheDir, filePath)
  await writeFile(destPath, JSON.stringify(data, null, 2), 'utf8')
}

export async function readJson<T>(filePath: string): Promise<T> {
  let destPath = filePath
  if (!path.isAbsolute(filePath))
    destPath = path.join(cacheDir, filePath)

  const data = await readFile(destPath, 'utf8')
  return JSON.parse(data)
}

export const userId = '1111681197'
export const dataPath = path.join(cacheDir, `data/${userId}`)
export const rawPath = path.join(cacheDir, `raw/${userId}`)
export const cursorPath = path.join(dataPath, 'cursor.txt')
export const cursor = await readFile(cursorPath, 'utf8').then(d => d.trim()).catch(() => undefined)

if (!await stat(dataPath).then(() => true).catch(() => false)) {
  await mkdir(dataPath, { recursive: true })
}

if (!await stat(rawPath).then(() => true).catch(() => false)) {
  await mkdir(rawPath, { recursive: true })
}
