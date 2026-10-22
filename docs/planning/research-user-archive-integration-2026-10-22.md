# 用户归档能力的产品化（设计提案）

> 状态：提案，待确认后实施。目标是把 `scripts/archive-user/` 的完整能力搬进 SDK 与 CLI，让 npm 用户不再自己重写一遍范围归档、补全和断点续跑。

## 1. 背景

`scripts/archive-user/` 现在能做一件 SDK 和 CLI 都还没提供的事：给定 uid 和时间范围，逐切片枚举微博，逐条补全详情、全文、一级评论、楼中楼和可选转发，最后合并成一个归档 JSON，并在中断后按切片续跑。

问题在于它只存在于仓库里。`package.json` 的 `files` 只有 `dist`，npm 用户拿不到这个脚本，只能自己用 `sdk.archive.streamArchive()` 再拼一遍。对「归档某个账号某段时间」这种高频场景，这是重复造轮子。

现有能力的边界也需要说清楚：

| 能力 | 已有实现 | 缺口 |
|---|---|---|
| 全量镜像账号 | `sdk.archive.streamArchive` / `weibo-cli archive` | 偏「从头镜像」，不是「指定范围 + 深度补全」 |
| 日期切片 | `streamArchive({ timelineSource: 'search', since, until })` | 自适应窗口，调用方无法固定切片边界 |
| 单条补全 | `tweets.enrich` / `streamComments` / `streamReplies` / `streamReposts` | 没有把它们串成一条归档流水线 |
| 断点续跑 | `ArchiveCheckpoint` | 只有阶段级游标，没有「多切片 + 已完成记录」的任务状态 |
| 单文件产出 | 无 | 只有流式 item，没有 `ArchiveFile` 信封 |
| raw sidecar | `config.hooks.onRaw` | 需要调用方自己接 |

## 2. 目标形态

一份实现，三个入口：

```
weibo-cli archive user <uid> ...     # 面向终端：文件、journal、raw、退出码
sdk.userArchive.stream(uid, options) # 面向 SDK：可移植事件流，自己决定怎么存
sdk.userArchive.run(uid, options)    # 面向 SDK：一次拿到完整 ArchiveFile
```

分工原则：

- **SDK 不碰文件系统**。核心入口要能跑在 Node、Worker、浏览器扩展里，持久化通过 `UserArchiveStore` 端口或可序列化的任务状态交给调用方。
- **CLI 负责 Node 侧的文件语义**。journal、原子写、raw sidecar、`--force` / `--fresh`、退出码都留在 CLI，不污染 SDK 契约。
- **不替代现有 `archive`**。`weibo-cli archive <uid>` 继续做全量镜像；`archive user` 是范围归档 + 深度补全，两者并存。

## 3. SDK 接口

### 3.1 门面

`WeiboSDK` 新增一个独立服务属性，避免继续把 `ArchiveService` 撑大：

```ts
const sdk = new WeiboSDK({ cookie })

const result = await sdk.userArchive.run(uid, {
  since: '2025-01-01',
  until: '2025-12-31',
  comments: true,
  replies: true,
  reposts: false,
  concurrency: 6,
})

result.file        // ArchiveFile：user / query / stats / tweets / errors
result.complete    // 是否完整结束
```

流式用法：

```ts
for await (const event of sdk.userArchive.stream(uid, options)) {
  if (event.type === 'record')
    await save(event.entry)

  if (event.type === 'issue')
    report(event.issue)

  if (event.type === 'slice-done')
    markDone(event.slice)
}
```

### 3.2 选项

```ts
export interface UserArchiveOptions {
  /** 时间范围；默认 2009-08-14 ~ 现在。接受 YYYY-MM-DD / YYYYMMDD / unix 秒 */
  since?: string | number
  until?: string | number

  /** 每 n 天一个枚举子任务；0 = 不拆分。默认 30 */
  sliceDays?: number

  /** 内容开关（默认值沿用脚本） */
  comments?: boolean       // 默认 true
  replies?: boolean        // 默认 true
  reposts?: boolean        // 默认 false
  commentOrder?: 'time' | 'hot' // 默认 time

  maxComments?: number
  maxCommentPages?: number
  maxReplies?: number
  maxReplyPages?: number
  maxReposts?: number
  maxRepostPages?: number

  /** 补全并发，默认 6，上限 16；实际 QPS 仍由令牌桶控制 */
  concurrency?: number

  /** 可选的持久化端口；缺省使用内存实现 */
  store?: UserArchiveStore

  /** 每个切片 / 每页的进度 */
  onProgress?: (progress: UserArchiveProgress) => void | Promise<void>
  /** 单条 / 枚举失败；已结构化，不需要调用方再判断错误类型 */
  onIssue?: (issue: ArchiveIssue) => void | Promise<void>
  /** 每条补全结果（流式落盘的主要入口） */
  onRecord?: (entry: UserArchiveRecord) => void | Promise<void>

  /** 中断信号；已发出的补全在 finally 里收敛后退出 */
  signal?: AbortSignal
}
```

### 3.3 事件与结果

