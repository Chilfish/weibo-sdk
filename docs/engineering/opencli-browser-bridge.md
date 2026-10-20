# OpenCLI Browser Bridge — 复用已登录 Chrome 的抓包与浏览器操作手册

> **状态**：2026-10-20 实测通过（OpenCLI 2.0.0 / 扩展 1.0.25 / Chrome 153，账号 uid `7679065628`）。
> **用途**：数据驱动开发时**最快的一条**真实响应获取路径——不导出 Cookie、不重启 Chrome，直接复用当前已登录标签页。
> **相关**：[endpoint-authoring.md](./endpoint-authoring.md)（抓包 → fixture 标准流程） · [`capture/README.md`](../../capture/README.md)（CDP 通道的 API / CLI 契约） · [browser-capture.md](./browser-capture.md)（CDP 通道的方案选型记录）

---

## 1. 三种抓包路径怎么选

本节是两条浏览器通道**唯一的选型入口**；其他文档只做引用，不重复对比。

| 路径 | 登录态来源 | 能做 | 不能做 |
|---|---|---|---|
| **OpenCLI browser bridge**（本文） | 用户正在用的 Chrome | 端点复放、**发现未知端点**（`network` shape 预览）、点击 / 滚动触发的 XHR、快速取真实响应 | CI / 无人值守 / 批量回归 |
| `capture/` + `pnpm capture`（CDP） | `.env` 的 `WEIBO_COOKIE` + 独立 profile | 可复现批量抓取、脚本化、headless、离线测试 | 主动点击；登录态过期后需重新导出 Cookie |
| 手工 DevTools | 用户浏览器 | 一次性深挖 | 不可复现 |

判断口诀：**要「点出请求」或「看请求长什么样」→ OpenCLI；要「跑批 / 固化 / 进流水线」→ `capture/`。**
`capture/` 只能导航后被动收集响应，因此未知端点发现这一步绕不开 OpenCLI。

---

## 2. 前置检查

```bash
opencli doctor          # 期望 daemonRunning=true、extensionConnected=true、issues=[]
opencli weibo whoami    # 期望 logged_in=true、user_id=<uid>
```

若扩展未连接：`opencli daemon restart`，或在 Chrome 里确认 OpenCLI 扩展已启用。

---

## 3. 会话模型（必须先理解）

- 所有页面命令都要求 `--session <name>`；一个 session 对应一个标签页租约。
- `open`：在该 session 打开/复用标签页；`bind`：直接接管**当前** Chrome 标签页；`close`：释放租约；`unbind`：只解绑、不关用户标签页。
- `--window background` 避免抢焦点（默认可能是前台）。
- **一个 host 一个 session**：跨域 `fetch` 会被 CORS 拦（实测从 `weibo.com` 调 `m.weibo.cn` 直接 `TypeError: Failed to fetch`）。

```bash
# 开一个新标签
opencli browser open "https://weibo.com" --session wb --window background

# 或接管用户已经打开的标签
opencli browser bind --session wb2 --window background

# 用完释放（不会关用户的标签页）
opencli browser close --session wb
```

---

## 4. 路径 A：复放已知端点（最快）

在页面上下文里 `fetch`，自动带 Cookie：

```bash
opencli browser eval "fetch('/ajax/profile/info?uid=7679065628',{credentials:'include'}).then(r=>r.json())" --session wb
```

实测要点：

- `eval` 会 **await Promise**，直接返回 JSON 结果。
- 大响应可以完整带回：162KB 的 `friendstimeline` 经 CLI 输出约 184KB，无截断。
- **不要直接导航到 `/ajax/...`**：浏览器会带 `Sec-Fetch-Dest: document`，实测返回 `{"error":"Forbidden"}`。必须在页面内用 `fetch`。
- 跨 host 端点（`m.weibo.cn/api/...`）要切到对应 host 的 session：

