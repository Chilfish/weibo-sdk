import { parseArgs } from 'node:util'
import {
  DEFAULT_BURST,
  DEFAULT_CONCURRENCY,
  DEFAULT_DELAY_MS,
  DEFAULT_SLICE_DAYS,
  MAX_BURST,
  MAX_CONCURRENCY,
  WEIBO_EPOCH,
} from './constants'

export const HELP = `存档指定用户、指定时间范围内的微博详情（含评论区），输出单个 JSON 文件。

用法：
  pnpm archive:user <uid> [options]

时间范围（含边界，本地时区解析日期）：
  --since <date|unix>          起始：YYYY-MM-DD / YYYYMMDD / unix 秒（默认 ${WEIBO_EPOCH}）
  --until <date|unix>          结束：YYYY-MM-DD / YYYYMMDD / unix 秒（默认现在）

输出：
  -o, --out <path>             输出文件（默认 ./weibo-archive-<uid>.json）
  --force                      覆盖已存在的输出文件

原始响应（可选，单独存，不写入归档 JSON）：
  --raw                        把上游原始响应追加到 <out>.raw.ndjson
  --raw-out <path>             自定义 raw JSONL 路径（隐含 --raw）

内容：
  --no-comments                不拉评论区
  --no-replies                 只拉一级评论，不展开楼中楼
  --comment-order <time|hot>   评论排序（默认 time；time 序按数字 mid 翻页，完整遍历更稳）
  --max-comments <n>           每条微博最多一级评论数（默认不限）
  --max-comment-pages <n>      每条微博最多评论页数（默认不限）
  --max-replies <n>            每条一级评论最多楼中楼数（默认不限）
  --max-reply-pages <n>        每条一级评论最多楼中楼页数（默认不限）
  --reposts                    额外拉取每条微博的转发列表
  --max-reposts <n>            每条微博最多转发数（默认不限）
  --max-repost-pages <n>       每条微博最多转发页数（默认不限）

枚举与补全：
  --slice-days <n>             每 n 天拆一个独立枚举子任务（默认 ${DEFAULT_SLICE_DAYS}；0 = 不拆分）
  --concurrency <n>            全局同时补全的微博数（默认 ${DEFAULT_CONCURRENCY}，范围 1–${MAX_CONCURRENCY}）

  切片枚举始终串行：searchProfile 的 page>1 复用会话里最近一次 page=1 的窗口，
  并发切片会互相覆盖，导致每个切片只拿到第一页。

限速（默认约 1 req/s；调低 delay 会更快，也更容易触发 432）：
  --delay <ms>                 令牌补充间隔（默认 ${DEFAULT_DELAY_MS}ms）
  --burst <n>                  令牌桶容量 / 突发请求数（默认 ${DEFAULT_BURST}，上限 ${MAX_BURST}）

断点续传：
  每个切片独立 journal：<out>.slices/<sliceKey>.journal.jsonl，meta 在 <out>.slices/meta.json。
  重跑同一命令会按切片续跑，已完成的切片直接跳过。
  --fresh                      丢弃已有切片进度，从头开始

Cookie：
  --dotenv <path>              环境文件（默认 <pwd>/.env；pnpm 会拦截 --env-file，故用此名）
  --env-file <path>            同 --dotenv（仅直接跑 tsx / node 时可用）
  -c, --cookie <value>         Cookie header 串或 cookies.txt 路径（显式覆盖）

  -h, --help                   显示帮助

说明：
  - 只读；只使用 .env 中的 Cookie，不读取 shell 环境变量。
  - 每条微博都会重新拉取 statuses/show，长文会补拉全文。
  - 归档 JSON 不含 raw；--raw 走 SDK hooks.onRaw，记录当前进程发出的每次上游响应（可能很大）。
  - 中途中断不会丢已完成的微博；最终 JSON 按 mblogId 去重后写出。
  - 切片枚举串行；补全并发由 --concurrency 控制，实际 HTTP 速率仍受 SDK 令牌桶限制（默认约 1 req/s）。
  - 想真正提速时再调小 --delay / 调大 --burst；命中 432 会全局暂停并重试。
  - 退出码 0 表示完整；1 表示枚举中止或存在补全失败（输出文件仍会写入）。
  - 完整结束时 <out>.slices/ 会被删除；存在错误时保留，方便再次续跑。
`

const OPTIONS = {
  'since': { type: 'string' },
  'until': { type: 'string' },
  'out': { type: 'string', short: 'o' },
  'dotenv': { type: 'string' },
  'env-file': { type: 'string' },
  'cookie': { type: 'string', short: 'c' },
  'force': { type: 'boolean', default: false },
  'fresh': { type: 'boolean', default: false },
  'raw': { type: 'boolean', default: false },
  'raw-out': { type: 'string' },
  'no-comments': { type: 'boolean', default: false },
  'no-replies': { type: 'boolean', default: false },
  'comment-order': { type: 'string', default: 'time' },
  'max-comments': { type: 'string' },
  'max-comment-pages': { type: 'string' },
  'max-replies': { type: 'string' },
  'max-reply-pages': { type: 'string' },
  'reposts': { type: 'boolean', default: false },
  'max-reposts': { type: 'string' },
  'max-repost-pages': { type: 'string' },
  'slice-days': { type: 'string' },
  'concurrency': { type: 'string' },
  'delay': { type: 'string' },
  'burst': { type: 'string' },
} as const

export interface CliValues {
  'since'?: string
  'until'?: string
  'out'?: string
  'dotenv'?: string
  'env-file'?: string
  'cookie'?: string
  'force'?: boolean
  'fresh'?: boolean
  'raw'?: boolean
  'raw-out'?: string
  'no-comments'?: boolean
  'no-replies'?: boolean
  'comment-order'?: string
  'max-comments'?: string
  'max-comment-pages'?: string
  'max-replies'?: string
  'max-reply-pages'?: string
  'reposts'?: boolean
  'max-reposts'?: string
  'max-repost-pages'?: string
  'slice-days'?: string
  'concurrency'?: string
  'delay'?: string
  'burst'?: string
}

export interface ParsedCli {
  values: CliValues
  positionals: string[]
  /** 显式出现的选项名；续跑校验用它区分「沿用 journal」与「用户显式覆盖」。 */
  provided: Set<string>
}

export function isHelpRequested(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h')
}

export function parseCli(argv: string[]): ParsedCli {
  const { values, positionals, tokens } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    tokens: true,
    options: OPTIONS,
  })

  const provided = new Set<string>()
  for (const token of tokens) {
    if (token.kind === 'option')
      provided.add(token.name)
  }

  return { values: values as CliValues, positionals, provided }
}
