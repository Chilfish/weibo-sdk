# Postmortem 007 — CLI Framework Selection & Implementation

**Date**: 2026-05-16

## Summary

调研并选择了 TypeScript CLI 框架，实现了 weibo-sdk 命令行工具，建立了 CLI Interface Mandate 规范。

## Framework Selection

| Framework | Author | Style | Downloads/wk | Pros | Cons |
|-----------|--------|-------|-------------|------|------|
| **citty** | unjs | 函数式 `defineCommand` | 9M | 零依赖、unjs 生态、自动帮助 | pre-1.0 |
| cac | egoist | 链式 `.command()` | 14M | Vite/Vitest 使用、成熟 | 类型推导浅 |
| clipanion | arcanis | 类+装饰器 | 99K | 极深类型安全、Typanion | 需装饰器、v4 RC |

**选择 citty**：与 tsdown 同属 unjs 生态（同一作者 Pooya Parsa），零依赖，函数式 API 匹配项目风格。

## Implementation

### 架构
```
src/cli.ts                    # runMain() 入口，组装子命令（与 index.ts 同级）
src/cli/commands/
  user.ts                     # user info / timeline
  tweet.ts                    # tweet detail / comments / home feed
  search.ts                   # search users / tweets
```

### 命令树
```
weibo-sdk
├── user info|timeline        # 用户信息、时间线（分页）
├── tweet detail|comments|home # 微博详情、评论、首页 Feed
├── search users|tweets       # 搜索用户、搜索微博
├── trends                    # 热搜榜单
└── self-check                # Cookie 验证
```

### 输出
- `dist/index.mjs` — 库入口
- `dist/cli.mjs` — CLI 二进制（同级），`bin.weibo-sdk`
- 所有命令默认输出 JSON + 2 空格缩进
- Cookie 仅从 `WEIBO_COOKIE` 环境变量读取（无 `--cookie` 参数）

## CLI Interface Mandate

已写入 `AGENTS.md`：
1. 接受文本输入（stdin / 参数 / 文件）
2. 产生文本输出（stdout，JSON 格式）
3. 新增 Service 方法 → 必须配 CLI 子命令
4. Cookie 仅从 env 读取
5. 错误输出到 stderr + 非零退出码

所有 SDK 功能均可通过 CLI 验证，无需编写测试代码。

## Lessons Learned

- tsdown 多入口自动平铺输出（`src/cli.ts` → `dist/cli.mjs`）
- tsdown 的 `exports: true` 自动管理 package.json exports 子路径
- citty 的 `runMain` 自动处理 `--help`、错误边界和退出码