```ts
export type UserArchiveEvent =
  | { type: 'meta', meta: UserArchiveMeta }
  | { type: 'slice-start', slice: UserArchiveSlice, resumed: boolean }
  | { type: 'record', entry: UserArchiveRecord }
  | { type: 'issue', slice?: string, issue: ArchiveIssue }
  | { type: 'slice-done', slice: string }
  | { type: 'done', summary: UserArchiveSummary }

export interface UserArchiveRecord {
  slice: string
  mblogId: string
  record: ArchivedTweet
  issues: ArchiveIssue[]
  checkpoint?: ArchiveCheckpoint
}

export interface UserArchiveResult {
  file: ArchiveFile
  complete: boolean
  summary: UserArchiveSummary
}

export interface UserArchiveSummary {
  tweets: number
  comments: number
  replies: number
  errors: number
  complete: boolean
}
```

`ArchiveFile`、`ArchivedTweet`、`ArchiveIssue` 直接复用 `src/types/archive/IArchiveFile.ts`，不新增第二套契约。

### 3.4 持久化端口

```ts
export interface UserArchiveStore {
  loadMeta(): Promise<UserArchiveMeta | undefined>
  saveMeta(meta: UserArchiveMeta): Promise<void>

  /** 读取某个切片已有的记录（续跑时合并进最终文件，避免重复请求） */
  loadRecords(slice: string): Promise<UserArchiveRecord[]>
  appendRecord(entry: UserArchiveRecord): Promise<void>

  markSliceDone(slice: string, checkpoint?: ArchiveCheckpoint): Promise<void>
  appendIssue(issue: ArchiveIssue, slice?: string): Promise<void>
  loadIssues(): Promise<ArchiveIssue[]>
  clear(): Promise<void>
}
```

- 默认导出 `createMemoryUserArchiveStore()`，适合一次性运行和测试。
- CLI 用文件实现：每个切片一个 `<out>.slices/<slice>.journal.jsonl`，`meta.json` 存切片计划，写入走原子 rename，读取时丢弃截断行。这部分直接复用现在脚本里的 `journal.ts` 逻辑。
- 下游可以按自己的存储实现端口：web 用 IndexedDB、服务端用数据库、移动端用 SQLite，都不需要理解 journal 格式。

`run()` 在开始时 `loadMeta()` 做续跑校验，结束时从 store 汇总记录和 issue 组装 `ArchiveFile`。`stream()` 只负责推进和产出事件，调用方负责消费。

## 4. CLI

### 4.1 命令

```bash
weibo-cli archive user <uid> --since 2025-01-01 --until 2025-12-31 --out ./weibo-archive.json
weibo-cli archive user https://weibo.com/u/1234567890 --since 2025-01-01
weibo-cli archive user 1234567890 --since 2025-01-01 --no-comments --reposts
```

放在 `archive` 下面而不是新开顶层命令：`archive` 已经是归档入口，`user` 子命令表达「归档一个用户的范围数据」。现有 `weibo-cli archive <uid>` 保持不动。

### 4.2 参数

| CLI | SDK | 默认 |
|---|---|---|
| `<uid>` / 主页链接 | `uid` | 必填 |
| `--since` / `--until` | `since` / `until` | 2009-08-14 ~ 现在 |
| `-o, --out` | —（CLI 独有） | `./weibo-archive-<uid>.json` |
| `--force` | — | false |
| `--fresh` | `store.clear()` | false |
| `--raw` / `--raw-out` | SDK `hooks.onRaw` | 关闭 |
| `--no-comments` / `--no-replies` | `comments` / `replies` | 开启 |
| `--comment-order` | `commentOrder` | `time` |
| `--max-comments` / `--max-comment-pages` | 同名 | 不限 |
| `--max-replies` / `--max-reply-pages` | 同名 | 不限 |
| `--reposts` / `--max-reposts` / `--max-repost-pages` | 同名 | 关闭 / 不限 |
| `--slice-days` | `sliceDays` | 30 |
| `--concurrency` | `concurrency` | 6，上限 16 |
| `--delay` / `--burst` | SDK 配置 `delay` / `maxConcurrent` | 1000ms / 3 |
| `--dotenv` / `--env-file` / `--cookie` | SDK 配置 `cookie` | `<pwd>/.env` |

### 4.3 输出与退出码

- **文件**：`--out` 指定的 `ArchiveFile`；`.slices/` 是续跑用的 journal，完整结束时删除，有错误时保留。
- **stdout**：一行 JSON 摘要 `{ event: 'done', out, tweets, comments, replies, errors, complete }`，方便管道消费。
- **stderr**：进度、切片开始 / 结束、issue、raw 写入失败等诊断，统一 NDJSON。
- **退出码**：`0` 完整；`1` 枚举中止、存在未补全项或 raw 写入失败。文件与 journal 都会保留。

`--guest` 仍然拒绝：访客只有匿名首屏，不能承诺完整时间线，抛 `CONFIG_INVALID`，与现有 `archive` 一致。

## 5. 内部实现映射

脚本模块可以直接映射到 SDK / CLI，不需要重写逻辑：

