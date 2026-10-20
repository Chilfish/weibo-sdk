# 行动计划：无登录访客模式（Guest Mode）

**来源**：[research-guest-mode-2026-10-20.md](./research-guest-mode-2026-10-20.md)（真实探针与端点矩阵）、[backlog.md](./backlog.md) G1–G7。
**目标**：在不提供个人 Cookie 的前提下，用移动端访客 token 读取公开数据；能力边界显式表达，不静默降级，不把访客自身数据当成目标账号数据。

## 已拍板的产品决策

| 决策 | 结论 | 理由 |
|---|---|---|
| `auto` 是否允许 Cookie 失效后降级 guest | **不允许** | 归档完整性会无声变化；只有构造时没有 Cookie，或显式 `auth: 'guest'` 才走访客 |
| guest 是否默认开放 `archive` | **不开放** | 完整时间线仍需 Cookie；guest 下 `streamArchive` 直接抛 `CONFIG_INVALID` |
| `users.timeline` 的 guest 语义 | **返回 m 站第一页并标注 `partial: true`** | 不静默只给 10 条；类型 / 文档 / capabilities 同时标注 `first_page` |
| 搜索能力状态（G5） | **本期不改**，仍为 `unavailable` | backlog 记录为「产品暂缓」，需产品确认后再改 `degraded` |
| 桌面 `genvisitor2` token | **仅作 `issuer: 'auto'` 兜底** | 移动端 token 同时覆盖 `weibo.com` 与 `m.weibo.cn`，默认只维护一种身份 |
| CLI 形态 | `--guest` 糖，底层映射 `auth: 'guest'` | 显式开关，不读取 `.env` Cookie |

## 实施范围

### G1 鉴权基础设施（P0）

- `IWeiboConfig`：`cookie` 改为可选；新增 `auth: 'auto' | 'cookie' | 'guest'` 与 `guest: { token?, issuer?, autoRefresh? }`。
- `GuestTokenService`：移动端 `genvisitor → incarnate`；JSONP body + `Set-Cookie` 双解析；实例级缓存 + single-flight；刷新失败保留旧 token；不写磁盘、不记录 token 明文。
- `AuthProvider`：`CookieAuthProvider` / `GuestAuthProvider` / `NoAuthProvider`；`FetcherService` 按端点声明的 `auth` 选择 provider。
- 鉴权失败统一分类：302 登录页 / visitor 入口、`{ ok: -100 }`、403 登录文案、`{}` 静默门控、HTML、432/429。每个请求最多刷新一次；432 不刷新。

### G2 端点鉴权声明（P0）

- `EndpointSpec.auth: 'cookie' | 'guest' | 'none'`，默认 `cookie`。
- `none`：热搜榜无 Cookie 也可用、feed 分组、媒体 CDN。
- `guest`：用户资料 / 详情、单条微博、长文、评论、转发、点赞者、图片墙 / 视频 / 相册、超话、热搜、手机容器第一页。
- `cookie`：`mymblog`、首页关注时间线、个人主页日期搜索、点赞列表、关注 / 粉丝、收藏、通知、@我、历史评论、微博分组。

### G3 会话与归档守卫（P0）

- guest 下 `getSession()` 不调用 `myDetails`，返回 `{ authMode: 'guest', uid: undefined }`；自检只检查 token 可用性。
- `ArchiveService` 在 guest 下抛 `CONFIG_INVALID`；收藏 / 历史评论的账号级守卫保持不变。

### G4 m 站第一页端点（P1）

- 新增通用 `m.weibo.cn/api/container/getIndex` spec 与归一化：用户时间线（`107603<uid>`）、点赞（`230869<uid>`）、关注（`231051_-_followers_-_<uid>`）、粉丝（`231051_-_follows_-_<uid>`）。
- m 站微博没有 `mblogid`：按真实样本补 `midToMblogId(mid)` 纯函数（已用 `5039815108333719 ↔ OgHLUyXYP` 验证）。
- Service 仅在 `authMode === 'guest'` 时走 mobile spec；Cookie 路径不回归。`partial: true` 明确标注第一页。
- 媒体 / 超话 / 热搜在 guest 下继续走 PC 端点（可翻页），不新增重复路径。

### G6 CLI（P1）

- 所有命令支持 `--guest`；开启时不读取 `.env` Cookie。
- `whoami --guest` 输出 `{ auth: 'guest', login: false, tokenIssuedAt }`，退出码 0。
- `capabilities` 输出新增 `auth` / `guestPagination` / `guestNote`。

### G7 Fixtures + E2E（P2）

- 新增 `tests/fixtures/raw/mobile_*` 真实样本（2026-10-20 抓取）并登记 INDEX / `FIXTURE_RULES`。
- 默认离线；guest E2E 用 `WEIBO_GUEST_E2E=1` 独立门控，432 记 skip。

## 测试计划（默认离线）

| 层 | 用例 |
|---|---|
| Unit | JSONP 解析、Set-Cookie 解析、token 发放成功 / 无 tid / 无 SUB、single-flight、刷新失败保留旧 token、`midToMblogId` 已知对 |
| Unit | 配置矩阵：`auto` / `cookie` / `guest` × 有 / 无 Cookie |
| Component | 首次请求发放 token、第二请求复用、302 刷新一次后成功、连续两次失败抛 `AUTH_SESSION_EXPIRED`、432 不刷新、`none` 不注入 Cookie |
| Component | mobile 第一页归一化（timeline / likes / followings / fans）、`partial: true`、Cookie 路径不回归 |
| Component | guest `ArchiveService` 拒绝、session 不调用 `myDetails` |
| E2E | guest smoke（显式开启）：详情 / 评论第一页 / 用户资料 / 热搜 / 时间线第一页 |

## 交付顺序与提交计划

1. `docs: plan guest mode implementation`
2. `feat(auth): add guest token service and auth providers`
3. `feat(endpoints): declare guest-capable endpoints and add mobile container spec`
4. `feat(services): add guest first-page reads and archive guard`
5. `feat(cli): add --guest mode`
6. `test(guest): cover token issuance, auth retry, mobile pages`
7. `docs: document guest mode and refresh fixtures`

## 风险与边界

- 访客 token 发放接口自身会限流：缓存 + single-flight，只有明确鉴权失败才刷新。
- m 站 container 匿名只有第一页；第 2 页 / `since_id` 会 302 登录页，不承诺完整归档。
- 上游可能漂移：guest 可用性以 fixture + E2E 监控；错误 context 带 `auth_mode` 与端点。
- 「假成功」端点（收藏 / 通知 / @我 / 历史评论 / 微博分组）继续要求 Cookie，不因 `ok: 1` 放行。
