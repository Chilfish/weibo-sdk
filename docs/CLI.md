# Weibo SDK CLI

基于 [citty](https://github.com/unjs/citty) 构建的命令行工具，类型安全、零依赖。

## 安装

```bash
pnpm build        # 构建 dist/
node dist/cli.mjs --help
# 或开发模式直接运行
npx tsx src/cli.ts --help
```

## 配置 Cookie

仅通过环境变量或 `.env` 文件：

```bash
# .env 文件（推荐）
WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."

# 或直接导出
export WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."
```

所有命令默认输出 **JSON 格式**，可用于管道处理：

```bash
weibo-sdk user info 1111681197 | jq '.name, .stats'
weibo-sdk tweet detail QqsYymYOS | jq '.media[0]'
weibo-sdk search users 新闻 | jq '.data.cards[0].card_group[:3]'
```

## 命令参考

### 用户操作

```bash
# 获取用户信息
weibo-sdk user info <uid>

# 获取用户微博时间线
weibo-sdk user timeline <uid> [--since_id <n>] [--count <n>]
```

### 微博操作

```bash
# 获取微博详情
weibo-sdk tweet detail <mblogId>

# 获取微博评论
weibo-sdk tweet comments <mblogId> [--count <n>] [--flow 0|1]

# 获取首页 Feed（关注时间线）
weibo-sdk tweet home [--since_id <n>] [--count <n>]
```

### 搜索

```bash
# 搜索用户
weibo-sdk search users <query> [--page <n>]

# 搜索微博
weibo-sdk search tweets <query> [--page <n>]
```

### 其他

```bash
# 热搜榜单
weibo-sdk trends

# 验证 Cookie 有效性
weibo-sdk whoami
```

## 架构

```
src/cli.ts              # 主入口，runMain()
src/cli/
  shared.ts             # getCookie / createSDK / cookieArg
  commands/
    user.ts             # user info / user timeline
    tweet.ts            # tweet detail / comments / home feed
    search.ts           # search users / search tweets
```

基于 citty 的 `defineCommand` + `runMain` 模式：
- 每个子命令独立定义，支持嵌套
- 自动生成 `--help` 文档
- 零运行时依赖
