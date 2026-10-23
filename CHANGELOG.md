# Changelog

公开变更记录，版本号遵循 SemVer。

## Unreleased

### 新增

- 公开文档站：指南、API 参考、CLI、契约与格式。
- 归档 JSON Schema 随包发布，可离线校验。
- 新增 `tweets.context`、`tweets.replies` / `streamReplies`、`tweets.longText`。

### 变更

- 读取方法统一返回领域模型（`IUser` / `ITweet`）。
- 公开选项统一 camelCase，CLI 参数名保持原样。
- 包根只导出公开 API。

## 0.5.0 (2026-10-22)

- 修复自检失败被永久缓存：只有确定性失败会缓存，网络抖动后可以恢复。
- 响应类型改为 schema 推导，原始响应的未知字段继续保留。

## 0.4.0 (2026-10-22)

- 新增归档合并 `mergeArchiveFiles()` 与 `weibo-cli archive merge`。
- 新增 `ITweet.attachments`：文章、投票、直播、抽奖。
- 新增范围归档 `sdk.userArchive` / `weibo-cli archive user`，支持断点续跑。
- 新增结构化日志 `config.logger`。
- CLI 查询命令支持 `--format markdown`。

## 0.3.2 (2026-10-21)

- 新增可替换 transport 与插件系统。
- 归档支持页内并发预取。
- CLI 与 SDK 拆成独立构建产物，包根只暴露公开 API。

## 0.3.0 (2026-10-21)

- 新增访客模式：没有 Cookie 也能读取公开数据。
- 新增 `tweets.context` 与 `weibo-cli tweet context`。
- 修复跨账号归档把登录账号数据写入他人归档的问题。

## 0.2.0 (2026-10-20)

- 归档扩展到点赞、历史评论、收藏、图片墙、视频、通知和超话。
- 新增媒体下载。
- 新增流式评论、转发、关注 / 粉丝；所有流支持 `maxItems` / `maxPages`。
- 修复评论首屏只返回 3 条、首页 Feed 翻页等问题。

## 0.1.1 (2026-10-20)

- 修复安装问题，改用 `pnpm publish` 发布。

## 0.1.0 (2026-10-20)

- 首个公开版本：用户、时间线、微博、评论、归档与结构化错误。
