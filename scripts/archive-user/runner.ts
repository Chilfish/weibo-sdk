import type { IUser } from '../../src/types/domain/IUser'
import type { CliValues } from './cli'
import type { JournalMeta, RunConfig } from './types'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveCookieInput } from '../../src/utils/cookieInput'
import { readEnvValue } from '../../src/utils/envFile'
import { WeiboSDK } from '../../src/WeiboSDK'
import { HELP, isHelpRequested, parseCli } from './cli'
import {
  assertResumeConfig,
  buildConfig,
  normalizeUid,
  resolveBurst,
  resolveConcurrency,
  resolveDelay,
} from './config'
import { JOURNAL_SCHEMA, MAX_CONCURRENCY } from './constants'
import { ArchiveJob } from './job'
import { createJournalPaths, readMeta, resolveOutPath, writeFileAtomic } from './journal'
import { archiveLog } from './log'
import { assembleArchive } from './output'
import { createRawRecorder, prepareRawPath } from './raw'
import { planSlices } from './slices'

function resolveCookie(values: CliValues): string {
  const envFileArg = typeof values.dotenv === 'string' && values.dotenv.trim() !== ''
    ? values.dotenv
    : typeof values['env-file'] === 'string' && values['env-file'].trim() !== ''
      ? values['env-file']
      : undefined
  const envFile = envFileArg === undefined
    ? join(process.cwd(), '.env')
    : resolve(process.cwd(), envFileArg)
  const rawCookie = (typeof values.cookie === 'string' && values.cookie.trim() !== '')
    ? values.cookie
    : readEnvValue(envFile, 'WEIBO_COOKIE') ?? ''

  let cookie: string
  try {
    cookie = resolveCookieInput(rawCookie)
  }
  catch (error) {
    throw new Error(`Cookie 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!cookie.trim())
    throw new Error(`未找到 WEIBO_COOKIE（读取 ${envFile}）。归档需要登录 Cookie；可用 --dotenv 或 --cookie 指定。`)
  return cookie
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (isHelpRequested(argv)) {
    console.log(HELP)
    return
  }

  const { values, positionals, provided } = parseCli(argv)

  const uidInput = positionals[0]
  if (!uidInput)
    throw new Error(`缺少 UID。\n\n${HELP}`)
  if (positionals.length > 1)
    throw new Error(`只接受一个 UID，收到多余参数：${positionals.slice(1).join(' ')}`)

  const uid = normalizeUid(uidInput)
  const outPath = resolveOutPath(process.cwd(), values.out, uid)
  const paths = createJournalPaths(outPath)

  if (values.fresh) {
    rmSync(paths.partsDir, { recursive: true, force: true })
    rmSync(paths.legacyJournalPath, { force: true })
  }

  const storedMeta = values.fresh ? undefined : readMeta(paths.metaPath)

  let config: RunConfig
  if (storedMeta) {
    assertResumeConfig(storedMeta.config, uid, provided, values)
    config = storedMeta.config
    archiveLog(`resume parts=${paths.partsDir} slices=${storedMeta.slices.length}`)
  }
  else {
    if (!values.fresh && existsSync(paths.legacyJournalPath)) {
      throw new Error(
        `检测到旧版单文件 journal：${paths.legacyJournalPath}\n`
        + `切片进度现在按 ${paths.partsDir}/<slice>.journal.jsonl 存放。加 --fresh 重新开始（旧进度不会自动迁移）。`,
      )
    }
    config = buildConfig(uid, values)
  }

  const sinceUnix = config.range.since.unix
  const untilUnix = config.range.until.unix
  const concurrency = resolveConcurrency(values.concurrency)
  const delay = resolveDelay(values.delay)
  const burst = resolveBurst(values.burst)
  const requestedConcurrency = typeof values.concurrency === 'string' ? Number(values.concurrency) : undefined
  if (requestedConcurrency !== undefined && requestedConcurrency > concurrency)
    archiveLog(`--concurrency ${requestedConcurrency} 超过上限 ${MAX_CONCURRENCY}，使用 ${concurrency}`)
  const slices = planSlices(sinceUnix, untilUnix, config.sliceDays)

  if (storedMeta) {
    const stored = storedMeta.slices
    const samePlan = stored.length === slices.length
      && stored.every((slice, index) => slice.key === slices[index].key)
    if (!samePlan)
      throw new Error(`切片计划与 ${paths.metaPath} 不一致（加 --fresh 重新开始）`)
  }

  if (existsSync(outPath) && !values.force && storedMeta === undefined)
    throw new Error(`输出文件已存在：${outPath}（加 --force 覆盖，或保留切片进度续跑）`)

  const rawOutPath = prepareRawPath({
    cwd: process.cwd(),
    rawOut: values['raw-out'],
    raw: values.raw === true,
    outPath,
    legacyJournalPath: paths.legacyJournalPath,
    metaPath: paths.metaPath,
    partsDir: paths.partsDir,
    force: values.force === true,
    resuming: storedMeta !== undefined,
  })
  const rawRecorder = createRawRecorder(rawOutPath)

  const cookie = resolveCookie(values)
  const sdk = new WeiboSDK({
    auth: 'cookie',
    cookie,
    selfCheck: { mode: 'lazy' },
    delay,
    maxConcurrent: burst,
    ...(rawRecorder.hooks === undefined ? {} : { hooks: rawRecorder.hooks }),
  })

  archiveLog(`uid=${uid} since=${new Date(sinceUnix * 1000).toISOString()} until=${new Date(untilUnix * 1000).toISOString()}`)
  archiveLog(`out=${outPath}`)
  archiveLog(
    `slices=${slices.length} sliceDays=${config.sliceDays}`
    + ` concurrency=${concurrency}`
    + ` delay=${delay}ms burst=${burst}`,
  )
  if (rawOutPath !== undefined)
    archiveLog(`raw=${rawOutPath}`)

  let user: IUser
  if (storedMeta) {
    try {
      user = await sdk.users.getById(uid)
    }
    catch (error) {
      user = storedMeta.user
      archiveLog(`user refresh failed, using meta: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  else {
    user = await sdk.users.getById(uid)
    const meta: JournalMeta = {
      type: 'meta',
      schema: JOURNAL_SCHEMA,
      createdAt: new Date().toISOString(),
      config,
      slices,
      user,
    }
    writeFileAtomic(paths.metaPath, `${JSON.stringify(meta, null, 2)}\n`)
    archiveLog(`parts=${paths.partsDir}`)
  }
  archiveLog(`user=${user.name} (${user.id}) statuses=${user.stats.statuses}`)

  const job = new ArchiveJob({
    sdk,
    uid,
    config,
    slices,
    slicePath: paths.slicePath,
    concurrency,
  })
  const { entries, issues, fatalError } = await job.execute()

  const { output, errors, complete } = assembleArchive({
    uid,
    config,
    user,
    entries,
    issues,
    fatalError,
  })
  writeFileAtomic(outPath, `${JSON.stringify(output, null, 2)}\n`)

  archiveLog(
    `done tweets=${output.stats.tweets} comments=${output.stats.comments} replies=${output.stats.replies} errors=${output.stats.errors}`,
  )
  archiveLog(`wrote ${outPath}`)
  if (rawOutPath !== undefined) {
    if (rawRecorder.error !== undefined)
      archiveLog(`raw incomplete: ${rawOutPath} lines=${rawRecorder.lines}: ${rawRecorder.error}`)
    else
      archiveLog(`raw=${rawOutPath} lines=${rawRecorder.lines}`)
  }

  if (complete) {
    rmSync(paths.partsDir, { recursive: true, force: true })
    archiveLog('parts removed')
  }
  else {
    archiveLog(`parts kept for resume: ${paths.partsDir}`)
  }

  if (fatalError !== undefined)
    throw fatalError
  if (errors.length > 0 || rawRecorder.error !== undefined)
    process.exitCode = 1
}
