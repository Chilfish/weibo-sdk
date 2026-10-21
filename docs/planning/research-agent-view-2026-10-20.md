# 调研与设计：Agent 视角的单条微博上下文（TweetContext，2026-10-20）

> **目的**：回答「如何让一个 AI 理解给定的微博」——需要哪些上下文、哪些信息现在缺失、如何用稳定契约和 CLI 暴露。
> **方法**：用真实 Cookie 拉取两条真实微博（图文原创 `RnxWieuYE`、多层转发 `RnANTz33M`），把 `ITweet` 投影成 Agent 可读的上下文卡片，验证语义缺口。
> **结论**：`ITweet` 是「存档记录」，不是「理解输入」。需要新增独立的 **`ITweetContext` 视图层**（不改 `ITweet` v1 契约），把「谁说的 / 什么时候 / 说了什么 / 配了什么 / 和谁有关 / 别人怎么反应 / 哪些是未知」显式化；媒体既给临时 URL，也给可执行的下载/本地读取路径。

---

## 0. 结论先行（TL;DR）

1. **不要把 SDK 做成 LLM 客户端**。SDK 只做确定性投影：时间归一化、HTML/零宽字符清理、转发链归属、媒体归属与尺寸提示、原始标记（广告/付费/长文截断）。理解、总结、OCR、转写由调用方完成。
2. **新增 `ITweetContext`（`weibo.tweet-context/v1`）**，与 `ITweet` 并列。`ITweet` 继续承担存档终局契约；`ITweetContext` 只增不改地演进。
3. **转发微博的最大陷阱是归属**：`ITweet.text` 是拍平的 `//@` 链，`atUsers` 会把转发链作者误当提及，媒体可能属于原微博。上下文必须显式区分「当前作者的话」与「转发的原文」。
4. **图文并茂的关键是「媒体怎么读」**：每条媒体要有 `owner`（属于当前微博还是原微博）、`index`（顺序）、尺寸/比例、临时 URL、以及 `weibo-cli media download` 或本地文件路径；描述/OCR/转写是可选槽位。
5. **CLI 提供 `weibo-cli tweet context <id>`**，默认输出 Markdown 上下文卡片，`--format json` 输出结构化数据；所有开关通过 citty 声明，`--help` 自动生成。

---

## 1. 问题：真实数据里的「理解缺口」

### 1.1 图文原创：信息一半在图里

真实样本 `RnxWieuYE`（@差评君，2026-10-20）：

- 正文：小米一次申报 8 个汽车商标，提到「之前曝光的测试车谍照」。
- 配图：1 张 690×900 的伪装测试车照片。

当前 `ITweet` 给出的是：`text`、`media[0].imageUrl`、尺寸、话题、互动数（v1 曾有 `textHtml`，v2 已删除）。对 AI 来说：

- 正文能读懂，但「谍照长什么样」完全缺失；
- 图片 URL 是**临时签名地址**，不能长期引用；
- 没有「这张图和正文是什么关系」的提示。

**结论**：只给 `media[].imageUrl` 不足以让 AI 理解「图文并茂」。至少要给「有序 + 归属 + 尺寸提示 + 可下载路径」，最好再给描述/OCR 槽位。

### 1.2 多层转发：谁说的哪一句

真实样本 `RnANTz33M`（@芋头_Sa74）：

```text
这么好的！！//@咕咕箐箐_er:美游啊啊啊啊！//@亚亚_ako:美游宝宝！//@G44不会受伤:小美游！
```

当前 `ITweet` 的问题：

| 现象 | 风险 |
|---|---|
| `text` 把四层发言拍平成一串 | AI 会把别人的话当成当前作者的话 |
| `atUsers` 从 HTML 锚点解析，包含转发链作者 | AI 会误以为作者 @ 了这些人 |
| `media` 为空，9 张图在 `retweetedStatus.media` | AI 会认为「这条微博没有配图」 |
| `retweetedStatus.text` 里的 `[可怜]` 是微博表情 token | AI 可能当成字面文本 |
| `createdAt` 是 `Tue Oct 20 22:57:41 +0800 2026` | 不是 ISO，直接塞给模型容易误读时区 |

**结论**：转发微博必须显式建模「当前作者的评论」→「转发的原文」→「转发链每一层」，并把媒体归属挂到正确的层。

### 1.3 当前 `ITweet` 没暴露、但 raw 里有的信号

| raw 字段 | 为什么 Agent 需要 | 当前状态 |
|---|---|---|
| `isAd` | 广告不应被当作作者观点 | 未暴露 |
| `is_paid` | 付费内容需要提示 | 未暴露 |
| `isLongText` | 正文可能被截断，总结会基于残缺文本 | 未暴露 |
| `content_auth` | 内容分级/警告（语义待确认） | 未暴露 |
| `following` / `follow_me` | 「我是否关注 TA / TA 是否关注我」影响可信度判断 | 用户模型未暴露 |
| `verified_reason` | 认证说明比 `verified: true` 更有信息量 | 未暴露 |
| `annotations` / `pic_focus_point` | 图片焦点/拍摄信息 | 未暴露（低优先级） |

