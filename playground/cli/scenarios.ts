import type { CliScenario } from '../lib/types'
import { join } from 'node:path'
import { argument, flagString } from '../lib/args'
import { defaultMblogId, defaultUid } from '../lib/defaults'

/** 每个 CLI 场景 = 一串真实命令；runner 会自动注入 .env / --cookie 并原样输出 JSON/NDJSON。 */
export const cliScenarios: CliScenario[] = [
  {
    kind: 'cli',
    id: 'whoami',
    title: '登录态与能力清单',
    summary: 'whoami + capabilities',
    steps: () => [
      { argv: ['whoami'], note: '校验 Cookie 并输出当前用户（JSON）' },
      { argv: ['capabilities', '--status', 'stable'], note: '稳定能力清单（离线）', auth: false },
    ],
  },
  {
    kind: 'cli',
    id: 'user',
    title: '用户资料与时间线',
    summary: 'user info + user timeline',
    steps: ({ args, env }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      return [
        { argv: ['user', 'info', uid] },
        { argv: ['user', 'timeline', uid, '--page', '1'] },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'home',
    title: '首页时间线',
    summary: 'tweet home + home-stream',
    steps: () => [
      { argv: ['tweet', 'home'], note: '第一页；输出含 maxId' },
      { argv: ['tweet', 'home-stream', '--max-pages', '2'], note: 'NDJSON：progress/item/done' },
    ],
  },
  {
    kind: 'cli',
    id: 'comments',
    title: '微博详情与评论流',
    summary: 'tweet detail + comments-stream',
    steps: ({ args, env }) => {
      const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
      return [
        { argv: ['tweet', 'detail', mblogId] },
        { argv: ['tweet', 'comments-stream', mblogId, '--max-pages', '1'] },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'attachments',
    title: '特殊格式附件',
    summary: 'tweet detail + tweet context（文章 / 投票 / 直播 / 抽奖）',
    steps: ({ args, env }) => {
      const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, 'RnQe6zQ70')
      return [
        { argv: ['tweet', 'detail', mblogId], note: 'JSON 中包含 tweet.attachments' },
        { argv: ['tweet', 'context', mblogId, '--format', 'json'], note: 'Agent 视图的 post.attachments / unknowns' },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'media',
    title: '媒体集合',
    summary: 'media images / videos / albums',
    steps: ({ args, env }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      return [
        { argv: ['media', 'images', uid, '--max-pages', '1'] },
        { argv: ['media', 'videos', uid, '--max-pages', '1'] },
        { argv: ['media', 'albums', uid] },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'download',
    title: '下载媒体（dry-run）',
    summary: 'media download --dry-run',
    steps: ({ args, env, paths }) => {
      const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
      return [
        {
          argv: ['media', 'download', mblogId, '--out', join(paths.output, 'media'), '--dry-run'],
          note: '只规划不落盘；去掉 --dry-run 才会下载',
        },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'favorites',
    title: '收藏、点赞与历史评论',
    summary: 'favorite tags/stream + like stream + comment stream',
    steps: ({ args, env }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      return [
        { argv: ['favorite', 'tags'] },
        { argv: ['favorite', 'stream', uid, '--max-pages', '1'] },
        { argv: ['like', 'stream', uid, '--max-pages', '1'] },
        { argv: ['comment', 'stream', '--max-pages', '1'] },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'social',
    title: '关注 / 粉丝 / @我 / 通知',
    summary: 'follow stream + fans-stream + mentions-stream + notification comments-stream',
    steps: ({ args, env }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      return [
        { argv: ['follow', 'stream', uid, '--max-pages', '1'] },
        { argv: ['follow', 'fans-stream', uid, '--max-pages', '1'] },
        { argv: ['user', 'mentions-stream', '--max-pages', '1'] },
        { argv: ['notification', 'comments-stream', '--max-pages', '1'] },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'topics',
    title: '热搜与超话',
    summary: 'trends + topic cates/stream',
    steps: ({ args }) => {
      const keyword = flagString(args, 'keyword') ?? '游戏'
      return [
        { argv: ['trends'] },
        { argv: ['topic', 'cates'] },
        { argv: ['topic', 'stream', '--keyword', keyword, '--max-pages', '1'] },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'archive',
    title: '单账号归档（有界）',
    summary: 'archive <uid> --no-favorites --max-pages 1',
    steps: ({ args, env }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      return [
        {
          argv: ['archive', uid, '--no-favorites', '--max-pages', '1'],
          note: 'NDJSON 进度事件；checkpoint 默认写到当前目录',
        },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'archive-resume',
    title: '归档 + 状态文件增量',
    summary: 'archive <uid> --state <output>/cli-archive-state.json',
    steps: ({ args, env, paths }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      return [
        {
          argv: [
            'archive',
            uid,
            '--no-favorites',
            '--state',
            join(paths.output, 'cli-archive-state.json'),
            '--max-pages',
            '1',
          ],
          note: '第二次运行会自动用 lastMblogId 做增量早停',
        },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'archive-user',
    title: '范围归档（单文件）',
    summary: 'archive user <uid> --since ... --until ... --out ...',
    steps: ({ args, env, paths }) => {
      const uid = argument(args, 0, 'PLAYGROUND_UID', env.values, defaultUid(env.values))
      const since = flagString(args, 'since') ?? '2025-01-01'
      const until = flagString(args, 'until') ?? new Date().toISOString().slice(0, 10)
      return [
        {
          argv: [
            'archive',
            'user',
            uid,
            '--since',
            since,
            '--until',
            until,
            '--out',
            join(paths.output, 'cli-archive-user', `${uid}.json`),
            '--no-comments',
          ],
          note: '输出单个 ArchiveFile；进度 / issue 走 stderr，stdout 只有一行 done 摘要',
        },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'archive-merge',
    title: '合并归档（本地）',
    summary: 'archive merge <a.json> [b.json] --out ... --force',
    requiresCookie: false,
    steps: ({ args, env, paths }) => {
      const uid = defaultUid(env.values)
      const fallback = join(paths.output, 'user-archive', `${uid}.json`)
      const first = args.positionals[0] ?? fallback
      const second = args.positionals[1] ?? first
      return [
        {
          argv: [
            'archive',
            'merge',
            first,
            second,
            '--out',
            join(paths.output, 'cli-archive-merged.json'),
            '--force',
          ],
          auth: false,
          note: '纯本地操作，不请求微博；同一文件即演示幂等合并',
        },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'enrich',
    title: 'raw / 长文',
    summary: 'tweet enrich --longtext',
    steps: ({ args, env }) => {
      const mblogId = argument(args, 0, 'PLAYGROUND_MBLOG_ID', env.values, defaultMblogId(env.values))
      return [
        { argv: ['tweet', 'enrich', mblogId, '--longtext'], note: '输出 { tweet, raw, longText? }' },
      ]
    },
  },
  {
    kind: 'cli',
    id: 'diagnose',
    title: '能力与降级项（离线）',
    summary: 'capabilities --status degraded + capabilities --service archive',
    requiresCookie: false,
    steps: () => [
      { argv: ['capabilities', '--status', 'degraded'], auth: false },
      { argv: ['capabilities', '--service', 'archive'], auth: false },
    ],
  },
]
