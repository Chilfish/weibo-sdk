# 术语表（Ubiquitous Language）

> 本表是 weibo-sdk 的**意见性术语**：定义项目内唯一概念时使用这些术语，避免同义词混用。
> 更新时机：每次把新概念固化进代码/文档时同步维护。
> 英文缩略语保留原文（`mblogId`、`okPolicy` 等），中文为解释。

---

## 领域实体（Domain Entities）

**微博 / Tweet**:
一条微博内容。`ITweet` 领域模型 + `Tweet` 类。
_Avoid_: 帖子、状态（status 是 raw 层字段名，不是领域术语）、post

**用户 / User**:
微博账号。`IUser` 领域模型 + `User` 类。
_Avoid_: 账户（account 是认证概念）、person

**mblogId**:
微博的字母形式 ID（Base62 编码，如 `QqsYymYOS`），区别于数字 `id`。
_Avoid_: 微博 ID、mid（历史 raw 字段名，语义已并入 mblogId）

**UID**:
用户数字 ID（字符串形式）。
_Avoid_: 用户 ID（易与 mblogId 混淆）、userId

**转发 / retweeted_status**:
被转发的原微博。领域模型字段为 `retweetedStatus`（camelCase），raw 层字段为 `retweeted_status`（snake_case）。
_Avoid_: repost（与 raw 的 `reposts_count` 统计字段混淆）

**评论 / Comment**:
微博下的评论。raw 层为 `buildComments` 响应。
_Avoid_: 留言

**媒体 / TweetMedia**:
微博附带媒体（图片/视频/LivePhoto/GIF），`type` 用 `MediaType` 枚举。
_Avoid_: 附件、素材

**定位 / TweetGeo**:
发博时选择的地址（纬度/经度/地址名）。

**卡片 / TweetPageCard**:
微博正文中的链接预览/视频卡片（`page_info`）。
_Avoid_: link card、embed

**热搜 / Hot Band**:
`/ajax/side/bandUnified` 返回的榜单，`type` 分 `hot`/`topic`/`entertainment`。
_Avoid_: trending（英文名保留 band）

## 协议与端点（Protocol & Endpoints）

**EndpointSpec**:
端点定义对象（`resourceType` + `endpoint` + `argsSchema` + `buildResource` + `okPolicy` + `schema`），用 `defineEndpoint()` 包装。
_Avoid_: endpoint 定义（口语可，但正式文档用 EndpointSpec）

**Resource Type**:
资源类型，`IResource` 的 key（如 `TWEET_MYMBLOG`）。一个端点对应一个资源类型。
_Avoid_: resource（单数，指 `IRequestResource` 请求对象，语义不同）

**ok 字段**:
微博 API 顶层返回的 `ok` 数值（`1` 表示成功）。
_Avoid_: status、success

**okPolicy**:
EndpointSpec 对 `ok !== 1` 的错误处理策略（`none` / `require_ok_1`）。

**since_id**:
时间线分页游标。**类型不固定**：可能是 `number`，也可能是带后缀的 `string`（如 `"5348185968740754kp2"`）；空串 / 缺省表示无更多。
⚠️ 上游分页会漂移：2026-08-09 实测 `mymblog` 弃用 `since_id`（恒 `""`）改用 `page`；2026-10-20 复测两者都可用且等价，`total` 也恢复真实值。schema 必须接受 `string | number`。
_Avoid_: cursor（新浪还有其他游标语义，如 `next_cursor`）

**hasMore**:
`TweetPageResult` 是否还有下一页的布尔标志。

**开放端点 / Open-ended Schema**:
response schema 使用 `.passthrough()` 保留未知字段，代码访问字段一律 `.optional()`。

**buildResource**:
EndpointSpec 中把 args 构建为 `IRequestResource`（URL + method）的函数。

## 架构与工程（Architecture & Engineering）

**归一化 / Normalize**:
把 raw JSON 转换为领域模型的纯函数过程（`models/data/*.ts`）。
_Avoid_: 转换、映射（map 是原始语义）、hydration（规格书旧词，已弃用）

**FetcherService**:
所有 Service 继承的 HTTP 核心（请求、错误映射、okPolicy 校验、Zod 校验、hooks/telemetry 发射）。
_Avoid_: HttpClient、client（`this.client` 是内部的 axios 实例）

**领域模型 / Domain Model**:
SDK 对外暴露的稳定契约（`IUser`/`ITweet` + `User`/`Tweet` 类），与 raw 层解耦。

**raw 层 / Raw Types**:
`types/raw/**` 中镜像微博 API 原始结构的类型（部分已迁移为 `z.infer`）。

**文档即事实 / Docs-as-truth**:
文档必须与代码一致；不一致时以代码为准并修正文档。
_Avoid_: 文档即规范（spec 是目标，facts 是现状）

**数据驱动开发**:
所有 Schema / 归一化逻辑必须以真实微博 API 响应（fixture）为准，禁止凭手写接口猜测。

**Fixture**:
`tests/fixtures/raw/*.json` 中脱敏后的真实 API 响应，用于离线测试与数据驱动开发。
_Avoid_: mock 数据（mock 是手写假数据，语义不同）

**脱敏 / Sanitization**:
把真实响应中的 URL/长 ID/日期/长文本替换为占位符，短字符串保留（规则见 `tests/fixtures/raw/INDEX.md`）。

## 可观测性（Observability）

**Wide Events / 宽事件**:
扁平 KV 的可观测性事件，必含 `event_name/timestamp/trace_id`，其余字段为 primitive。
_Avoid_: 日志、metrics（它们是不同形态）

**Telemetry**:
`WeiboSDKTelemetry.emit(event)` 的统称。telemetry 的 emit 失败 MUST NOT 影响 SDK 功能。

**trace_id**:
单次请求/归一化全链路的追踪标识（`<timestamp>-<seq>`）。
_Avoid_: requestId、correlation id

**Hooks**:
`WeiboSDKHooks`（`onLifecycle` / `onFetched` / `onError`），面向调用方的回调钩子，区别于 telemetry。

**结构化错误 / Structured Error**:
继承 `WeiboSDKError`，携带 `code/level/retryable/context`。禁止直接 `throw new Error('...')`。

**level**:
错误层级：`transport`（网络）/ `protocol`（校验）/ `business`（业务）。
_Avoid_: category、severity

## 开发流程（Workflow）

**TDD / Red-Green-Refactor**:
先写失败用例 → 最小实现 → 重构。本项目默认离线可跑。

**E2E**:
真实 Cookie + 真实网络的测试，`WEIBO_E2E=1` 显式开启，默认跳过。

**自检 / selfCheck**:
`WeiboSDK` 的会话自检（`none`/`lazy`/`eager`），通过 `myDetails()` 判断 Cookie 有效性。

**ADR**:
架构决策记录，见 `docs/planning/architecture.md`。

**Postmortem**:
事故/返工后的根因分析（blameless），见 `docs/postmortem/README.md`。
