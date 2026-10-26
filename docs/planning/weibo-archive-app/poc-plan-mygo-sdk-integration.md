# POC 计划：在 MyGo 里跑通 SDK

> **目标**：用最小成本证明「MyGo 桌面端 + WebView 前端 + `@chilfish/weibo-sdk`」这条链路成立，再决定是否进入正式构建。
> **范围**：只做技术验证，不做正式 UI、不做视觉设计、不做安装包美化。
> **前置阅读**：[调研事实](research-mygo-app-2026-10-26.md) §5–§7。
> **代码位置**：独立仓库（建议 `weibo-archive-app`）；本仓库只保留文档与所需的 SDK 变更。

---

## 1. 验收总则

POC 通过 = 下面四条同时成立：

1. WebView 里能 `import '@chilfish/weibo-sdk/browser'` 并调用公开方法。
2. 真实微博请求经 MyGo fetch 发出，不触发 CORS，Cookie / Referer / UA 可控。
3. 登录窗口拿到的 Cookie 能驱动 SDK；归档一个切片并落 SQLite，杀进程后可续跑。
4. `mygo build` 在 Windows 与 macOS 产出可运行的包。

任一致命项失败 → 按 §7 回退 Electron，不继续投入。

---

## 2. 仓库与骨架

```
weibo-archive-app/
├─ go.mod
├─ mygo.config.ts
├─ main.go                 # mygo.App、窗口、Bind、fetch 插件
├─ services/               # Go 绑定（auth / store / media）
├─ src/                    # 前端（Vite + TS）
│   ├─ mygo.ts             # mygo generate 生成，勿手改
│   ├─ platform/           # desktop / web 两套实现
│   └─ poc/                # POC 页面，正式 UI 之前的临时入口
└─ sqlite/                 # schema 与迁移
```

约定：

- `package.json` 固定 SDK 版本：`"@chilfish/weibo-sdk": "0.6.0"`（POC 期间不用 `^`）。
- Go 版本与 MyGo 版本在 README 固定，不用浮动版本。
- 前端不直接 import `./mygo`；统一走 `src/platform`，为后续网页查看器留口。

---

## 3. 里程碑

### M0 — 骨架与加载（无网络）

**目的**：证明浏览器入口能在系统 WebView 里跑起来。

步骤：

1. `mygo init` 建项目，选 Web 前端模板（Vite + TS）；确认 `mygo dev` 能开窗。
2. 安装 `@chilfish/weibo-sdk@0.6.0`，在页面里：

   ```ts
   import { WeiboSDK, listCapabilities } from '@chilfish/weibo-sdk/browser'

   console.log(listCapabilities().length)
   ```

3. 用假 transport 构造实例，确认类能实例化：

   ```ts
   const sdk = new WeiboSDK({
     cookie: 'SUB=placeholder',
     transport: { send: async () => ({ status: 200, headers: {}, data: { ok: 1 } }) },
   })
   ```

4. 记录 `mygo build` 的产物体积（三端各一次）。

**验收**

- [ ] `mygo dev` 页面无报错，`listCapabilities()` 返回数组。
- [ ] 构建产物能启动，控制台输出正常。
- [ ] 记录 SDK + 前端的包体增量。

**失败处理**：若 zod / axios 在 WebKitGTK 或 WebView2 里报错，先用 `vite build` 的 target / polyfill 排查；仍失败则记录具体错误，进入 §7 评估 sidecar。

---

### M1 — Go fetch 接进 SDK（真实请求）

**目的**：证明 `fetchTransport({ fetch })` 与 MyGo fetch 语义兼容。

Go 侧：

```go
jar, _ := cookiejar.New(nil)
mygo.Use(fetch.New(fetch.Options{
    Client: &http.Client{Jar: jar, Timeout: 30 * time.Second},
    Allow: func(r *http.Request) bool {
        h := r.URL.Hostname()
        return h == "weibo.com" || strings.HasSuffix(h, ".weibo.com") ||
            h == "weibo.cn" || strings.HasSuffix(h, ".weibo.cn")
    },
}))
```

前端：

```ts
import { fetch as goFetch } from '@mygo-plugins/fetch'
import { WeiboSDK, fetchTransport } from '@chilfish/weibo-sdk/browser'

const sdk = new WeiboSDK({
  cookie: localStorage.getItem('poc-cookie')!, // 仅 POC；M2 后移除
  transport: fetchTransport({ fetch: goFetch }),
})
const page = await sdk.tweets.listByUserId('7679065628')
```

**验收**

