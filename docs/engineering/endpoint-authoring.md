# 端点开发指南（新增 / 修改 Endpoint）

**适用**: 新增微博端点、调整上游参数、扩展响应 Schema、修改分页/错误语义。
**硬约束**: 数据驱动开发（真实 fixture 优先）、`EndpointSpec` 单一路径、每个功能有离线测试、CLI 暴露能力。
**相关**: [technical-spec.md](./technical-spec.md) · [code-style.md](./code-style.md) · [CLI 参考](./cli.md) · [行动清单（已归档）](../archive/todo-post-0.1.0.md)

---

## 1. 设计原则

1. **先看真实响应，再写 Schema**：禁止凭直觉手写 raw interface；字段类型以真实 JSON 为准。
2. **一个端点一个 spec**：Zod schema 与 `EndpointSpec` 放在 `src/services/endpoints/<domain>.ts`，禁止内联在 Service。
3. **开放端点模式**：响应 schema 用 `.passthrough()`，只精确声明代码实际访问的字段，其余保留。
4. **args 类型从 schema 推导**：`defineEndpoint()` + `z.infer`，避免 `as any`。
5. **分页语义显式化**：在 spec / service 注释与类型里写清 page / cursor / since_id / max_id；禁止猜测。
6. **错误结构化**：不直接 `throw new Error`；走 `TransportError` / `ProtocolError` / `BusinessError`。
7. **CLI 是验收面**：新增公开 Service 方法必须有对应 CLI 子命令，输出 JSON，错误走 stderr + 非零退出码。

---

## 2. 标准流程（新增端点）

### Step 1 · 抓真实响应

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

- 至少抓 **2 种变种**（正常 / 空结果 / 边界值 / 不同账号）。
- 按 [fixtures/raw/INDEX.md](../../tests/fixtures/raw/INDEX.md) 脱敏：URL、长 ID、日期、长文本。
- 在 `INDEX.md` 与 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 登记（mapped 或 unmodeled）。
- **未登记 fixture 会导致 `pnpm run validate:fixtures` 失败**。

### Step 1b · 生成 spec 骨架

```bash
pnpm new:endpoint <domain>/<name>
# 例：pnpm new:endpoint tweet/bookmarks
```

脚本会创建 `src/services/endpoints/<domain>-<name>.ts`（args / response schema + `defineEndpoint`），并打印后续 checklist（fixture → service → CLI → 测试 → 文档）。

### Step 2 · 定义 argsSchema

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

### Step 3 · 定义 response schema

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

