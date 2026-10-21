# 端点开发指南

这份指南说明如何新增或修改微博端点：先用真实响应确认行为，再写 schema、Service、CLI 和测试。微博接口没有公开文档，字段和分页方式会变，所以真实响应始终优先于推测。

相关文档：[技术规格](./technical-spec.md)、[代码规范](./code-style.md)、[CLI 参考](./cli.md)。

## 设计原则

1. 先看真实响应，再写 schema。不要凭直觉手写 raw interface，字段类型以真实 JSON 为准。
2. 一个端点对应一个 spec。Zod schema 和 `EndpointSpec` 放在 `src/services/endpoints/<domain>.ts`，不要内联在 Service 里。
3. 响应 schema 使用 `.passthrough()`。只精确声明代码实际访问的字段，其余字段保留下来。
4. args 类型从 schema 推导。使用 `defineEndpoint()` 和 `z.infer`，避免 `as any`。
5. 分页语义写清楚。在 spec、Service 注释和类型里注明使用的是 page、cursor、since_id 还是 max_id，不要靠猜。
6. 错误要结构化。不要直接 `throw new Error`，使用 `TransportError`、`ProtocolError` 或 `BusinessError`。
7. CLI 是验收面。新增公开 Service 方法时，同时补对应 CLI 子命令，输出 JSON，错误写到 stderr 并以非零状态退出。

---

## 新增端点的流程

### 第一步：抓真实响应

```bash
# 方式 A：OpenCLI browser bridge 复用已登录 Chrome（推荐，见 opencli-browser-bridge.md）
#   已知端点：页面内 fetch 复放
opencli browser eval "fetch('/ajax/...',{credentials:'include'}).then(r=>r.json())" --session wb
#   未知端点：打开页面让它自己发请求，再按 shape 预览 + --detail 取 body
opencli browser network --session wb
opencli browser network --detail "GET weibo.com/ajax/..." --session wb

# 方式 B：项目 capture/（CDP，独立 profile + .env Cookie）
pnpm capture -- --help

# 方式 B+：一条命令抓取 + 脱敏 + 写 fixture + 追加 INDEX.md
pnpm capture:endpoint "https://weibo.com/ajax/..." --name <fixture-name>

# 方式 C：curl（Cookie 只从 .env 读取）
curl -s -H "Cookie: $WEIBO_COOKIE" -H "X-XSRF-TOKEN: $TOKEN" \
  -H "User-Agent: ..." -H "Referer: https://weibo.com/..." \
  "https://weibo.com/ajax/..." > tests/fixtures/raw/<name>.json
```

- 至少抓两种变体，例如正常、空结果、边界值或不同账号。
- 按 [fixtures/raw/INDEX.md](../../tests/fixtures/raw/INDEX.md) 脱敏：URL、长 ID、日期、长文本。
- 在 `INDEX.md` 与 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 登记（mapped 或 unmodeled）。未登记的 fixture 会让 `pnpm run validate:fixtures` 失败。

### 生成 spec 骨架

```bash
pnpm new:endpoint <domain>/<name>
# 例：pnpm new:endpoint tweet/bookmarks
```

脚本会创建 `src/services/endpoints/<domain>-<name>.ts`（args / response schema + `defineEndpoint`），并打印后续 checklist（fixture → service → CLI → 测试 → 文档）。

### 第二步：定义 argsSchema

```ts
const MyArgsSchema = z.object({
  uid: z.string(),
  page: z.number().optional(),
  // 上游真实类型：例如 starttime/endtime 是 unix 秒（number），不是日期字符串
  starttime: z.union([z.number(), z.string()]).optional(),
}).strict()
```

检查点：

- [ ] 参数名与上游逐字一致（大小写、下划线）
- [ ] `number | string` 漂移字段用 union，不要强行 `z.coerce`
- [ ] 必填 / 可选与真实请求一致
- [ ] 枚举值有注释或 `z.enum`

### 第三步：定义 response schema

```ts
const MyResponseSchema = z.object({
  ok: z.number(),
  data: z.object({
    list: z.array(ItemSchema),
    total: z.union([z.number(), z.string()]).optional(),
    cursor: z.number().optional(),
  }).passthrough(),
}).passthrough()
```

检查点：

- [ ] `ok` 语义：`require_ok_1` / `none` 取决于真实响应
- [ ] `data` 包装层：数组 / `{ list }` / `{ status }` 必须按真实结构
- [ ] 可空字段：`nullable().optional()` 分开判断
- [ ] 数组元素可能为 `null` 时显式处理
- [ ] 不要用 `.strict()` 锁死响应（会因上游新增字段失败）