- [ ] 请求成功返回归一化 `ITweet`，浏览器控制台无 CORS 报错。
- [ ] 错误映射正确：坏域名 → `NET_REQUEST_FAILED`；短超时 → `NET_TIMEOUT`。
- [ ] `redirect: 'manual'` 路径可用（用会 302 的端点验证，至少确认不抛异常）。
- [ ] 非 JSON 响应（错误页 / 登录页）被识别为 `API_BAD_RESPONSE`。
- [ ] 请求头里带上了 Cookie、`Referer: https://weibo.com/`、自定义 UA。

**备注**：SDK 的 `FetchTransport` 用 `AbortController` 做超时，MyGo fetch 支持 abort；若发现 `TransportFailure` 分类不准，先在小适配层归一化，不改 SDK。

---

### M2 — 登录窗口与 Cookie

**目的**：普通用户不需要复制 Cookie。

步骤：

1. 打开登录窗口：`mygo.NewWindow({ URL: "https://passport.weibo.com/sso/signin", ... })`（URL 以实际登录页为准）。
2. 用户完成登录后，Go 轮询 / 等待窗口导航回 `weibo.com`，读取：

   ```go
   cookies, err := mygo.Cookies.List(mygo.CookieFilter{Domain: "weibo.com"})
   ```

3. 拼成 Cookie header 串（`name=value; ...`），通过绑定 `Auth.cookie()` 交给前端；SDK 用 `auth: 'cookie'`。
4. 关闭登录窗口；主窗口继续。

**验收**

- [ ] Windows（WebView2）与 macOS（WKWebView）各跑一次都能拿到含 `SUB=` 的 Cookie。
- [ ] `sdk.getSession()` 返回 `authMode: 'cookie'` 且 `profile` 有数据。
- [ ] Cookie 没有写入 `localStorage` / `IndexedDB` / 日志；只有 Go 内存与 SDK 实例持有。
- [ ] 退出登录：`Cookies.Delete` + `store.clear()` 后，再请求得到 `AUTH_SESSION_EXPIRED`。

**失败处理**：若 `mygo.Cookies` 在 Windows 上拿不到，改为在登录窗口中 `Page.Eval` 读取（拿不到 HttpOnly，需另找方案）；仍失败则退回「读取已安装浏览器 Cookie」或「用户手动粘贴」，但要标注 UX 降级。

---

### M3 — 归档一个切片 + SQLite 续跑

**目的**：证明范围归档与断点续跑在桌面端成立。

步骤：

1. 建最小 SQLite schema（POC 版）：

   ```sql
   create table meta(key text primary key, value text not null);
   create table slices(key text primary key, done integer not null default 0, json text);
   create table checkpoints(slice_key text primary key, json text not null);
   create table records(mblog_id text primary key, slice_key text not null, json text not null);
   create table issues(id integer primary key autoincrement, slice_key text, json text not null);
   ```

2. Go 实现 `Store` 绑定，缓存写入（每 N 条或每 M 毫秒 flush 一次），避免每条都跨进程。
3. 前端实现 `UserArchiveStore` 适配器，把方法转到绑定。
4. 跑 7 天切片：

   ```ts
   const events = sdk.userArchive.stream(uid, {
     since: '2025-01-01',
     until: '2025-01-07',
     includeComments: true,
     includeReplies: true,
     store,
     onProgress: p => console.log(p),
   })
   for await (const e of events) { /* 转发到 Go 事件 / UI */ }
   ```

5. 跑到一半 `kill` 进程，重开，再跑同一配置。

**验收**

- [ ] 首次运行产出记录数 > 0，`done` 摘要的 `tweets/comments/replies/errors` 合理。
- [ ] 第二次运行 `slice-start.resumed === true`，记录不重复（`mblog_id` 唯一约束不冲突）。
- [ ] 杀掉进程后最多丢失最后一页内的记录（at-least-once 语义，符合 SDK 文档）。
- [ ] 进度事件连续、无跳变；UI 线程不卡（长任务不阻塞渲染）。
- [ ] 最小化窗口 5 分钟后，进度继续（验证 A6）。

**失败处理**：若跨进程写入太慢，改为「Go 侧批处理队列 + SQLite 事务」；若页面被节流，评估隐藏 worker 页。

---

### M4 — 媒体落盘

**目的**：证明图片 / 视频能带 Referer 下载并关联回记录。

步骤：

1. Go 绑定 `Media.download(items []MediaItem) ([]MediaResult, error)`，`MediaItem` 含 `url` / `referer` / `destPath`。
2. 复用 M1 的 `http.Client`（Jar + UA + Referer）。
3. 前端从 `ITweet.media` 收集 URL，下载到 `~/Pictures/WeiboArchive/<uid>/<mblogId>/`（路径由 Go 决定）。
4. 失败（403 / 404 / 过期）记录 issue，不阻塞整条归档。

