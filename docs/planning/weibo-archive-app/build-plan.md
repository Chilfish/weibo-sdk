# 构建方案：MyGo 桌面端（POC 通过后）

> **前置**：[POC 计划](poc-plan-mygo-sdk-integration.md) 的 M0–M5 通过。
> **本文回答**：POC 证明可行之后，应用怎么搭、数据怎么存、界面怎么分层、怎么发布。

---

## 1. 产品目标与主流程

**一句话**：非技术用户下载应用、扫码登录、点一次「开始备份」，就能在最长时间内拿到自己的完整微博（含评论、转发、图片、视频），并离线浏览、搜索、导出。

主流程只允许三步：

1. **登录**：应用内嵌登录窗口，用户扫码 / 输密码；不要求粘贴 Cookie。
2. **备份**：一个主按钮；默认参数（最近 N 年、评论 2 页、楼中楼 2 页、视频可选）；显示切片进度、已抓条数、预计剩余、失败项。
3. **浏览**：时间线、日历、搜索、图片墙、单条详情（评论 / 转发展开）、导出。

任何「时间范围 / 并发 / 限速」都属于高级选项，默认折叠。

---

## 2. 架构

```
MyGo（Go 主进程）
├─ 主窗口 ── 自有前端（Vite + TS + UI 框架）
│    └─ @chilfish/weibo-sdk/browser
│         ├─ transport = fetchTransport({ fetch: goFetch })
│         ├─ userArchive.stream({ store: goStore })
│         └─ 事件 / 进度 → Go（Bind / Event）
├─ 登录窗口（passport.weibo.com）
├─ services/
│    ├─ Auth      mygo.Cookies.List / Delete
│    ├─ Fetch     @mygo-plugins/fetch + http.Client(Jar)
│    ├─ Store     SQLite：records / checkpoints / issues / FTS
│    ├─ Media     http.Client + Referer + 文件写入
│    └─ Export    ArchiveFile / 旧归档导入 / 打包导出
└─ 原生能力：文件对话框、托盘、单实例、深链接、更新
```

**原则**

- 抓取逻辑只有一份：SDK。Go 不实现任何微博端点。
- 前端不直接 `import` `mygo.ts`；统一走 `Platform` 接口，为网页查看器保留实现。
- 数据以 `weibo-user-archive/v2` 为交换格式；应用内部可以用 SQLite 索引，但导出必须回到 v2。

---

## 3. 数据层

### 3.1 SQLite schema（草案）

```sql
-- 账号与运行状态
create table accounts (
  uid        text primary key,
  profile    text not null,          -- IUser JSON
  created_at text not null
);

create table runs (
  id         integer primary key autoincrement,
  uid        text not null,
  config     text not null,          -- 归档参数快照
  created_at text not null,
  finished_at text
);

-- 归档内容
create table tweets (
  mblog_id   text primary key,
  uid        text not null,
  created_at text not null,          -- 用于时间线 / 日历
  is_original integer not null default 1,
  json       text not null           -- ITweet JSON
);

create table comments (
  mblog_id   text not null,
  comment_id text primary key,
  parent_id  text,                   -- 楼中楼
  floor      integer,
  created_at text,
  json       text not null
);
create index comments_by_tweet on comments(mblog_id, floor);

create table media (
  media_id   text primary key,
  mblog_id   text not null,
  kind       text not null,          -- image / video / gif / livephoto / audio
  source_url text not null,
  local_path text,
  bytes      integer,
  downloaded_at text
);
create index media_by_tweet on media(mblog_id);

create table media_issues (
  id integer primary key autoincrement,
  media_id text,
  code text not null,
  message text not null,
  created_at text not null
);

-- 续跑
create table slices (
  run_id integer not null,
  slice_key text not null,
  done integer not null default 0,
  json text not null,
  primary key (run_id, slice_key)
);
create table checkpoints (
  run_id integer not null,
  slice_key text not null,
  json text not null,
  primary key (run_id, slice_key)
);
create table issues (
  id integer primary key autoincrement,
  run_id integer,
  slice_key text,
  stage text not null,
  mblog_id text,
  code text not null,
  json text not null,
  created_at text not null
);

-- 搜索
create virtual table tweets_fts using fts5(
  mblog_id unindexed, text, tokenize = 'unicode61'
);
```

