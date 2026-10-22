# 用户归档脚本

`pnpm archive:user` 把一个微博账号在指定时间范围内发布的微博、评论、楼中楼和转发整理成**一个 JSON 文件**。脚本只读，不调用任何写接口。

它和 SDK 的分工是：SDK 提供单个端点、单条微博的原子能力，脚本负责批量编排——按时间切片枚举、并发补全、断点续跑、合并去重和落盘。归档文件的结构见 [`docs/engineering/archive-schema.md`](../../docs/engineering/archive-schema.md)。

## 快速开始

```bash
# 默认读取当前目录的 .env 里的 WEIBO_COOKIE
pnpm archive:user 1234567890 --since 2025-01-01 --until 2025-12-31

# uid 也可以直接给主页链接
pnpm archive:user https://weibo.com/u/1234567890 --since 2025-01-01

# 不要评论，另外拉取转发列表
pnpm archive:user 1234567890 --since 2025-01-01 --no-comments --reposts

# 不经过 pnpm（pnpm 会拦截 Node 的 --env-file）
bun scripts/archive-user/index.ts 1234567890 --since 2025-01-01
```

默认输出 `./weibo-archive-<uid>.json`。完整参数用 `pnpm archive:user --help` 查看；帮助文本以 [`cli.ts`](./cli.ts) 中的 `HELP` 为准。

Cookie 只从文件读取，不读 shell 环境变量：默认 `<pwd>/.env`，可以用 `--dotenv` 或 `--cookie` 覆盖。`--cookie` 既接受 Cookie header 字符串，也接受 Netscape `cookies.txt` 或包含 header 的文本文件路径。

## 运行流程

```
命令行参数
  → 解析配置、按 --slice-days 生成日期切片
  → 逐切片枚举（searchProfile，必须串行）
  → 每条微博补全详情 / 全文（可选评论、楼中楼、转发，并发执行）
  → 每个切片独立追加 journal
  → 合并全部切片：按 mblogId 去重、按发布时间倒序、统计计数
  → 写出单个归档 JSON
```

几个关键取舍：

- **切片枚举串行**。`searchProfile` 的 `page > 1` 复用会话里最近一次 `page = 1` 的窗口，并发切片会互相覆盖，表现为每个切片只拿到第一页。切片切得再细，枚举仍然一个一个跑。
- **补全并发**。切片内部的 `statuses/show`、评论、楼中楼、转发是独立请求，按 `--concurrency` 走全局并发窗口。实际 HTTP 速率仍由 SDK 的令牌桶控制（默认约 1 req/s），并发度不等于 QPS。
- **journal 按枚举顺序落盘**。并发只发生在请求阶段，同一切片内 journal 的追加顺序、checkpoint 的推进顺序与串行执行时一致，续跑语义不变。
- **最终在合并阶段去重排序**。中途中断不会丢已完成的微博；同一个 `mblogId` 出现多次时，优先保留 issue 更少的一条，issue 相同则保留更晚写入的一条。

## 断点续跑

每次运行会在输出文件旁写一组进度文件：

```
weibo-archive-<uid>.json                         最终归档
weibo-archive-<uid>.json.slices/meta.json        本次运行的 uid / 时间范围 / 切片计划 / 选项 / 用户信息
weibo-archive-<uid>.json.slices/<slice>.journal.jsonl   每个切片的 tweet / checkpoint / error / slice-done
weibo-archive-<uid>.json.raw.ndjson              可选的 raw sidecar（--raw）
```

重跑同一条命令会读取 `meta.json`，跳过已经写完的切片，从 journal 里恢复已完成记录和 checkpoint。

续跑时只允许**省略**参数，显式传的值必须和第一次一致；uid、时间范围、切片计划、`--no-comments` 之类的开关对不上时会直接拒绝，避免把两次不同配置的结果混进一个归档。确实要重来就加 `--fresh`。

运行完整结束时，`.slices/` 会被删除；存在枚举中止或补全失败时保留，方便下次继续。

## 参数速查

| 参数 | 说明 |
|---|---|
| `<uid>` | 数字 uid，或 `https://weibo.com/u/<uid>` 形式的主页链接 |
| `--since` / `--until` | 时间范围，接受 `YYYY-MM-DD` / `YYYYMMDD` / unix 秒；默认从 2009-08-14 到现在 |
| `-o, --out` | 输出路径，默认 `./weibo-archive-<uid>.json` |
| `--force` | 覆盖已存在的输出文件或 raw 文件 |
| `--fresh` | 丢弃已有切片进度，从头开始 |
| `--raw` / `--raw-out` | 把上游原始响应单独写进 JSONL，不进入归档 JSON |
| `--no-comments` / `--no-replies` | 不拉评论 / 只拉一级评论 |
| `--comment-order` | `time`（默认）或 `hot`；`time` 按数字 mid 翻页，完整遍历更稳 |
| `--reposts` | 额外拉取每条微博的转发列表 |
| `--max-comments` / `--max-comment-pages` | 一级评论的条数 / 页数上限 |
| `--max-replies` / `--max-reply-pages` | 每条一级评论的楼中楼条数 / 页数上限 |
| `--max-reposts` / `--max-repost-pages` | 转发的条数 / 页数上限 |
| `--slice-days` | 每 n 天一个枚举子任务，默认 30；`0` 表示不拆分 |
| `--concurrency` | 同时补全的微博数，默认 6，上限 16 |
| `--delay` / `--burst` | 令牌桶补充间隔与容量，默认 `1000ms` / `3` |
| `--dotenv` / `--cookie` | Cookie 来源，见上文 |