**验收**

- [ ] 50 张图片成功率 > 95%；失败项有结构化原因。
- [ ] 构造过期 URL：识别为失败并写入 issue，不崩溃。
- [ ] 文件大小 / 扩展名正确；并发上限可配置（默认 4）。
- [ ] 路径写入数据库，查看器能直接读本地文件。

---

### M5 — 打包冒烟

**目的**：证明能交付给普通用户。

步骤：

1. `mygo build` 产出 Windows exe + 安装器、macOS app + dmg。
2. 在干净 Windows 10/11（无开发环境）与 macOS 上安装运行。
3. 记录体积、首次启动时间、WebView2 是否已内置。
4. 如有签名证书，走一次签名 / 公证；没有则记录未签名时的系统提示。

**验收**

- [ ] 两端安装后可完成 M2 + M3 的最小流程。
- [ ] 体积在可接受范围（记录实测值，不预设阈值）。
- [ ] 卸载 / 重装后本地数据仍可读（用户数据目录不随 app 删除）。
- [ ] 未签名包的提示被记录，后续列入发布待办。

---

## 4. POC 期间的代码约束

- **不改 SDK 核心**。需要的适配（transport 归一化、store、媒体）都放 app 仓库。
- 若必须改 SDK（例如 `FetchLike` 缺字段），先在本仓库提 issue / 设计，并补测试与 `api-surface` 更新。
- 不在 POC 里做：正式 UI、i18n、自动更新、旧归档导入、搜索、分享。
- POC 页面允许 JSON 直出，不做设计评审。

---

## 5. 需要同步到本仓库的产物

即使代码在 app 仓库，以下内容应回写到 SDK 仓库：

- 若发现 `fetchTransport` 与标准 fetch 的兼容问题：补测试，必要时改 `FetchLike`（Evolving）。
- 若 `UserArchiveStore` 的契约不够用（例如缺 `saveMeta` 的并发保证）：先写 ADR，再改。
- 若 `media` 的 Node 实现无法复用：在 backlog 记 `MediaStore` / 下载器端口（EX5）。
- 新的真实 fixture（登录响应、媒体失败响应）按 `tests/fixtures/raw/INDEX.md` 规则脱敏后入库。

---

## 6. Go / No-Go 判据

| 结果 | 条件 | 动作 |
|---|---|---|
| **Go** | M0–M5 全部通过，A1–A5 无阻塞 | 进入 [构建方案](build-plan.md) |
| **条件 Go** | 仅 A6（后台节流）或 A7（WebView2 运行时）有问题 | 继续，但在方案里写明规避 |
| **No-Go** | A1 / A2 / A3 任一失败且无低成本替代 | 回退 Electron；SDK 与前端不变 |

---

## 7. 回退 Electron 的影响面

如果 MyGo 不成立，迁移成本主要在宿主层：

| 层 | 是否复用 |
|---|---|
| SDK | 完全复用（Electron 主进程直接 import） |
| 前端 UI | 完全复用（同一套 Vite 产物） |
| `Platform` 接口 | 复用；只换 `desktop` 实现 |
| SQLite | 复用（better-sqlite3 或 sql.js） |
| 登录 | 换成 `session.cookies`（更成熟） |
| 分发 | 换成 electron-builder；体积变大 |

因此 POC 的价值不因回退而浪费：`Platform` 抽象、store 契约、数据 schema 都能留下。

---

## 8. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| MyGo API 年轻、跨平台边缘 bug | 高 | 固定版本；M0 即验证三端；保留回退 |
| 系统 WebView 版本差异（WebKitGTK 旧版） | 中 | 明确最低系统要求；必要时提示升级 |
| Windows WebView2 未安装 | 中 | 安装器检测 / 引导；记录在 M5 |
| 长任务被页面生命周期打断 | 中 | store 续跑；关闭前确认；后续评估 worker 页 |
| Cookie 泄露到前端 | 高 | 只经 Go 绑定传递；不落 localStorage；日志脱敏 |
| 微博风控（432） | 中 | 沿用 SDK 的 `delay` / `burst` / 全局暂停；不做并发轰炸 |
| 签名 / 公证账号成本 | 中 | M5 记录；正式发布前解决 |

---

## 9. 提交与工作方式

- app 仓库按里程碑提交，每个里程碑一个可回滚的 commit（或小 PR）。
- 文档先行只针对「公开契约 / 新端点 / 事故」；POC 属于内部验证，当天在 app 仓库与 SDK 仓库的开发日志各补一条即可。
- M1 / M2 完成后先给结论（通过 / 失败 / 需要改 SDK），再继续，不一次性做完。