| 脚本 | 新位置 | 说明 |
|---|---|---|
| `slices.ts` | `src/services/public/userArchive/slices.ts` | 纯函数，原样迁移 |
| `config.ts` | `src/services/public/userArchive/config.ts` | 改成结构化 `InvalidConfigError` |
| `archive-one.ts` | `src/services/public/userArchive/complete.ts` | 依赖注入 tweets 方法 |
| `job.ts` | `src/services/public/UserArchiveService.ts` | 状态机主体 |
| `output.ts` | `src/services/public/userArchive/assemble.ts` | 纯函数，供 SDK 和测试复用 |
| `issues.ts` | `src/services/public/userArchive/issues.ts` | 复用现有错误类型 |
| `journal.ts` | `src/cli/archiveUser/journal.ts` | Node 文件 store |
| `raw.ts` | `src/cli/archiveUser/raw.ts` | CLI 配置 SDK hooks |
| `runner.ts` | `src/cli/commands/archiveUser.ts` | citty 命令 |
| `time.ts` | `src/services/public/userArchive/time.ts` | 纯函数 |

关键点：

- **切片枚举仍用现有 `ArchiveService.streamArchive`**，参数固定为 `timelineSource: 'search'`、`sliceWindow = slice span`、`includeReposts/Favorites/Comments: false`。不复制枚举分页逻辑。
- **补全仍用现有 `TweetService` 方法**：`enrich(mblogId)`、`streamComments(id, { flow, maxItems, maxPages })`、`streamReplies(id, commentId, ...)`、`streamReposts(mblogId, { maxItems, maxPages })`。
- **并发窗口**沿用脚本的信号量：补全请求并发，journal 落盘按枚举顺序，checkpoint 推进顺序不变。
- **结构化错误**：选项 / 续跑不一致统一抛 `InvalidConfigError`（`CONFIG_INVALID`），不再用裸 `Error`；单条失败仍落 `ArchiveIssue`，`AUTH_SESSION_EXPIRED` / `CONFIG_INVALID` / `RATE_LIMITED` 作为致命错误中止。

## 6. 行为对齐清单

迁移时必须逐项保留：

- [ ] 固定日期切片，切片之间无重叠、无空洞，切片串行枚举
- [ ] `--slice-days 0` 不拆分；缺失 `--since` 时从 2009-08-14 开始
- [ ] 每条微博重新走 `statuses/show`（含长文）
- [ ] 一级评论按 `time` / `hot` 排序，支持条数与页数上限
- [ ] 楼中楼按需展开，支持条数与页数上限；已有内联预览与拉取结果去重
- [ ] `--reposts` 支持条数与页数上限
- [ ] `--concurrency` 是全局补全窗口，不随切片数放大
- [ ] 一个切片失败不污染其他切片；致命错误停止后续切片
- [ ] 每个切片独立 journal，截断行修复，`slice-done` 跳过已完成切片
- [ ] 续跑参数一致性校验（uid / 范围 / 切片计划 / 内容开关 / 上限）
- [ ] 最终按 `mblogId` 去重：issue 少者优先，相同保留更晚写入
- [ ] 最终按发布时间倒序，统计 tweets / comments / replies / errors
- [ ] `complete` = 无致命错误且无遗留 issue
- [ ] raw sidecar 不进入归档 JSON，写失败只记一次错误并影响退出码
- [ ] 归档 JSON 不含 raw

## 7. 测试计划

- **Unit**：切片计划、配置默认值与续跑校验、issue 归一化、去重排序、store 内存实现。
- **Component**：用 fake transport 覆盖完整 job——切片串行、`enrich` 调用、评论 / 楼中楼 / 转发上限、并发窗口、失败策略、journal 续跑不重复请求。
- **CLI**：citty 参数映射、`--fresh` / `--force`、输出路径冲突、raw 路径冲突、退出码。
- **E2E**（`WEIBO_E2E=1`）：小范围归档真实账号，校验 `complete`、统计与 schema。

## 8. 实施顺序

1. `feat(sdk): add user archive service types and slice planning`
2. `feat(sdk): stream ranged user archive with per-tweet completion`
3. `feat(sdk): add user archive store port and archive assembly`
4. `feat(cli): add archive user command with file journal`
5. `refactor(scripts): make archive-user a thin CLI wrapper`
6. `docs: document user archive SDK and CLI surfaces`

每一步带自己的测试和文档；第 5 步之后再决定是否直接删除 `scripts/archive-user/`。

## 9. 需要拍板的问题

1. **入口命名**：建议 `sdk.userArchive.stream()` / `sdk.userArchive.run()`；备选 `sdk.archive.streamUser()` / `sdk.archive.user()`。
2. **CLI 位置**：建议 `weibo-cli archive user <uid>`；备选 `weibo-cli user archive <uid>` 或新顶层命令。
3. **默认内容开关**：建议沿用脚本（评论 / 楼中楼默认开，转发默认关），与「深度归档」的预期一致。
4. **store 端口**：建议 SDK 只定义端口 + 内存实现，文件 journal 留在 CLI；如果下游 Node 场景也需要开箱即用的文件续跑，再补 `@chilfish/weibo-sdk/node` 子路径。