---

## 2. 一条微博要被理解，需要哪些上下文

| 维度 | AI 会问的问题 | 上下文内容 | 为什么必需 |
|---|---|---|---|
| 身份 | 谁说的？可信吗？ | 昵称、uid、主页、认证与认证说明、简介、粉丝数、与我的关注关系 | 同一句话，官方账号和匿名账号的含义不同 |
| 时间 | 什么时候？还新鲜吗？ | UTC ISO、带偏移的本地时间、抓取时间 | 时区/相对时间误读会改变结论 |
| 正文 | 他说了什么？ | 纯文本（仅当前作者本人发言）、话题、@、已解析链接、表情 token、长文截断标记 | 转发链拍平是最常见的归属错误 |
| 媒体 | 图/视频里是什么？ | 有序媒体、类型、尺寸/比例、时长、封面、归属、URL、本地路径、描述/OCR/转写槽位 | 图文微博的信息可能 100% 在图里 |
| 关系 | 原创还是转发？谁说的哪句？ | `quoted` 原微博、`repostChain` 每层作者与文本 | 转发评论脱离原文经常无法理解 |
| 社会反馈 | 大家怎么反应？ | 互动快照、按热度抽样的评论、抽样声明 | 防止把 4 条热评当整体舆论 |
| 可信度/来源 | 是广告吗？数据多新？ | `isAd` / `isPaid` / `contentAuth` / `textTruncated`、抓取时间、端点 | 广告、截断正文、过期快照都会改变回答 |
| 任务预算 | 我要多少 token？ | compact / standard / full、`maxChars`、`maxMedia` | 一条图文微博可能有 9 张 2048×2730 图片 |

### 2.1 「图文并茂」的媒体模型

单条媒体至少需要：

```ts
interface TweetContextMedia {
  index: number                 // 1-based，顺序即原微博顺序
  mediaId: string
  owner: { mblogId: string, relation: 'self' | 'quoted' } // 图属于谁
  type: 'pic' | 'gif' | 'livephoto' | 'video' | 'unknown'
  url: string                   // 临时签名 URL（需及时下载）
  coverUrl?: string             // 视频封面
  width: number
  height: number
  aspectRatio: number
  duration?: number
  temporary: true               // 明确告诉调用方 URL 会过期
  hints: string[]               // 确定性提示：长图/图集/正文指代图片/需要转写
  download?: { path: string, status: string, bytes?: number, contentType?: string }
  description?: string          // 可选：调用方注入的画面描述
  ocrText?: string              // 可选：调用方注入的 OCR
  transcript?: string           // 可选：调用方注入的视频/音频转写
}
```

**确定性提示（SDK 自己算）**：

- `tall_image:likely_long_screenshot`：宽高比 < 0.45（长截图/长图）；
- `photo_dump:order_matters`：媒体数 ≥ 6；
- `text_references_images`：正文出现「图 1 / 上图 / 下图 / 左图」等；
- `no_text:content_is_in_media_only`：正文为空但有媒体；
- `media_from_quoted_post:not_the_poster_own_media`：当前微博无图、原微博有图；
- `video:needs_transcript` / `animated:static_cover_only`。

**描述从哪来**：SDK 不内置视觉模型。调用方可以：

1. 直接拿 `url` 自己下载并交给多模态模型；
2. 用 CLI `--download-media <dir>` 落盘，拿到 `download.path` 后交给 Agent 的图片读取工具；
3. 把已有的 caption/OCR/transcript 通过 `description`/`ocrText`/`transcript` 槽位回填。

---

## 3. 设计

### 3.1 分层

```text
raw（微博响应）
  └─ ITweet（存档契约，v1 冻结）
       └─ ITweetContext（Agent 视图，确定性投影，可重建）
            ├─ buildTweetContext(tweet, options)
            └─ renderTweetContextMarkdown(context)
```

- **不改 `ITweet`**：存档消费方（web-v3 / monkey / CLI）不受影响。
- **`ITweetContext` 可重建**：不保存状态，同一 `ITweet` + 同一选项产出同一结果（时间戳除外）。
- **纯函数**：builder 不发请求、不读写文件，便于离线测试。
- **请求编排在 Service**：`TweetService.context()` 负责补作者、长文、评论抽样。
- **下载在 CLI/MediaService**：`--download-media` 复用现有 `downloadTweetMedia` / `downloadByMblogId`，不新增第二条下载链路。

