import type { WeiboSDK } from '@chilfish/weibo-sdk'
import type { SdkScenario } from '../lib/types'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { flagBool, flagNumber, flagString } from '../lib/args'
import { describeError } from '../lib/log'

type ArchiveOptions = NonNullable<Parameters<WeiboSDK['archive']['streamArchive']>[1]>
type ArchiveCheckpoint = NonNullable<ArchiveOptions['checkpoint']>

function readCheckpoint(path: string): ArchiveCheckpoint | undefined {
  if (!existsSync(path))
    return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ArchiveCheckpoint
  }
  catch {
    return undefined
  }
}

function readUidFile(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  return [...new Set(
    lines
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#')),
  )]
}

/** 多账号批量归档：每 uid 独立 checkpoint，单账号失败默认跳过。 */
export const scenario: SdkScenario = {
  kind: 'sdk',
  id: 'archive-batch',
  title: '多账号批量归档',
  summary: 'streamUsersArchive + getCheckpoint(uid) + onUserError=skip',
  usage: 'pnpm play archive-batch <uid...> | --uid-file playground/uids.example.txt [--resume]',
  async run({ sdk, args, paths, log }) {
    const uidFile = flagString(args, 'uid-file')
    const uids = uidFile
      ? readUidFile(resolve(paths.root, uidFile))
      : args.positionals.filter(item => item.trim() !== '')
    if (uids.length === 0)
      throw new Error('用法：pnpm play archive-batch <uid...> 或 --uid-file playground/uids.example.txt')

    const resume = flagBool(args, 'resume', false)
    const maxPages = flagNumber(args, 'max-pages', 1)
    const dirFor = (uid: string): string => join(paths.output, 'archive-batch', uid)

    log.kv('uids', uids.join(', '))
    log.kv('resume', resume)

    const counts = new Map<string, number>()
    for await (const { uid, item } of sdk.archive.streamUsersArchive(uids, {
      includeReposts: true,
      includeFavorites: false,
      maxPagesPerPhase: maxPages,
      getCheckpoint: uid => (resume ? readCheckpoint(join(dirFor(uid), 'checkpoint.json')) : undefined),
      onUserStart: (uid) => {
        mkdirSync(dirFor(uid), { recursive: true })
        log.heading(`归档 ${uid}`)
      },
      onUserDone: (uid, count) => {
        log.kv(`${uid} done`, count)
      },
      onUserError: (uid, error) => {
        log.warn(`${uid} 失败（${describeError(error).code ?? 'UNKNOWN'}），跳过该用户继续`)
        return 'skip'
      },
      onProgress: progress => log.progress(
        `${progress.uid}/${progress.phase}`,
        progress.processed,
        progress.total,
      ),
    })) {
      const dir = dirFor(uid)
      appendFileSync(join(dir, 'items.ndjson'), `${JSON.stringify(item)}\n`)
      writeFileSync(join(dir, 'checkpoint.json'), JSON.stringify(item.checkpoint, null, 2))
      counts.set(uid, (counts.get(uid) ?? 0) + 1)
    }

    log.kv('byUser', Object.fromEntries(counts))
    log.kv('output', join(paths.output, 'archive-batch'))
  },
}
