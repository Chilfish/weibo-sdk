/**
 * 从 `/ajax/profile/detail` 的 `verified_url` 解析当前登录账号 uid。
 *
 * 上游响应没有独立的「我的 uid」字段；`verified_url` 形如
 * `https://verified.weibo.com/verify?fr=myverified?uid=7679065628`。
 * 无法解析时返回 `undefined`，调用方应视为「未知」而不是失败。
 */
export function parseSessionUid(details: { verified_url?: string }): string | undefined {
  return details.verified_url?.match(/[?&]uid=(\d+)/)?.[1]
}