### 第四步：定义 EndpointSpec

```ts
export const mySpec: EndpointSpec<'MY_RESOURCE', typeof MyArgsSchema> = defineEndpoint({
  resourceType: 'MY_RESOURCE',
  endpoint: 'ajax/...',
  argsSchema: MyArgsSchema,
  buildResource: ({ uid }) => ({
    method: 'GET',
    url: 'https://weibo.com/ajax/...',
    headers: { referer: `https://weibo.com/u/${uid}` },
  }),
  okPolicy: { mode: 'require_ok_1' },
  // 鉴权要求：默认 'cookie'；只有用访客 token 验证过可读才写 'guest'；完全不需要凭证才写 'none'
  auth: 'cookie',
  schema: MyResponseSchema,
})
```

`auth` 的取值与判定：

- `cookie`（默认）：必须登录 Cookie。guest 模式下调用会在发请求前失败（`AUTH_SESSION_EXPIRED`，`context.requiredAuth = 'cookie'`）。不写这个字段就等于 `cookie`，所以不要为了「先跑通」而省略判断。
- `guest`：访客 token 可读，Cookie 模式下仍优先用 Cookie。加之前必须用访客身份（`--guest` 或 `new WeiboSDK({ auth: 'guest' })`）真实抓一次响应，并入库为 `mobile_*` / 常规 fixture。
- `none`：不需要任何凭证（如 `feed/allGroups`、媒体 CDN 下载）。这类端点不会注入 Cookie，也不会触发访客 token 发放。

检查点：

- [ ] 默认保持 `cookie`，只有验证过的端点才标 `guest`
- [ ] **不要**把账号级数据标成 `guest`：收藏、通知、@ 我、历史评论、我的关注只返回登录账号自身的数据，访客拿到的是别人的或空的
- [ ] **不要**把「假成功」端点标成 `guest`：返回 `ok: 1` + 空列表 / `{}` 但其实是登录门控的端点，标了会让调用方以为「没有数据」
- [ ] 标 `guest` 时同步确认 guest 下的分页能力，并在 `capabilities.ts` 的 `guestPagination` / `guestNote` 里写清楚（`none` / `first_page` / `full`）
- [ ] 只能读第一页的端点（匿名第二页会 302 到登录页）在 Service 层显式拒绝 `page > 1`，抛 `CONFIG_INVALID` 并带 `guestPagination: 'first_page'`
- 在 `src/types/resources.ts` 增加 resource type。
- `buildResource` 只负责 URL / method / 必要 header；公共 header 由 `FetcherService` 注入。
- 跨 host 端点（如 `m.weibo.cn`）必须让 `host` 从 URL 推导，不能硬编码。

### 第五步：实现 Service 方法

```ts
public async listByUserId(uid: string, options?: { page?: number }): Promise<MyPageResult> {
  const raw = await this.request(mySpec, { uid, ...options })
  // raw -> 领域模型（纯函数，放 models/data）
  return { ... }
}
```

- 纯归一化逻辑放 `src/models/data/<Model>.ts`，不要写在 Service。
- 分页结果统一形状：`{ page?, cursor?, hasMore, items }`。
- 归一化方法发 `normalize_done` Wide Event；错误路径已有 `request_error`。
- 公开方法补 TSDoc：参数边界、分页游标语义、抛出的错误、是否触发 telemetry。

### 第六步：添加 CLI 子命令

- 在 `src/cli/commands/<domain>.ts` 定义命令，在 `src/cli.ts` 注册。
- 输出 JSON（`JSON.stringify(data, null, 2)`）；分页命令提供 `--page` / `--count`。
- 错误输出到 stderr 并以非零退出码退出。
- 低频 / 诊断命令在 description 标 `advanced`；废弃能力标 `deprecated` 并给替代命令。

### 第七步：补测试

| 层级 | 必须覆盖 |
|---|---|
| Fixture safeParse | 真实响应 × response schema 通过 |
| Unit | 归一化纯函数、分页计算、空值/异常值 |
| Component | fakeAxios 驱动 Service：URL/args、分页停止、错误映射、telemetry |
| E2E | 真实 Cookie + 外网（默认跳过，发布前跑） |

- 新增测试先写失败用例（Red → Green → Refactor）。
- 错误路径至少覆盖：`ok !== 1`、schema fail、超时/网络错误。
- 分页至少覆盖：空页、重复页、游标不前进、`total` 异常。

### 第八步：更新文档

- [ ] `docs/engineering/technical-spec.md`：端点清单 / 服务方法 / 契约
- [ ] `docs/engineering/cli.md`：命令参考 + 输出形态
- [ ] `README.md`：用户可见能力（如适用）
- [ ] `CHANGELOG.md`：用户可感知变化
- [ ] `docs/planning/backlog.md`：阶段完成后登记后续候选（历史阶段计划归档到 `docs/archive/`）

---

## 分页约定

| 游标类型 | 典型端点 | Service 返回 | 停止条件 |
|---|---|---|---|
| `page` | `mymblog` / `searchProfile` / `favorites` / `repostTimeline` | `{ page: nextPage, hasMore }` | 空列表 / 整页重复 / `page` 越界重置 |
| `max_id` | `buildComments` / `friendstimeline` | `{ maxId, hasMore }` | 无 `max_id`（0 / -1） / 等于上一页 / 空页 |
| `since_id` | 仅增量过滤（如 `friendstimeline`） | — | 不用于翻页；`friendstimeline` 已改用 `max_id` |
| `cursor` | `myCmt` / `getWaterFallContent` | `{ cursor, hasMore }` | 空 cursor / 游标不前进 |
| `sinceid` | `getImageWall` | `{ sinceId, hasMore }` | 空 / 不前进 / 重复 |
| `since_id` | `getAlbumDetail` | `{ sinceId, hasMore }` | `0` / 空 / 不前进 / 重复 |
| `page` | `stopic/list` | `{ page: nextPage, hasMore }` | 空列表 / `page >= count`（`count` 是总页数） |

通用的保护措施：

- 单页按主键去重。
- 整页和上一页完全相同，视为到底，通常是微博忽略了翻页参数。
- 游标不前进时立即停止，避免死循环。
- 自动翻页都要有 `maxPages` 上限，测试和演示时可以调小。
- `searchProfile` 的 `page > 1` 依赖同一会话里最近一次 `page=1` 的检索窗口（`starttime` / `endtime` 被忽略）。多个窗口的翻页序列必须串行、不能交错；并发会让 `page > 1` 返回别的窗口或空页。跨窗口归档只能串行切片（2026-10-21 实测）。

---

## 常见问题

- [ ] `since_id` 真实类型不固定：可能是 `number`，也可能是带后缀的 `string`（如 `"5348185968740754kp2"`）；schema 用 `z.union([z.string(), z.number()])`，禁止 `Number()` 强转（2026-10-20 复测）
- [ ] `total` 可能为 `-1`（防爬），也可能为真实总数（2026-10-20 mymblog 实测恢复）；不能无条件当真实总数，也不能无条件当无效值
- [ ] `searchProfile` 的 `starttime` / `endtime` 是 unix 秒；日期字符串会被静默忽略（`TweetService.searchByDate` 已在边界把 `YYYY-MM-DD` / `YYYYMMDD` 换算为秒；直接发请求时仍需传秒）
- [ ] `searchProfile` 的 `page > 1` 是会话态，不是无状态查询：上游记住最近一次 `page=1` 的窗口，`page > 1` 时 `starttime` / `endtime` 不生效。串行实验 `A p1 → B p1 → A p2` 返回的是 B 的第 2 页；并发时可能直接返回空页。分页序列必须独占会话（2026-10-21 实测）
- [ ] `favorites` 的 `data` 是 `{ status, total_number }`，不是数组；顶层另有 `count` / `total_page`
- [ ] `favorites/all_fav` 的 `page` 从 1 开始，`page=0` 会返回 HTTP 400；非法页码应按第一页处理
- [ ] `favorites/all_fav` 的 `tag_id` / `tag` 参数会被上游忽略（2026-10-20 实测），标签过滤只能客户端做
- [ ] `favorites` 的 `total_number` 可能大于实际可翻页条目（含已删除收藏），`hasMore` 优先用 `total_page`
- [ ] `mymblog` 分页会在 `since_id` 与 `page` 之间漂移（2026-08 实测 `since_id` 失效、`total=-1`；2026-10-20 实测两者都可用且等价、`total` 恢复真实值）；实现以 `page` 为主并保留 `since_id: string | number` 兼容，`page` 越界可能重置到较新区间
- [ ] `retweeted_status` / `user` 可能为 `null`
- [ ] `geo` 可能是空字符串、对象或 `null`
- [ ] `pic_infos.width/height` 可能是 `number | string`
- [ ] 非 JSON 响应（登录页 / 风控页）要归为 `API_BAD_RESPONSE`，不要误报 `API_NOT_OK`
- [ ] `buildComments` 的固定参数是 `is_reload` / `is_show_bulletin` / `is_mix` / `fetch_level`，不要传 `type=feed`。2026-10-20 的抓包显示，带上这个参数时首屏只返回 3 条，`ok`、`total_number` 和 `max_id` 看起来仍然正常；浏览器真实请求不带 `type`，首屏返回 20 条
- [ ] `buildComments` 的 `count` 被上游忽略（10 / 20 都返回约 20 条）；顶层 `total_number` 含楼中楼 / 不可见评论，不能作为结束条件；`max_id=0` 或空页才是到底
- [ ] `buildComments` 的 hot 排序可能先返回空页（`data: []`、`max_id` 仍非 0），停止条件必须包含空页；`flow=1` 必须用数字 mid，字母 mblogid 会 400
- [ ] `buildComments` 的 `trendsText` 出现「博主已开启防火墙」时，`data` 会少于 `total_number` 且直接 `max_id=0`，属于上游限制
- [ ] 浏览器运行时不要注入 Node-only 的 axios `proxy`
- [ ] Cookie 只从 `.env` 读取；不要回退到环境变量
- [ ] `searchProfile` 的 `q` 与 `starttime` / `endtime` 可组合；`q` 为空/缺省才是不过滤，`data.total` 会随关键词收窄（2026-10-20 实测）
- [ ] 二级评论必须用 `id=<一级评论 id>` + `fetch_level=1`（`is_reply=1` 可选）；传顶层微博 id 或 `fetch_level=0` 均返回空列表
- [ ] `getAlbumDetail` 的 `containerid` 必须来自相册 tab 的 `getImageWall?has_album=true`（`pc_profile_album`）；`/ajax/profile/albumlist` 的 `mobile_profile_album` containerid 可能返回空列表
- [ ] 相册详情的 `since_id` 是数字或字符串游标，`0` 表示到底；不要和图片墙的 `sinceid` 参数名混用
- [ ] `stopic/list` 的 `count` 是总页数（每页 30 条），不是条目总数；`sort_id=0` 加 `keyword` 才是搜索
- [ ] 视频播放量取 `media_info.online_users_number`，但只在 `online_users` 明确为「N次观看」时映射；直播在线人数不是播放数
- [ ] 置顶标记是微博级 `isTop: 1/true`（非置顶项通常缺省），不要从 `mblogtype` 推断
- [ ] guest 端点容易「假成功」：匿名请求可能返回 `200 + ok: 1 + 空数组`，也可能直接返回 `{}`。SDK 把 guest 端点的 `{}` 当作静默登录门控并抛 `AUTH_SESSION_EXPIRED`，不要为了让它通过而放宽 schema
- [ ] m 站微博没有 `mblogid`，只有数字 `mid` / `id`；用 `midToMblogId` 换算（如 `5039815108333719 → OgHLUyXYP`），不要自己拼 base62
- [ ] 音频 / 播客在 `page_info.object_type === 'podcast_audio'`，直链是 `media_info.stream_url`（不是视频的 `mp4_*`）
- [ ] `atUsers` 没有结构化字段，只能从 `text` HTML 的用户主页锚点（`/n/` 或 `/u/`）解析；`text_raw` 里的 `//@name:` 是转发链，不是 @ 用户