### 3.2 `ITweetContext` 形状

```ts
interface ITweetContext {
  schema: 'weibo.tweet-context/v1'
  post: {
    kind: 'original' | 'repost'
    id: string
    mblogId: string
    url?: string
    author: {
      id: string
      name: string
      url?: string
      verified: boolean
      verifiedType: number
      description?: string
      followers?: number
      following?: boolean
      followedBy?: boolean
    }
    publishedAt: string          // UTC ISO
    publishedAtLocal?: string    // 2026-10-20T15:40:07+08:00
    source: string
    location?: string
    visibility: 'public' | 'private' | 'friends' | 'followers' | 'group' | 'unknown'
    text: string                 // 仅当前作者本人发言
    topics: string[]
    mentions: string[]           // 仅当前作者正文里的 @
    links: Array<{ title: string, url: string }>
    stats: { likes: number, comments: number, reposts: number, reads?: number }
    flags: { isAd?: boolean, isPaid?: boolean, textTruncated?: boolean, edited?: boolean, pinned?: boolean, contentAuth?: number }
  }
  media: TweetContextMedia[]
  quoted?: ITweetContext          // 转发的原微博（递归，默认只展开一层）
  repostChain?: Array<{ index: number, author?: string, text: string, role: 'commentary' }>
  discussion?: Array<{ author: string, userId?: string, text: string, likes: number, replies?: number, isAuthor?: boolean }>
  provenance: {
    fetchedAt: string
    via: string
    commentsSampled?: number
    longTextFetched?: boolean
    authMode?: 'cookie' | 'guest'
  }
  unknowns: string[]              // 显式未知，禁止伪默认
  hints: string[]
}
```

### 3.3 语义规则

- **R1 当前作者正文**：有 `repostChain` 时 `post.text = repostChain[0].text`；没有时才用 `tweet.text`。
  **即使 `--no-chain` 关闭转发链展示，也不能回退到拍平的 `//@` 文本**——关闭的只是展示，不改变「谁说的哪一句」。
- **R2 提及**：只保留出现在 R1 文本中的 `atUsers`；转发链里的 `@` 不算提及。
- **R3 媒体归属**：`owner.relation = 'self'` 只给当前微博的媒体；原微博媒体递归到 `quoted.media`，并加 `media_from_quoted_post` 提示。
- **R4 时间**：解析微博的 `Www Mmm dd HH:mm:ss +0800 yyyy`；同时输出 UTC ISO 和带偏移本地时间；解析失败原样保留并加 `unknowns`。
- **R5 长文**：`isLongText === true` 且未补拉时，`flags.textTruncated = true` 并写入 `unknowns`；已补拉时用全文替换 `post.text`。
- **R6 原始标记**：`isAd` / `is_paid` / `isLongText` / `content_auth` 从 raw 读取；广告加 `advertisement` 提示。`content_auth === 0`（正常）不写入 flags，避免 Markdown 里出现无意义的 `contentAuth=0`。
- **R7 未知显式化**：媒体无描述、视频无转写、评论是抽样、URL 可能过期、转发只展开一层，都必须写进 `unknowns` 或 `hints`。
- **R8 不造假**：缺少粉丝数、关注关系、认证说明时省略字段，不填 `0` / `false`。

### 3.4 Markdown 渲染

`renderTweetContextMarkdown()` 输出固定章节，便于人和 Agent 同时阅读：

```text
# 微博上下文：@作者 · 时间
## 谁发的
## 说了什么
## 转发的原微博（不是当前作者的正文）
## 转发链（由近到远，每层都是转发者的话）
## 配了什么（媒体属于谁、怎么读）
## 讨论（按热度抽样，不代表全部）
## 抓取信息与未知项
```

JSON 是权威格式；Markdown 是提示词友好的确定性渲染，不做总结、不做推断。

---

## 4. CLI 设计

```bash
weibo-cli tweet context <mblogId|mid|url> [options]
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--format`, `-f` | `markdown` | `markdown` / `json` |
| `--comments <n>` | `0` | 抽样评论条数；按热度序 |
| `--comment-flow <hot\|time>` | `hot` | 评论排序（`time` 需要数字 mid，SDK 自动解析） |
| `--author` / `--no-author` | `true` | 是否额外拉取作者资料（1 次请求） |
| `--longtext` / `--no-longtext` | `true` | `isLongText` 时是否补拉全文（1 次请求） |
| `--quoted` / `--no-quoted` | `true` | 是否展开转发的原微博 |
| `--chain` / `--no-chain` | `true` | 是否展开转发链；关闭只影响展示，`post.text` 仍只取当前作者第 0 层 |
| `--max-media <n>` | 全部 | 最多列出的媒体数 |
| `--max-chars <n>` | `4000` | 单个文本字段上限；`0` = 不限 |
| `--download-media <dir>` | 无 | 下载媒体并回填 `download.path` |
| `--overwrite` | `false` | 下载时覆盖已存在文件 |
| `--cookie/-c`, `--env-file`, `--guest` | — | 与其它命令一致 |