```bash
opencli browser open "https://m.weibo.cn/status/<id>" --session wbm --window background
opencli browser eval "fetch('/api/attitudes/show?id=<mid>&page=1',{credentials:'include'}).then(r=>r.json())" --session wbm
```

**省 token 的写法**：只回传结论字段，不把整页数据打到终端。

```bash
opencli browser eval "fetch('/ajax/feed/friendstimeline?refresh=4&count=25',{credentials:'include'}).then(r=>r.json()).then(j=>({ok:j.ok,n:j.statuses.length,maxId:j.max_id,keys:Object.keys(j)}))" --session wb
```

需要落盘时直接重定向（Windows PowerShell 用 `$env:TEMP` 替代 `/tmp`）：

```bash
opencli browser eval "fetch('/ajax/profile/getImageWall?uid=<uid>&sinceid=0',{credentials:'include'}).then(r=>r.text())" --session wb > /tmp/raw.json
```

---

## 5. 路径 B：发现未知端点（让页面自己发请求）

这是比「猜 URL」高效得多的方式：打开对应页面/标签，读它自己发出的 XHR。

```bash
# 1) 打开目标页面（示例：相册 tab 会触发 getImageWall / getAlbumDetail）
opencli browser open "https://weibo.com/u/<uid>?tabtype=album" --session wb --window background

# 2) 看请求形状（不返回 body，只有 shape 预览）
opencli browser network --session wb
opencli browser network --since 30s --session wb

# 3) 按响应顶层字段过滤
opencli browser network --filter "data" --session wb

# 4) 取某个请求的完整 body
opencli browser network --detail "GET weibo.com/ajax/profile/getImageWall" --session wb
```

实测要点：

- `network` 的 `shape` 是「路径 → 类型/长度」的扁平预览，非常适合快速判断字段类型（例如 `$.data.list: array(24)`、`$.data.since_id: string`）。
- **`--filter` 只匹配顶层 key**：`data` / `ok` 能命中，`list`、`statuses`、`data.list` 都命中不了（实测 2026-10-20）。需要按嵌套字段找，先用 `shape` 人工扫。
- 多个 key 用逗号表示 AND：`--filter "data,ok"`。
- `--detail` 返回 `{ key, url, method, status, shape, request, body }`，其中 **`body` 已解析为对象**；`request` 只有 headers / body_kind / body_size，**不含 POST body 原文**。
- 同名请求会有 `#2` / `#3` 后缀（如 `GET weibo.com/ajax/log/read#2`）。
- 抓包缓冲是**短时间窗**：触发后尽快读；连续观察用 `--follow`（NDJSON 流）。
- `--all` 会带上静态资源；`--failed` 只看失败请求。
- **慎用 `--raw`**：会把每个响应完整输出，`/ajax/statuses/config` 单条就有 747KB。

2026-10-20 实测首页/个人页可捕获的代表性端点：

| 端点 | 触发方式 | 用途 |
|---|---|---|
| `/ajax/feed/friendstimeline` | 打开首页 | 首页「最新微博」（`max_id` 分页） |
| `/ajax/feed/unreadfriendstimeline` | 打开首页 | 未读时间线（278KB） |
| `/ajax/profile/info` | 打开个人页 | 用户资料 |
| `/ajax/profile/detail` | 打开个人页 | 用户详情（`hometown` 等） |
| `/ajax/profile/getImageWall` | 打开相册 tab | 图片墙 / 相册列表 |
| `/ajax/feed/allGroups` | 打开首页 | 分组列表 |
| `/ajax/side/hotSearch` | 打开首页 | 热搜 |
| `m.weibo.cn/api/attitudes/show` | 在 m 站打开微博 | 点赞者（网页端 `likeShow` 为空） |

---

## 6. 路径 C：模拟操作触发（点击 / 滚动 / 弹窗）

