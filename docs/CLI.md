# Weibo SDK CLI

基于 [citty](https://github.com/unjs/citty) 构建的命令行工具，类型安全、零依赖。

## 安装

```bash
pnpm build        # 构建 dist/
node dist/cli/index.mjs --help
# 或开发模式直接运行
npx tsx src/cli/index.ts --help
```

## 配置 Cookie

两种方式提供微博登录 Cookie：

```bash
# 方式 1：环境变量（推荐）
export WEIBO_COOKIE="SUB=xxx; XSRF-TOKEN=xxx; ..."
weibo-sdk user info 1111681197

# 方式 2：命令行参数（每个命令都需要）
weibo-sdk user info 1111681197 --cookie "SUB=xxx; ..."
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
weibo-sdk self-check --cookie "SUB=xxx; ..."
```

## 架构

```
src/cli/
  index.ts              # 主入口，runMain()
  commands/
    user.ts             # user info / user timeline
    tweet.ts            # tweet detail / comments / home feed
    search.ts           # search users / search tweets
```

基于 citty 的 `defineCommand` + `runMain` 模式：
- 每个子命令独立定义，支持嵌套
- 自动生成 `--help` 文档
- 零运行时依赖