### Step 4 · 定义 EndpointSpec

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
  schema: MyResponseSchema,
})
```

- 在 `src/types/resources.ts` 增加 resource type。
- `buildResource` 只负责 URL / method / 必要 header；公共 header 由 `FetcherService` 注入。
- 跨 host 端点（如 `m.weibo.cn`）必须让 `host` 从 URL 推导，不能硬编码。

### Step 5 · Service 方法

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

### Step 6 · CLI 子命令

- 在 `src/cli/commands/<domain>.ts` 定义命令，在 `src/cli.ts` 注册。
- 输出 JSON（`JSON.stringify(data, null, 2)`）；分页命令提供 `--page` / `--count`。
- 错误输出到 stderr 并以非零退出码退出。
- 低频 / 诊断命令在 description 标 `advanced`；废弃能力标 `deprecated` 并给替代命令。

### Step 7 · 测试

| 层级 | 必须覆盖 |
|---|---|
| Fixture safeParse | 真实响应 × response schema 通过 |
| Unit | 归一化纯函数、分页计算、空值/异常值 |
| Component | fakeAxios 驱动 Service：URL/args、分页停止、错误映射、telemetry |
| E2E | 真实 Cookie + 外网（默认跳过，发布前跑） |

- 新增测试先写失败用例（Red → Green → Refactor）。
- 错误路径至少覆盖：`ok !== 1`、schema fail、超时/网络错误。
- 分页至少覆盖：空页、重复页、游标不前进、`total` 异常。

### Step 8 · 文档

- [ ] `docs/engineering/technical-spec.md`：端点清单 / 服务方法 / 契约
- [ ] `docs/engineering/cli.md`：命令参考 + 输出形态
- [ ] `README.md`：用户可见能力（如适用）
- [ ] `CHANGELOG.md`：用户可感知变化
- [ ] `docs/planning/backlog.md`：阶段完成后登记后续候选（历史阶段计划归档到 `docs/archive/`）

---

## 3. 分页约定

| 游标类型 | 典型端点 | Service 返回 | 停止条件 |
|---|---|---|---|
| `page` | `mymblog` / `searchProfile` / `favorites` / `repostTimeline` | `{ page: nextPage, hasMore }` | 空列表 / 整页重复 / `page` 越界重置 |
| `max_id` | `buildComments` / `friendstimeline` | `{ maxId, hasMore }` | 无 `max_id`（0 / -1） / 等于上一页 / 空页 |
| `since_id` | 仅增量过滤（如 `friendstimeline`） | — | 不用于翻页；`friendstimeline` 已改用 `max_id` |
| `cursor` | `myCmt` / `getWaterFallContent` | `{ cursor, hasMore }` | 空 cursor / 游标不前进 |
| `sinceid` | `getImageWall` | `{ sinceId, hasMore }` | 空 / 不前进 / 重复 |
| `since_id` | `getAlbumDetail` | `{ sinceId, hasMore }` | `0` / 空 / 不前进 / 重复 |
| `page` | `stopic/list` | `{ page: nextPage, hasMore }` | 空列表 / `page >= count`（`count` 是总页数） |

**通用保护**：

- 单页按主键去重。
- 整页与上一页完全相同 → 视为到底（上游忽略翻页参数）。
- 游标不前进 → 立即停止，避免死循环。
- 任何自动翻页都要有 `maxPages` 上限（测试/演示可调）。

---

## 4. 高频雷区（写码前自查）

- [ ] `since_id` 真实类型不固定：可能是 `number`，也可能是带后缀的 `string`（如 `"5348185968740754kp2"`）；schema 用 `z.union([z.string(), z.number()])`，禁止 `Number()` 强转（2026-10-20 复测）
- [ ] `total` 可能为 `-1`（防爬），也可能为真实总数（2026-10-20 mymblog 实测恢复）；不能无条件当真实总数，也不能无条件当无效值
- [ ] `searchProfile` 的 `starttime` / `endtime` 是 **unix 秒**；日期字符串会被静默忽略（`TweetService.searchByDate` 已在边界把 `YYYY-MM-DD` / `YYYYMMDD` 换算为秒；直接发请求时仍需传秒）
- [ ] `favorites` 的 `data` 是 `{ status, total_number }`，不是数组；顶层另有 `count` / `total_page`
- [ ] `favorites/all_fav` 的 `page` 从 1 开始，`page=0` 会返回 HTTP 400；非法页码应按第一页处理
- [ ] `favorites/all_fav` 的 `tag_id` / `tag` 参数会被上游忽略（2026-10-20 实测），标签过滤只能客户端做
- [ ] `favorites` 的 `total_number` 可能大于实际可翻页条目（含已删除收藏），`hasMore` 优先用 `total_page`
- [ ] `mymblog` 分页会在 `since_id` 与 `page` 之间漂移（2026-08 实测 `since_id` 失效、`total=-1`；2026-10-20 实测两者都可用且等价、`total` 恢复真实值）；实现以 `page` 为主并保留 `since_id: string | number` 兼容，`page` 越界可能重置到较新区间
- [ ] `retweeted_status` / `user` 可能为 `null`
- [ ] `geo` 可能是空字符串、对象或 `null`
- [ ] `pic_infos.width/height` 可能是 `number | string`
- [ ] 非 JSON 响应（登录页 / 风控页）要归为 `API_BAD_RESPONSE`，不要误报 `API_NOT_OK`
- [ ] `buildComments` 固定参数是 `is_reload` / `is_show_bulletin` / `is_mix` / `fetch_level`；**不要传 `type=feed`**——2026-10-20 实测带该参数时首屏只返回 3 条，`ok` / `total_number` / `max_id` 仍正常（静默降级）；浏览器真实请求不带 `type`，首屏 20 条
- [ ] `buildComments` 的 `count` 被上游忽略（10 / 20 都返回约 20 条）；顶层 `total_number` 含楼中楼 / 不可见评论，不能作为结束条件；`max_id=0` 或空页才是到底
- [ ] `buildComments` 的 hot 排序可能先返回空页（`data: []`、`max_id` 仍非 0），停止条件必须包含空页；`flow=1` 必须用数字 mid，字母 mblogid 会 400
- [ ] `buildComments` 的 `trendsText` 出现「博主已开启防火墙」时，`data` 会少于 `total_number` 且直接 `max_id=0`，属于上游限制
- [ ] 浏览器运行时不要注入 Node-only 的 axios `proxy`
- [ ] Cookie 只从 `.env` 读取；不要回退到环境变量
- [ ] `searchProfile` 的 `q` 与 `starttime` / `endtime` 可组合；`q` 为空/缺省才是不过滤，`data.total` 会随关键词收窄（2026-10-20 实测）
- [ ] 二级评论必须用 `id=<一级评论 id>` + `fetch_level=1`（`is_reply=1` 可选）；传顶层微博 id 或 `fetch_level=0` 均返回空列表
- [ ] `getAlbumDetail` 的 `containerid` 必须来自相册 tab 的 `getImageWall?has_album=true`（`pc_profile_album`）；`/ajax/profile/albumlist` 的 `mobile_profile_album` containerid 可能返回空列表
- [ ] 相册详情的 `since_id` 是**数字/字符串游标**，`0` 到底；不要把它和图片墙的 `sinceid` 参数名混用
- [ ] `stopic/list` 的 `count` 是**总页数**（30 条/页），不是条目总数；`sort_id=0` + `keyword` 才是搜索
- [ ] 视频播放量取 `media_info.online_users_number`，但只在 `online_users` 明确为「N次观看」时映射；直播在线人数不是播放数
- [ ] 置顶标记是微博级 `isTop: 1/true`（非置顶项通常缺省），不要从 `mblogtype` 推断
- [ ] 音频 / 播客在 `page_info.object_type === 'podcast_audio'`，直链是 `media_info.stream_url`（不是视频的 `mp4_*`）
- [ ] `atUsers` 没有结构化字段，只能从 `text` HTML 的用户主页锚点（`/n/` 或 `/u/`）解析；`text_raw` 里的 `//@name:` 是转发链，不是 @ 用户