```bash
# 1) 读页面快照，拿 [N] 数字引用
opencli browser state --session wb
# snapshot 很大（几十 KB），建议本地过滤：
opencli browser state --session wb | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.snapshot.split('\n').filter(l=>/评论|相册/.test(l)).join('\n')))"

# 2) 点击（数字引用最稳）
opencli browser click 68 --session wb

# 3) 等待由操作触发的 XHR（注意：选项要写在类型前面）
opencli browser wait --timeout 8000 xhr "/buildComments" --session wb

# 4) 回读抓到的请求
opencli browser network --since 30s --session wb
```

实测要点与坑：

- **数字引用最可靠**；`find --text "换一换"` 这类语义定位对「非交互 span」会返回 `semantic_not_found`（实测）。退路：用 `state` 找最近的 `[N]`，或 `eval` 直接调 `element.click()`。
- `find` / `click` 不能同时给 `--css` 和语义参数（会 `usage_error`）。
- `wait --timeout` 必须放在 `xhr` 之前；`wait xhr ... --timeout` 会报 `unknown option`。
- `wait xhr` **只等待未来发生的匹配**：先点击再 wait 会 `xhr_not_seen`。要么先起 wait（另开终端 / 后台），要么直接看 `network`。
- 其他可用操作：`fill` / `type` / `select` / `check` / `upload` / `scroll` / `keys` / `dialog` / `screenshot` / `extract`。
- **只读原则**：不要点「发微博 / 转发 / 评论 / 关注 / 删除」等写操作。

---

## 7. 从抓包到 fixture（标准闭环）

```bash
# 1) 取完整 body（envelope -> data.body）
opencli browser network --detail "GET weibo.com/ajax/profile/getImageWall" --session wb \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s).data.body)))" \
  > /tmp/raw.json

# 2) 脱敏
node scripts/sanitize-raw.mjs /tmp/raw.json tests/fixtures/raw/<name>.json

# 3) 在 tests/fixtures/raw/INDEX.md 登记端点与分页语义
# 4) 在 scripts/validate-fixtures.ts 的 FIXTURE_RULES 登记（mapped / unmodeled）
# 5) 校验
pnpm run validate:fixtures

# 6) 按 endpoint-authoring.md 写 schema / service / CLI / 测试
```

> 至少抓两种变体：正常页 + 空页/越界页。分页游标保留真实值，其余按 INDEX 规则脱敏。

---

## 8. 安全与边界

1. **只读**：只做导航、读取、点击只读控件；不触发发帖/点赞/转发/评论/关注。
2. **不导出 Cookie**：整个流程复用浏览器登录态，不需要也不应该把 Cookie 写进命令或文件。
3. **不入库原始数据**：抓到的响应含真实 uid / 昵称 / 正文，必须先跑 `sanitize-raw.mjs`。
4. **尊重限流**：不要循环轰炸同一端点；出现 403/432 时停手。
5. **避免噪音端点**：`/ajax/log/*`、`reportTipsAd`、`rm.api.weibo.com` 的 403 属正常，不要当业务失败。

---

## 9. 排障

| 症状 | 处理 |
|---|---|
| `Page commands require --session <name>` | 所有页面命令都加 `--session` |
| `extensionConnected: false` | `opencli daemon restart`；确认扩展启用 |
| `semantic_not_found` | 改用 `state` 的数字引用或 `eval` 点击 |
| `xhr_not_seen` | wait 只能等未来的 XHR；改用 `network --since` |
| `network` 为空 | 页面没发请求 / session 绑错 host / 缓冲区已过期 |
| 直接打开 `/ajax/...` 返回 Forbidden | 必须页面内 `fetch` |
| 跨 host `Failed to fetch` | 在目标 host 的 session 里执行 |
| `--filter` 命中 0 | 只用顶层 key；嵌套字段先看 `shape` |
| 输出被截断 | 不要用 `--raw`；用 `--detail` + 字段投影 |

---

## 10. 参考

- OpenCLI Browser Bridge 文档：<https://opencli.info/docs/guide/browser-bridge.html>
- 本仓库既有实践：[development-log/2026-10-20.md](../development-log/2026-10-20.md)
