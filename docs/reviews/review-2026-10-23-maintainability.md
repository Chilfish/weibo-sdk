# 可维护性审查（2026-10-23）

**范围**：`src/` 公开面与内部编排、`scripts/` 门禁、`.github/workflows/`、`api-surface.json`、`AGENTS.md`。
**背景**：0.6.0 发布前审计，目标是找出「复杂度已超过可维护线」的位置，并区分**真实缺陷**与**设计取舍**。
**结论**：7 组问题中 5 组属于缺陷或门禁盲区，已在本日修复；两组是取舍，只做了收窄，没有大改。

---

## 1. ArchiveService 生成器上帝对象（已拆）

**事实**：`streamArchive` 565–1687 行，单函数约 1120 行；7 个 phase、checkpoint 收敛、错误策略、
并发预取、日期切片、媒体与 telemetry 共用一个闭包。

**处理**：

| 新模块 | 职责 |
|---|---|
| `services/archive/checkpoint.ts` | 阶段顺序、`ArchiveRunState`、checkpoint 收敛与推进（纯函数） |
| `services/archive/runtime.ts` | 依赖/选项归一化、`runWithPolicy`、进度与错误事件、评论/转发预取、item 构造 |
| `services/archive/phases/timeline.ts` | mymblog + searchProfile 日期切片 + 页内滑窗预取 |
| `services/archive/phases/{likes,comments,favorites,media}.ts` | 各阶段独立 generator |
| `services/archive/reposts.ts` | 内联转发流 |
| `services/archive/utils.ts` | 去重、重复页、时间/游标解析 |

`ArchiveService` 现在只剩：guest/账号级守卫、状态机装配与阶段派发、批量归档。`streamArchive`
从 ~1120 行降到 ~80 行。

**验证**：`ArchiveService*.test.ts` 6 个文件 67 个用例全绿，未修改任何断言。

---

## 2. Stable 承诺过宽（已按证据收紧）

**事实**：`api-surface.json` 原为 252 Stable / 15 Experimental。真正有独立版本号的契约只有
`ITweet`（`TWEET_CONTRACT_VERSION`）与 `ArchiveFile`（`weibo-user-archive/v2`）。

**处理**：把 `check:api` 的文档判定从「名字在 `website/api/**` 任意出现」改成
「名字出现在代码片段（行内 code 或 fenced block）」，并排除生成页 `api/types/index.md`。
以此为准，66 个只有「被提到」没有「被说明」的导出降级为 Experimental：

- 各方法的 `*Options` / `*StreamOptions` / `*Progress`、`StreamLimitOptions`、`StreamRangeOptions`、`PaginationProgress`；
- `Capability*` 枚举、`ArchivePhase` / `ArchiveErrorAction` 等运行时标签；
- `WEIBO_CAPABILITIES` / `listCapabilities` / `formatArchiveProgress` / `isArchiveProgress` / `TWEET_CONTEXT_SCHEMA`。

现状：**186 Stable / 81 Experimental**。判据写进 `docs/engineering/api-stability.md`：
Stable = 文档站有可被门禁验证的说明；想把某个导出升回 Stable，就补文档。

> 注意：降级不会降低文档门禁成本（Experimental 仍在导出索引里可查），它降低的是**承诺**。

---

## 3. 配置字段「写了但不算数」（已修）

- `delay` 的类型声明接受 `(retryCount) => number`，但 `FetcherService` 只认 number，函数形式静默回退 1000。
  **处理**：类型收窄为 `number`；构造期对非 number 直接抛 `CONFIG_INVALID`，不再静默。
- `maxConcurrent` 实际是令牌桶容量（burst），不是并发闸门。**处理**：改名为 `burst`，
  文档明确「同一瞬间的最大突发数，也是实际并发上限；持续吞吐由 `delay` 决定」。
  CLI 的 `--burst` 与配置名一致了。这是 0.x 内的 breaking change，需写进 CHANGELOG。

---

## 4. 分页抽象（已修，但没照建议改 cursor）

- `TweetService.streamByUserId` 的 `hasMore` 之前取自**过滤广告后**的条数，整页广告会提前终止。
  改为看上游客数；连续 3 页被过滤完才停止（防上游忽略 page 的死循环）。
- `FollowingsService.streamUsers` 之前完全忽略 `hasMore`，靠「空页 / 整页重复」兜底。
  现在把 `hasMore` 传给 `paginate`，上游给出终止游标（`next_cursor: 0`）时少发一次请求。

**没有**把 `next_cursor` 当页码用：真实 fixture 里 `next_cursor` 是偏移量（friendships 20/31/70、
followContent 50/100/150），而抓包用的是 `page=1/2/3`。`FollowingPageResult.cursor` 已注释为
「上游原值，不是页码，仅用于诊断」。

---

## 5. capabilities 是第二事实源（已加交叉断言）

新增 `keeps capability auth in sync with endpoint specs`：为每个 capability 显式声明
`cookie` / `guest` 两条路由，断言与 `defineEndpoint({ auth })` 一致，并强制新能力登记映射。

这条断言立刻暴露了「guest 能力不能简单复用 cookie 端点」：`users.timeline` / `followings.*` /
`likes.list` 在 guest 下走 `mobileContainerSpec`，直接拿 `capability.auth` 比单个 endpoint 会误报。

---

## 6. 门禁盲区（已补）

- `verify:package` 与 `test:bundle` 现在同时进 CI 与 publish workflow；CI matrix 从 `[24, 26]`
  改为 `[20, 24, 26]`，`engines >=20.16` 的下限第一次被实测。
- `check:api` 的文档覆盖升级为代码片段级别（见第 2 节）。
- `tsdown` 丢 `./schemas/*` 的问题已在 `bb01839` 修复；本次审查开始时的「工作区正在补」是陈旧信息。

---

## 7. 其他点名项

| 问题 | 处理 |
|---|---|
| `FetcherService` 5 处 `request_error` 手写 | 收敛为 `emitRequestError()`，分支差异走参数 |
| `FollowingsService` 的 `as FriendshipsResponse['users'][number]` | m 站适配器改用 `FollowingUserSchema.safeParse`，失败抛结构化 `ProtocolError`；`GuestReads` 用真实 `mobile_followings_p1.json` / `mobile_fans_p1.json` 验证通过 |
| 两条归档管线并存、README 无选择树 | README 增加「先选管线」表：`archive` = 游标流 + `ArchiveItem`；`userArchive` = 日期切片 + `ArchiveFile` |
| 66 个裸 `catch {}` | **未改**。绝大多数是「可观测性不得影响业务」的正当护栏；统一补 emit 会让生产 telemetry 噪音化。判断标准留给具体调用点，不引入机械规则 |
| 文档/流程比重偏高 | `AGENTS.md` 的「文档先行」收窄为三类：公开契约、endpoint、事故与可靠性；其余改动当天补开发日志即可 |

---

## 未做与理由

- **没有**把 66 个 catch 都加 debug 事件：收益不确定，噪声确定。
- **没有**给 `burst` 实现 semaphore：令牌桶已经限制突发并发，新增闸门会改变默认吞吐；改名比改语义诚实。
- **没有**重写 `userArchive` 管线：它和 `archive` 的用途不同（范围归档 vs 全量镜像），合并会把两种 checkpoint 语义揉在一起。