说明：

- 应用内部 schema 不属于公开契约，可自由演进；导出时生成 `ArchiveFile`。
- `ITweet` JSON 原样保存，避免应用 schema 与 SDK 字段同步漂移；索引列只放查询需要的字段。
- FTS 用 SQLite 自带 `unicode61`；中文分词先不做，后续可换 trigram / jieba 扩展。
- 老归档导入单独建表（`legacy_posts` / `legacy_comments` / `legacy_followings` / `legacy_favorites`），转换成功的写入 `tweets` / `comments`，失败或缺失的保留原样可查看。

### 3.2 续跑语义

- `UserArchiveStore` 直接映射到 `slices` / `checkpoints` / `issues` / `tweets` + `comments`。
- `appendRecord` 用事务写 `tweets` + `comments`；`mblog_id` 主键天然去重。
- 进程被杀：最多重放最后一页（SDK 文档的 at-least-once 语义），UI 按 `mblog_id` 去重展示。
- 「继续上次备份」在首页常驻，不需要用户重新选参数。

### 3.3 导出

- 导出 `weibo-user-archive/v2`：从 SQLite 组装 `ArchivedTweet`，保留 `complete` / `stats` / `issues`。
- 导出「old-style 查看器 JSON」：只在需要兼容老网页查看器时提供，标注有损。
- 媒体导出：目录 + `media.json` 映射，或直接打包 zip。

---

## 4. 前端

### 4.1 选型

两种都可行，按团队熟悉度选，不要混：

| 方案 | 优点 | 代价 |
|---|---|---|
| Vue 3 + shadcn-vue | 老项目组件与设计可参考，迁移快 | 生态偏旧的部分需要自己补 |
| React 19 + Base UI / coss + Tailwind v4 | 现代默认，AI 辅助与组件生态新 | 前端从零开始 |

约束：

- 构建用 Vite；产物是纯静态文件，交给 MyGo 打包。
- 路由用 hash 或 memory（`mygo://localhost` 下避免 history 刷新 404）。
- 长列表用虚拟滚动；图片懒加载 + 本地路径优先。
- 不在渲染层做网络请求；所有请求经 `Platform`。

### 4.2 Platform 接口

```ts
export interface Platform {
  auth: {
    login: () => Promise<{ uid: string }>
    logout: () => Promise<void>
    status: () => Promise<{ signedIn: boolean, uid?: string }>
  }
  archive: {
    start: (options: ArchiveOptions) => Promise<{ runId: number }>
    cancel: (runId: number) => Promise<void>
    progress: (runId: number, cb: (p: Progress) => void) => () => void
    resume: (runId: number) => Promise<void>
  }
  store: UserArchiveStore
  media: {
    download: (items: MediaItem[]) => Promise<MediaResult[]>
    localUrl: (path: string) => string
  }
  export: {
    archive: (uid: string) => Promise<string>
    legacy: (uid: string) => Promise<string>
  }
  update: { check: () => Promise<void> }
}
```

- `desktop`：调用 MyGo 绑定。
- `web`：只实现 `import` / 浏览只读；`auth.login` / `archive.start` / `media.download` 抛「网页版不支持」。
- 组件只依赖 `Platform`，不感知 MyGo。

### 4.3 页面

1. **引导**：登录 → 选范围（默认「全部」）→ 开始。
2. **备份进度**：总进度、当前切片、已抓条数、失败项、暂停 / 继续；关闭窗口时确认。
3. **时间线**：倒序 + 月份分组；转发 / 原创 / 带图筛选。
4. **日历**：按天热图，点开看当天微博。
5. **搜索**：正文 + 评论；结果高亮。
6. **媒体**：图片墙 / 视频；本地文件优先，缺失显示远程 URL。
7. **详情**：评论、楼中楼、转发、原文卡片；可跳转微博原链接。
8. **设置**：账号、存储路径、清理缓存、导出、关于 / 检查更新。

---

## 5. 登录与安全

