/** `getGuestTokenStatus()` 的渲染子集（不含 token 明文）。 */
export interface GuestSessionView {
  issuedAt: number
  scope: string
  source: string
}

/** `whoami --guest --format markdown`：只展示 token 元信息。 */
export function renderGuestSessionMarkdown(status: GuestSessionView | undefined): string {
  const lines = [
    '# 访客身份（未登录）',
    '',
    '- 登录：否',
    '- 数据范围：公开数据（用户资料 / 单条微博 / 评论 / 热搜等）',
  ]
  if (status) {
    lines.push(`- token 签发时间：${new Date(status.issuedAt).toISOString()}`)
    lines.push(`- token scope：${status.scope}`)
    lines.push(`- token 来源：${status.source}`)
  }
  else {
    lines.push('- token：未取得')
  }
  return lines.join('\n')
}
