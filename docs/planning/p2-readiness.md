# P2 下游集成就绪：决策与评估

> 对应 [todo-contract-freeze.md](../archive/todo-contract-freeze.md) P2-2 / P2-4 / P2-5。
> 结论日期：2026-10-19。目标是把「发布前必须拍板」的三件事写成可执行决定，而不是继续扩功能。

## P2-2 有损迁移评估（K5）

### 现状对照

`ITweet` v1 是归档终局契约；`normalizeTweet` 只构建固定形状，raw 的未知字段默认丢弃。

| raw 字段 / 能力 | v1 现状 | 是否阻塞归档 | 建议 |
|---|---|---|---|
| `comments`（评论） | P1-6 新增 optional `comments?: ITweetComment[]`，仅 `streamArchive({ includeComments: true })` 填充 | 否 | 保留；需要评论的消费方显式开启 |
| `card`（复杂卡片） | `pageInfo` 只覆盖链接/视频卡片的 6 个字段 | 否 | **不扩 v1**；完整卡片走 raw |
| `isShowBulletIn` / `isAd` / 其它标志位 | 未进入 `ITweet` | 否 | 不进契约；需要时从 raw 读取 |
| 未知/新增字段 | 仅 `schemaDigest` 结构快照 | 否 | 不扩字段；raw 由消费方自行保存 |

### 裁定

1. **`ITweet` v1 继续保持最小展示契约**：只增加被下游明确消费的 optional 字段；`comments` 是本次唯一新增。
2. **`ArchiveItem` 不新增 `raw`**（P0-2/P1-9 已裁定）：需要原始字段的消费方用
   `config.hooks.onRaw` / `streamArchive({ onRaw })` 落 sidecar，或对单条调用 `tweets.enrich()` 补拉。
3. **`card` 不做 v1 扩展**：若 archiver 确实需要完整卡片，先在 archiver 侧用 raw sidecar 验证需求；
   确认长期需要后再按「新增 optional 字段」流程升 minor，并更新契约冻结表 + 形状测试。
4. **迁移策略**：已落盘 v1 记录不需要迁移；缺失字段通过「raw sidecar 优先 → `enrich` 补拉」恢复，
   不在本地做有损回填。

### 给 archiver 的接入建议

- 存档记录保存 `{ schemaVersion, tweet }`；raw 需要时按 `mblogId` 保存 sidecar JSON。
- 读取时按 `schemaVersion` 分发迁移；未知更高版本拒绝覆盖写入（见 contract §5）。
- 评论用 `includeComments: true` 进入 `tweet.comments`；不要同时把评论塞进 raw sidecar 以外的自定义字段。

## P2-4 CLI 裁剪复审（F3）

### 命令盘点

| 命令 | 分类 | 决定 | 理由 |
|---|---|---|---|
| `archive` | Hero | **保留** | 产品主线：可恢复归档流 |
| `whoami` | Hero | **保留** | 最小 Cookie/会话诊断入口 |
| `trends` | Hero | **保留** | 轻量、独立、Agent 友好 |
| `user info` / `user timeline` | 消费方 | **保留** | archiver/monkey 常用 |
| `tweet detail` / `tweet enrich` / `tweet reposts` / `tweet comments` | 消费方 | **保留** | 单条补拉与 raw/enrich 路径 |
| `follow list` / `follow fans` / `follow my` | 消费方 | **保留** | 归档附属能力 |
| `favorite list` / `favorite tags` | 消费方 | **保留**（tags 标 advanced） | `favorite list` 有归档价值；tags 低频 |
| `tweet home`（friendstimeline） | Advanced | **保留但标 advanced** | 首页 Feed 非归档主线；诊断/实验用 |
| `tweet longtext` | Advanced | **保留** | 单条补拉排障 |
| `tweet search-profile` | Advanced | **保留** | 日期切片的原始端点诊断 |
| `search users` / `search tweets` | 产品暂缓 | **保留命令但标 deprecated** | 上游已失效；保留稳定错误与迁移提示，不删除 |

### 裁定

- **不删除任何现有命令**：CLI 已有真实消费方（archiver CLI / monkey），删除的收益低于破坏风险。
- 在 `--help` 与文档中标注 `advanced` / `deprecated`；`search` 命令命中时给出明确错误与替代建议。
- 不新增「对称镜像命令」；`archive` 的选项（`--comments` / `--source` / `--since`）已覆盖主要场景。

## P2-5 流程回流（E6）

### 保留（发布/契约仪式）

- SemVer + `CHANGELOG.md`；契约破坏性变更随包 major。
- `TWEET_CONTRACT_VERSION` 冻结表、形状测试、迁移策略。
- 破坏性变更直接移除旧 API（2026-10-21 起不再保留 `@deprecated` 方法）；迁移说明写进 `CHANGELOG.md`。
- 发布门禁：`pnpm test` / `pnpm run typecheck` / `pnpm run lint` / `pnpm run validate:fixtures` / `pnpm run build`。

### 砍掉（内部仪式）

- 「每个 commit 都先写文档/开发日志」——对 typo、纯重构、测试补全不再强制。
- 为每次小改动写长篇开发日志；日志只记录**决策、返工、真实上游观察**。
- 逐 commit 的 docs-first 流程；改为随变更类型触发（见下）。

### 轻量 DoD（按变更类型）

| 变更类型 | 必须做 | 可选 |
|---|---|---|
| Typo / 注释 / 纯格式 | typecheck + lint | — |
| Bug fix / 内部重构 | 相关测试 + typecheck + lint | CHANGELOG（若用户可感知） |
| 新功能 / 行为变化 | 测试 + typecheck + lint + CHANGELOG + 相关文档 | 开发日志 |
| 契约字段变化 | 上述 + 契约冻结表 + 形状测试 + 迁移说明 | 开发日志 |
| 发布 | 全部门禁 + release checklist | 调研/复盘 |

> 原则不变：**docs-as-truth**——文档与代码不一致时以修正文档为发布阻塞；但不再要求每个 commit 都产生文档。