---

## 合并前检查

- [ ] 端点定义在 `endpoints/<domain>.ts`，Service 无内联 schema
- [ ] args / response schema 由真实 fixture 验证
- [ ] `auth` 明确：默认 `cookie`；标 `guest` 的端点有访客真实样本与 `capabilities` 的 `guestPagination` 说明
- [ ] 分页语义有注释与测试；有重复页保护
- [ ] 错误映射符合 [error-diagnostics.md](./error-diagnostics.md)
- [ ] 公开方法有 TSDoc；CLI 有对应命令
- [ ] `pnpm run typecheck` / `lint` / `test` / `validate:fixtures` / `build` 通过
- [ ] 文档与代码一致（docs-as-truth）
- [ ] `CHANGELOG.md` 已更新（用户可感知变化）

---

## 相关工具

- `pnpm new:endpoint <domain>/<name>`：生成 EndpointSpec 骨架和后续检查清单
- `pnpm capture:endpoint <url>`：抓包、脱敏、写 fixture，并登记 INDEX
- `sdk.capabilities()` / `weibo-cli capabilities`：查看能力、分页类型和状态
- `paginate()`：统一 page、cursor、since_id、max_id 的翻页停止逻辑
- `diffSchemaDigest()` / `weibo-cli schema diff`：对比两份结构快照，查看字段增删和类型变化

CI 目前还没有检查「新增 endpoint 是否同时登记 fixture、CLI 和文档」，这一项仍在 backlog 中。
