import type { ArchiveFile } from '@chilfish/weibo-sdk'
import type { SdkScenario } from '../lib/types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { mergeArchiveFiles } from '@chilfish/weibo-sdk'
import { flagString } from '../lib/args'
import { defaultUid } from '../lib/defaults'

function readArchive(path: string): ArchiveFile {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as ArchiveFile
}

/** 合并归档：同一账号的多份 ArchiveFile 按 mblogId 合并，评论 / 楼中楼 / 转发取并集。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'archive-merge',
  title: '合并多份归档',
  summary: 'mergeArchiveFiles：mblogId 去重，评论 / 楼中楼 / 转发取并集',
  requiresCookie: false,
  usage: 'pnpm play archive-merge [a.json] [b.json] [--out <path>]',
  async run({ args, env, paths, log }) {
    const uid = defaultUid(env.values)
    const fallback = join(paths.output, 'user-archive', `${uid}.json`)
    const first = resolve(paths.root, args.positionals[0] ?? fallback)
    const second = resolve(paths.root, args.positionals[1] ?? first)

    if (!existsSync(first)) {
      throw new Error(`找不到归档：${first}\n先运行 pnpm play user-archive ${uid}，或显式传入归档路径。`)
    }

    // 只给一个文件时跟自己合并，正好演示幂等。
    const inputs = second === first
      ? [readArchive(first), readArchive(first)]
      : [readArchive(first), readArchive(second)]
    const outPath = resolve(paths.root, flagString(args, 'out') ?? join(paths.output, 'archive-merge', 'merged.json'))

    log.kv('inputs', second === first ? `${first}（自身，演示幂等）` : [first, second])
    const { file, inputTweets, tweets, deduped } = mergeArchiveFiles(inputs)

    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8')

    log.kv('summary', {
      inputTweets,
      tweets,
      deduped,
      complete: file.complete,
      errors: file.stats.errors,
    })
    log.info(`合并结果已写出：${outPath}`)
  },
}
