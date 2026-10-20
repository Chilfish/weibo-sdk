/** 公开可访问的演示账号 / 微博（与仓库测试 fixture 同源）；用 `--uid` / 环境变量覆盖。 */
export function defaultUid(env: Record<string, string>): string {
  return env.PLAYGROUND_UID || '1111681197'
}

export function defaultMblogId(env: Record<string, string>): string {
  return env.PLAYGROUND_MBLOG_ID || 'QqsYymYOS'
}
