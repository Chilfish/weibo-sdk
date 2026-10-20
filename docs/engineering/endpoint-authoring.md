# 端点开发指南（新增 / 修改 Endpoint）

**适用**: 新增微博端点、调整上游参数、扩展响应 Schema、修改分页/错误语义。
**硬约束**: 数据驱动开发（真实 fixture 优先）、`EndpointSpec` 单一路径、每个功能有离线测试、CLI 暴露能力。
**相关**: [technical-spec.md](./technical-spec.md) · [code-style.md](./code-style.md) · [CLI 参考](./cli.md) · [待办清单](../planning/todo-post-0.1.0.md)

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
# 方式 A：浏览器 DevTools 复制请求（推荐先在网页端确认参数）
# 方式 B：项目 capture/（CDP）抓取
pnpm capture -- --help

# 方式 C：curl（Cookie 只从 .env 读取）
curl -s -H "Cookie: $WEIBO_COOKIE" -H "X-XSRF-TOKEN: $TOKEN" \
  -H "User-Agent: ..." -H "Referer: https://weibo.com/..." \
  "https://weibo.com/ajax/..." > tests/fixtures/raw/<name>.json
```

- 至少抓 **2 种变种**（正常 / 空结果 / 边界值 / 不同账号）。
- 按 [fixtures/raw/INDEX.md](../../tests/fixtures/raw/INDEX.md) 脱敏：URL、长 ID、日期、长文本。
- 在 `INDEX.md` 与 `scripts/validate-fixtures.ts` 的 `FIXTURE_RULES` 登记（mapped 或 unmodeled）。
- **未登记 fixture 会导致 `pnpm run validate:fixtures` 失败**。

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
- [ ] `docs/planning/todo-post-0.1.0.md`：勾选任务

---

## 3. 分页约定

| 游标类型 | 典型端点 | Service 返回 | 停止条件 |
|---|---|---|---|
| `page` | `mymblog` / `searchProfile` / `favorites` / `repostTimeline` | `{ page: nextPage, hasMore }` | 空列表 / 整页重复 / `page` 越界重置 |
| `since_id` | `friendstimeline` | `{ sinceId, hasMore }` | 空串 / 0 / 本页不足 |
| `max_id` | `buildComments` | `{ maxId, hasMore }` | 无 `max_id` / 等于上一页 / 达到 total |
| `cursor` | `myCmt` / `getWaterFallContent` | `{ cursor, hasMore }` | 空 cursor / 游标不前进 |
| `sinceid` | `getImageWall` | `{ sinceId, hasMore }` | 空 / 不前进 / 重复 |

**通用保护**：

- 单页按主键去重。
- 整页与上一页完全相同 → 视为到底（上游忽略翻页参数）。
- 游标不前进 → 立即停止，避免死循环。
- 任何自动翻页都要有 `maxPages` 上限（测试/演示可调）。

---

## 4. 高频雷区（写码前自查）

- [ ] `since_id` 真实类型是 `string`（空串表示结束），不是 `number`
- [ ] `total` 可能为 `-1`（防爬），不能直接当真实总数
- [ ] `searchProfile` 的 `starttime` / `endtime` 是 **unix 秒**；日期字符串会被静默忽略（`TweetService.searchByDate` 已在边界把 `YYYY-MM-DD` / `YYYYMMDD` 换算为秒；直接发请求时仍需传秒）
- [ ] `favorites` 的 `data` 是 `{ status, total_number }`，不是数组；顶层另有 `count` / `total_page`
- [ ] `favorites/all_fav` 的 `page` 从 1 开始，`page=0` 会返回 HTTP 400；非法页码应按第一页处理
- [ ] `favorites/all_fav` 的 `tag_id` / `tag` 参数会被上游忽略（2026-10-20 实测），标签过滤只能客户端做
- [ ] `favorites` 的 `total_number` 可能大于实际可翻页条目（含已删除收藏），`hasMore` 优先用 `total_page`
- [ ] `mymblog` 已从 `since_id` 漂移为 `page`；`page` 越界可能重置到较新区间
- [ ] `retweeted_status` / `user` 可能为 `null`
- [ ] `geo` 可能是空字符串、对象或 `null`
- [ ] `pic_infos.width/height` 可能是 `number | string`
- [ ] 非 JSON 响应（登录页 / 风控页）要归为 `API_BAD_RESPONSE`，不要误报 `API_NOT_OK`
- [ ] `buildComments` 缺固定参数会 400（`is_reload` / `is_show_bulletin` / `is_mix` / `type` / `fetch_level`）
- [ ] 浏览器运行时不要注入 Node-only 的 axios `proxy`
- [ ] Cookie 只从 `.env` 读取；不要回退到环境变量

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

## 6. 工具化待办

以下工具已登记在 [todo-post-0.1.0.md](../planning/todo-post-0.1.0.md) §5：

- `pnpm new:endpoint <domain>/<name>`：生成 spec / service / CLI / test 骨架
- `pnpm capture:endpoint <url>`：抓包 + 脱敏 + fixture 登记
- `sdk.capabilities()` / `weibo-cli capabilities`：能力清单
- `paginate()` / `CursorPager`：统一分页
- CI 检查：新增 endpoint 是否同时登记 fixture、CLI、文档
