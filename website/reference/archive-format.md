---
title: 归档 JSON Schema
outline: deep
---

# 归档 JSON Schema（`weibo-user-archive/v2`）

[`weibo-cli archive user`](/cli/) / [`sdk.userArchive`](/api/user-archive) 产出的单文件归档使用 [`schemas/weibo-user-archive/v2.json`](/schemas/weibo-user-archive/v2.json) 描述结构。

## 1. 格式描述

归档 JSON 是一个磁盘文档，由 [JSON Schema](https://json-schema.org/) 描述其结构，编辑器与校验器可以直接识别。

归档文件顶层有两个标识键：

| 键 | 示例 | 作用 |
|---|---|---|
| `$schema` | `https://weibo-sdk.chilfish.top/schemas/weibo-user-archive/v2.json` | 标准约定，编辑器 / 校验器据此自动发现 schema |
| `schema` | `weibo-user-archive/v2` | 归档格式标识，程序据此分派读取逻辑 |

`$schema` 是 JSON Schema 生态的通用约定（VS Code、IntelliJ、Ajv 等都能识别）；读取方判断格式时以 `schema` 为准。

离线或内网环境可直接使用 npm 包内的 `@chilfish/weibo-sdk/schemas/weibo-user-archive/v2.json`，校验在本地完成。

## 2. 生成

契约类型定义在 `src/types/archive/IArchiveFile.ts`，JSON Schema 由 `ts-json-schema-generator` 从这些类型生成：

```bash
pnpm schema:archive   # 重新生成 schemas/weibo-user-archive/v2.json
pnpm schema:check     # 检查是否有未提交的漂移（CI 用）
```

生成结果为 draft-07，Ajv 8 可以直接校验。

## 3. 字段与版本

- 当前格式标识为 `weibo-user-archive/v2`，同版本内 schema 文件名与 `$id` 保持不变。
- 同版本内只新增 optional 字段，读取方忽略未知键。
- 字段 rename / remove / 类型或语义变更时新增版本文件（如 `v3.json`），同步更新 `ARCHIVE_SCHEMA_URL`。
- `required` 只包含写入方一定会输出的字段，optional 字段保持非必填。

## 4. 校验

[`tests/unit/contract/archive-schema.test.ts`](https://github.com/Chilfish/weibo-sdk/blob/main/tests/unit/contract/archive-schema.test.ts) 用 Ajv 校验一个由 TypeScript 类型约束的最小归档，覆盖：

- `$schema` / `schema` 的值与 schema 的 `$id` 一致；
- 最小归档通过；
- 缺失 `$schema` 被拒绝；
- 未知字段通过校验；
- 真实响应出现过的 `verified_type` 取值（`-1` / `0` / `1` / `2` / `3` / `7` / `200`）通过。

手工校验任意归档：

```bash
node -e "const Ajv=require('ajv');const fs=require('fs');const s=JSON.parse(fs.readFileSync('schemas/weibo-user-archive/v2.json','utf8'));const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const a=new Ajv({strict:false});console.log(a.validate(s,d),a.errors)" ./weibo-archive-<uid>.json
```

## 5. raw 响应单独存放

归档 JSON 只包含归一化后的微博字段。每条微博的 `statuses/show` 原始响应通过 `--raw` / `--raw-out` 单独写入 `<out>.raw.ndjson`。上游协议漂移由此与存档契约解耦，归档文件体积也保持可控（与 [ITweet 存档契约](/reference/tweet-contract) §5 一致）。