---

## 5. 评审清单（PR 合并前）

- [ ] 端点定义在 `endpoints/<domain>.ts`，Service 无内联 schema
- [ ] args / response schema 由真实 fixture 验证
- [ ] 分页语义有注释与测试；有重复页保护
- [ ] 错误映射符合 [error-diagnostics.md](./error-diagnostics.md)
- [ ] 公开方法有 TSDoc；CLI 有对应命令
- [ ] `pnpm run typecheck` / `lint` / `test` / `validate:fixtures` / `build` 通过
- [ ] 文档与代码一致（docs-as-truth）
- [ ] `CHANGELOG.md` 已更新（用户可感知变化）

---

## 6. 工具化现状

以下工具已落地（原登记于已归档的 [todo-post-0.1.0.md](../archive/todo-post-0.1.0.md) §5）：

- `pnpm new:endpoint <domain>/<name>`：生成 EndpointSpec 骨架 + checklists
- `pnpm capture:endpoint <url>`：抓包 + 脱敏 + fixture + INDEX 登记
- `sdk.capabilities()` / `weibo-cli capabilities`：能力清单
- `paginate()`：统一 page / cursor / since_id / max_id 分页停止语义
- `diffSchemaDigest()` / `weibo-cli schema diff`：schemaDigest 漂移报告

> CI 检查「新增 endpoint 是否同时登记 fixture、CLI、文档」仍在 backlog。
