import type { SdkScenario } from '../lib/types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { argument, flagBool, flagString } from '../lib/args'
import { defaultMblogId, defaultUid } from '../lib/defaults'
import { describeError } from '../lib/log'

/** 只打印信封的结构摘要，便于对比上游字段漂移。 */
function summarize(value: unknown): string {
  if (value === null || value === undefined)
    return String(value)
  if (typeof value !== 'object')
    return typeof value
  const record = value as Record<string, unknown>
  const data = record.data
  const dataKeys = data && typeof data === 'object' && !Array.isArray(data)
    ? Object.keys(data).length
    : Array.isArray(data) ? `array(${data.length})` : 0
  return `keys=${Object.keys(record).length} dataKeys=${dataKeys}`
}

/** 在 raw 响应里找第一条评论 id（`fetchRawReplies` 需要 rootCommentId）。 */
function findCommentId(value: unknown, depth = 0): string | undefined {
  if (depth > 8)
    return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCommentId(item, depth + 1)
      if (found)
        return found
    }
    return undefined
  }
  if (!value || typeof value !== 'object')
    return undefined

  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : undefined
  if (id && typeof record.text === 'string')
    return id
  for (const item of Object.values(record)) {
    const found = findCommentId(item, depth + 1)
    if (found)
      return found
  }
  return undefined
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 全部 `fetchRaw*` 端点：返回上游原始形状。
 *
 * 适合做 schema 快照与漂移巡检：每个端点独立 try/catch，单个失败不会中断其它调用。
 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'raw-snapshot',
  title: '上游 raw 快照（全部 fetchRaw*）',
  summary: '19 个 fetchRaw* 端点逐个调用，打印信封形状，可选落盘 JSON 供 schema diff',
  usage: 'pnpm play raw-snapshot [uid] [mblogId] [--since 2025-01-01] [--until 2025-01-31] [--write]',
  async run({ sdk, args, env, paths, log }) {
    const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
    const mblogId = argument(args, 1, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
    const since = flagString(args, 'since') ?? daysAgo(30)
    const until = flagString(args, 'until') ?? new Date().toISOString().slice(0, 10)
    const write = flagBool(args, 'write', false)
    const dir = join(paths.output, 'raw-snapshot')

    if (write)
      mkdirSync(dir, { recursive: true })

    let ok = 0
    let failed = 0

    async function capture(name: string, run: () => Promise<unknown>): Promise<unknown> {
      try {
        const raw = await run()
        ok += 1
        log.info(`- ok   ${name} ${summarize(raw)}`)
        if (write)
          writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
        return raw
      }
      catch (error) {
        failed += 1
        const info = describeError(error)
        log.warn(`- fail ${name} ${info.code ?? info.name}: ${info.message}`)
        return undefined
      }
    }

    log.heading('用户')
    await capture('users.fetchRawInfo', () => sdk.users.fetchRawInfo(uid))
    await capture('users.fetchRawDetails', () => sdk.users.fetchRawDetails(uid))
    await capture('users.fetchRawMyDetails', () => sdk.users.fetchRawMyDetails())

    log.heading('微博')
    await capture('tweets.fetchRawUserTimelinePage', () => sdk.tweets.fetchRawUserTimelinePage(uid, 1))
    const comments = await capture('tweets.fetchRawComments', () => sdk.tweets.fetchRawComments(mblogId))
    const rootCommentId = findCommentId(comments)
    if (rootCommentId)
      await capture('tweets.fetchRawReplies', () => sdk.tweets.fetchRawReplies(mblogId, rootCommentId))
    else
      log.info('- skip tweets.fetchRawReplies（本页没有带 id 的评论）')
    await capture('tweets.fetchRawReposts', () => sdk.tweets.fetchRawReposts(mblogId, { page: 1 }))
    await capture('tweets.fetchRawLongText', () => sdk.tweets.fetchRawLongText(mblogId))
    await capture('tweets.fetchRawSearchByDate', () => sdk.tweets.fetchRawSearchByDate(uid, { page: 1, starttime: since, endtime: until }))

    log.heading('社交关系')
    await capture('followings.fetchRawFollowings', () => sdk.followings.fetchRawFollowings(uid, 1))
    await capture('followings.fetchRawFans', () => sdk.followings.fetchRawFans(uid, 1))
    await capture('followings.fetchRawMyFollowings', () => sdk.followings.fetchRawMyFollowings(1))

    log.heading('收藏 / 媒体 / 热搜')
    await capture('favorites.fetchRawFavorites', () => sdk.favorites.fetchRawFavorites(uid, 1))
    await capture('favorites.fetchRawTags', () => sdk.favorites.fetchRawTags())
    await capture('media.fetchRawImagePage', () => sdk.media.fetchRawImagePage(uid))
    await capture('media.fetchRawVideoPage', () => sdk.media.fetchRawVideoPage(uid))
    await capture('trends.fetchRawBand', () => sdk.trends.fetchRawBand('hot'))

    log.heading('公开搜索（上游已失效，失败是预期）')
    await capture('search.fetchRawSearchUsers', () => sdk.search.fetchRawSearchUsers('游戏'))
    await capture('search.fetchRawSearchTweets', () => sdk.search.fetchRawSearchTweets('游戏'))

    log.kv('ok', ok)
    log.kv('failed', failed)
    if (write) {
      log.kv('dir', dir)
      log.info('两次快照可以交给 `weibo-cli schema diff <before> <after>` 比较字段新增 / 删除 / 类型变化。')
    }
    else {
      log.info('加 --write 会把每个端点的原始响应写到 playground/output/raw-snapshot/<endpoint>.json。')
    }
    log.info('这些方法返回上游 snake_case 形状，字段随上游漂移；应用代码优先使用归一化方法。')
  },
}