- 登录窗口只用于 `passport.weibo.com`，不注入脚本、不抓表单。
- 登录完成后由 Go 读取 Cookie，**直接交给 SDK**；不落地、不显示、不导出。
- `Allow` 白名单只放行 `weibo.com` / `weibo.cn` 及其子域。
- 退出登录：删除 Cookie + 可选清空本地归档（二次确认）。
- 遥测默认关闭；错误日志本地可选，默认脱敏（不含 Cookie / URL query）。
- 应用不提供「多账号同时备份」；v1 单账号。SDK 内部已有 `CredentialResolver` 接缝，但尚未公开配置（backlog EX2），多账号等该端口公开后再评估。

---

## 6. 兼容与迁移

### 6.1 老 Weibo-archiver 归档导入

- 入口：设置 → 导入旧归档（支持旧的 `weibo.json`）。
- 解析 `ImportedData`，按 [调研 §6](research-mygo-app-2026-10-26.md#6-数据兼容老归档--新契约) 的映射写入 `tweets` / `comments`。
- 有损项在导入结果页明确列出：楼中楼缺失、关注 / 收藏单独存、评论图片缺宽高、媒体仅远程 URL。
- 关注 / 收藏建独立表，提供列表查看；不伪装成 `ArchiveFile` 的一部分。
- 导入过程可中断 / 重试；已导入的按 `mblog_id` 去重。

### 6.2 新归档导入

- 支持直接导入 `weibo-user-archive/v2` JSON（校验 `schema` + `$schema`）。
- 支持导入目录（多份归档），内部复用 `mergeArchiveFiles` 语义（在 Go 侧用 SDK 导出的合并函数跑在 WebView，或由前端调用）。

### 6.3 版本升级

- 应用 schema 版本号存在 `meta` 表；启动时顺序迁移。
- SDK 升级：`ITweet` v2 内只增字段，应用按 JSON 存原样，升级风险低；跨 v3 时按 SDK 提供的迁移函数处理。

---

## 7. 分发与更新

- `mygo build` 产出：
  - Windows：exe + 安装器；检测 WebView2 运行时，缺失时引导安装。
  - macOS：app + dmg；签名 + 公证；arm64 与 x64 分别构建。
  - Linux（可选）：AppImage / deb；明确最低 WebKitGTK 版本。
- 更新：updater 插件 + GitHub Releases（签名校验）；更新前提示会中断正在进行的备份。
- 崩溃与日志：本地日志目录，设置页可「打开日志文件夹」；不上传。

---

## 8. 阶段计划

### P1 — 浏览 MVP

- 目标：导入一份新归档 / 老归档，能完整浏览。
- 交付：时间线、详情、日历、搜索、媒体墙；`Platform.web` 可跑。
- 验收：10k 条记录的归档滚动 / 搜索在可接受交互延迟内；老归档导入有损提示正确。

### P2 — 备份主流程

- 目标：登录 → 一键备份 → 进度 → 续跑 → 媒体下载。
- 交付：M2–M4 的产品化版本；暂停 / 继续；失败项面板；存储路径设置。
- 验收：非技术用户不看文档能完成一次备份；关应用重开后自动续跑。

### P3 — 导出与兼容

- 目标：导出 v2 / 旧格式；批量导入；多份归档合并。
- 交付：导出对话框、目录扫描、合并结果统计。
- 验收：导出的 JSON 通过官方 schema 校验；合并幂等。

### P4 — 发布

- 目标：可下载、可更新、可卸载。
- 交付：三端（至少 Win + macOS）安装包、签名、更新通道、官网下载页、隐私说明。
- 验收：干净机器安装完成 P2 全流程；自动更新成功一次。

---

## 9. 非目标

- 不做微博写操作（发帖 / 点赞 / 转发 / 关注）。
- 不做私信、仅粉丝可见、付费内容。
- 不做云端账号、同步、社交分享。
- 不在 v1 做移动端。
- 不把 SDK 移植到 Go；不引入 Node sidecar（除非 POC 判定 MyGo 不可行）。

---

## 10. 与 SDK 仓库的协作

- 应用只依赖 npm 上的 `@chilfish/weibo-sdk`，不引用本仓库源码路径。
- SDK 需要的改动（媒体端口、store 契约、transport 兼容）先在本仓库按稳定性政策走：Evolving 可直接改，Stable 需要 CHANGELOG 迁移说明。
- 应用发现的上游漂移、真实 fixture、失败样本，按 `tests/fixtures/raw/INDEX.md` 回灌 SDK。
