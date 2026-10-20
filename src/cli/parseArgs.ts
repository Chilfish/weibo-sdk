/**
 * 解析 CLI 的正整数参数（页码 / 最多页数等）。
 *
 * 非法值（空串、非数字、`< 1`）返回 `undefined`，由调用方按「未指定」处理，
 * 避免把 `0` 之类的值直接透传给从 1 开始计数的上游端点（会返回 400）。
 */
export function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '')
    return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1)
    return undefined
  return Math.floor(parsed)
}
