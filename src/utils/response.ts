export type UnknownRecord = Record<string, unknown>

export function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object'
}

export function getOk(value: unknown): number | undefined {
  if (!isRecord(value))
    return undefined
  const ok = value.ok
  return typeof ok === 'number' ? ok : undefined
}

export function getMessage(value: unknown): string | undefined {
  if (!isRecord(value))
    return undefined

  const candidates = [value.msg, value.message, value.error, value.error_msg]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0)
      return c
  }

  return undefined
}