## 目录结构

```
scripts/archive-user/
├── index.ts        入口：调用 run()，统一处理顶层错误
├── runner.ts       顶层编排：参数 → 配置 → SDK → 用户信息 → job → 输出 → 清理
├── job.ts          运行状态机：切片枚举、并发补全、失败重试、journal 推进
├── archive-one.ts  单条微博补全：详情 / 评论 / 楼中楼 / 转发
├── output.ts       最终合并：去重、排序、统计、组装 ArchiveFile
├── journal.ts      meta / 切片 journal 的读写、原子写、去重、剥 raw
├── raw.ts          raw sidecar 的路径校验与逐行写入
├── config.ts       参数解析、默认值、续跑一致性校验
├── cli.ts          parseArgs 选项表、CliValues、--help 文本
├── slices.ts       日期切片计划
├── time.ts         发布时间解析与范围判断
├── concurrency.ts  信号量与固定 worker 任务池
├── issues.ts       issue 归一化、去重、致命错误判断
├── types.ts        运行配置 / 切片 / journal 条目类型
└── constants.ts    默认值、上限、journal schema 标识
```

依赖方向是单向的：`index → runner → job → archive-one`，工具模块（`journal` / `concurrency` / `issues` / `time`）只被上层引用，不反向依赖编排逻辑。`output.ts` 只接收普通数据结构，便于单独测试。

## 修改这个脚本

新增参数时，按顺序改三处：`cli.ts` 的 `OPTIONS` 与 `CliValues`、`config.ts` 的 `buildConfig`（必要时还有 `assertResumeConfig`）、`cli.ts` 的 `HELP`。如果参数影响续跑一致性，记得在 `assertResumeConfig` 里加校验。

新增归档内容时，先确认 `ArchivedTweet` 契约（`src/types/archive/IArchiveFile.ts`）需不需要扩展。归档 JSON 的 schema 由类型生成，改完类型后跑 `pnpm schema:archive`，并在 `docs/engineering/archive-schema.md` 记录版本规则。

纯逻辑尽量放进独立模块，IO 只留在 `journal.ts` / `raw.ts` / `runner.ts`。`ArchiveJob` 持有一次运行的全部可变状态，不要在模块顶层放运行期状态，否则多个运行或测试之间会互相污染。

## 测试

```bash
pnpm exec vitest run tests/unit/scripts/archive-user
pnpm run typecheck
```

覆盖范围：切片边界与连续性、参数默认值与续跑校验、journal 截断修复与去重、并发窗口、最终合并的排序 / 统计 / issue 去重。这些测试全部离线，不访问微博。

## 排障

日志前缀的含义：

- `[archive]`：运行级别信息（配置、切片开始 / 结束、最终统计）
- `[start]`：某条微博开始补全
- `[n]`：第 n 条补全完成，带评论数、楼中楼数和耗时
- `[retry]`：重跑上一轮遗留的失败项

常见问题：

- **`meta 不兼容` / 检测到旧版 journal**：进度文件来自旧版本，加 `--fresh` 重来。
- **`与断点日志不一致`**：续跑时显式传了和第一次不同的参数。去掉该参数继续，或加 `--fresh`。
- **`输出文件已存在`**：加 `--force`，或保留 `.slices/` 续跑。
- **`未找到 WEIBO_COOKIE`**：确认 `.env` 位置，或用 `--dotenv` / `--cookie` 指定。
- **频繁 `RATE_LIMITED`**：调大 `--delay`、调小 `--burst`。SDK 会全局暂停并重试，但持续命中会让脚本停止。
- **存在 `errors`**：看归档 JSON 里的 `errors` 数组。`AUTH_SESSION_EXPIRED`、`CONFIG_INVALID`、`RATE_LIMITED` 会中止整个运行；其他错误会记录并保留 `.slices/`，修好后重跑即可。

退出码：`0` 表示完整结束；`1` 表示枚举中止、存在未补全项，或 raw 写入失败。输出文件和 journal 都会保留，方便排查或继续。