`--help` 由 citty 根据 `meta` + `args` 自动生成，不需要手写帮助文本。

### 4.1 请求预算

| 场景 | 请求数 |
|---|---|
| 默认（原创/转发详情） | 1（`statuses/show`） |
| `--no-author` + 非长文 | 1 |
| 长文 | +1（`longtext`） |
| 作者资料 | +1（`profile/info`） |
| `--comments 5` | +1（评论第一页） |
| `--download-media` | +1/每个媒体所属微博（复用 `downloadByMblogId` 刷新临时 URL） |

默认 `--author` 开启是为了身份可信度；需要极致省钱时用 `--no-author`。

### 4.2 输出示例（真实数据，节选）

```markdown
## 说了什么
这么好的！！

类型：转发
来源：iPhone 17
互动（快照）：赞 1 · 评论 0 · 转发 0

## 转发的原微博（不是当前作者的正文）
> 原作者：@Shiina· · 2026-10-18T18:23:51+08:00
> 进度3/3[可怜]顺利的回家了！宁波好好拍啊……

## 配了什么（媒体属于谁、怎么读）
- 图1：图片 2048×2730（比例 0.75）· 归属：转发的原微博
  URL（临时签名，需及时下载）：https://wx3.sinaimg.cn/large/...
  读取方式：weibo-cli media download Rng9L5gdf -o <dir>
```

---

## 5. 测试策略

**纯函数（默认离线）**：

- 原创图文：`post.text`、`media[]`、`hints`、`sourceUrl`；
- 多层转发：`post.text` 只含第 0 层；`mentions` 不含链上作者；`quoted` 存在；`media_from_quoted_post`；
- 只有图片、正文为空：`no_text:content_is_in_media_only`；
- 长文截断：`flags.textTruncated` + `unknowns`；
- 广告：`flags.isAd` + `advertisement`；
- 时间：`Tue Oct 20 15:40:07 +0800 2026` → ISO + 本地时间；非法格式原样保留；
- `maxChars` / `maxMedia`截断：`unknowns` 里明确写出被截断；
- Markdown：章节顺序快照 + 关键语义断言（不对比整篇长文）。

**Service（mock HTTP）**：

- `context()` 调用 `show` →（可选 `longtext`）→（可选 `profile/info`）→（可选评论）；
- `--no-author` / `--no-longtext` 不产生额外请求；
- 错误路径沿用现有结构化错误。

**E2E（可选）**：真实取一条图文 + 一条转发，断言 `quoted` 与媒体归属。

---

## 6. 非目标

- 不做总结、情感分析、事实核查、可信度评分；
- 不内置 OCR / 视觉模型 / 视频转写 / 翻译；
- 不抓取外链正文（`linkCards` 只给标题和 URL）；
- 不把 `ITweet` 改成另一种形状；
- 不把「评论抽样」当整体舆情。

---

## 7. 开放问题

1. **命名**：`context` / `brief` / `digest`？当前选 `context`，与「Agent 上下文」一致。
2. **微博表情**：是保留 `[可怜]` token，还是内置常用表情语义表？当前保留 token，避免维护大表。
3. **描述注入**：V1 只留槽位；是否要在 `context()` 选项里接受 `describeMedia` 回调，还是保持 SDK 纯投影、由调用方回填？
4. **媒体下载归属**：`--download-media` 会为原微博单独发一次请求刷新临时 URL；是否值得在 `ITweetContext` 里携带不可序列化的内部引用以避免重复请求？
5. **文章/头条**：微博正文可能只是导语，正文在头条文章里；当前 `linkCards`/`pageInfo` 不给文章正文。
6. **线程**：微博的「自己回复自己」串尚未建模，是否需要 `thread` 字段？
7. **feed 推荐原因**：首页「为什么看到这条」可能在 raw 里，值得后续补。

---

## 8. 实施切片

1. **V1（已完成，2026-10-20）**：`ITweetContext` 类型 + 纯函数 builder/renderer + `TweetService.context()` + `weibo-cli tweet context` + `--download-media` 回填 + 离线测试 + 文档。真实复测覆盖 `--help`、Markdown/JSON、评论抽样、省略开关，以及「下载图片后可被 Agent 直接读取」。
2. **V2（候选）**：媒体描述回填接口（`describeMedia` 回调或独立 enrich 包）、feed 批量 context、归档 sidecar 中的 context、微博表情语义表。
3. **V3（候选）**：外链正文 / 头条文章正文、自己回复自己的 thread 建模、feed「为什么看到这条」信号。
