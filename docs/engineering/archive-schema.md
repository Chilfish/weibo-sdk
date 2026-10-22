# 归档 JSON Schema（`weibo-user-archive/v2`）

[`scripts/archive-user/`](../../scripts/archive-user/README.md) 产出的单文件归档使用 [`schemas/weibo-user-archive/v2.json`](../../schemas/weibo-user-archive/v2.json) 描述结构。本文说明格式约定、生成方式和版本规则。

> v1 文件（`weibo-user-archive/v1`）仍可用 [`schemas/weibo-user-archive/v1.json`](../../schemas/weibo-user-archive/v1.json) 校验；v2 删除了 `tweet.textHtml` 与归档记录的 `longText` / `quotedLongText`。

## 1. 为什么是 JSON Schema，不是 OpenAPI

OpenAPI 描述的是 **HTTP API**（路径、参数、响应），归档 JSON 是一个**磁盘文档**，两者不在同一层。OpenAPI 的 schema 部分本身也使用 JSON Schema，所以直接使用 [JSON Schema](https://json-schema.org/) 更贴近问题。

归档文件顶层同时保留两个键：

| 键 | 示例 | 作用 |
|---|---|---|
| `$schema` | `https://raw.githubusercontent.com/Chilfish/weibo-sdk/main/schemas/weibo-user-archive/v2.json` | 标准约定；编辑器 / 校验器据此自动发现 schema |
| `schema` | `weibo-user-archive/v2` | 归档格式标识；与包版本解耦，供程序按版本分发 |

`$schema` 是 JSON Schema 生态的通用约定（VS Code、IntelliJ、Ajv 等都能识别）；它不替代 `schema`，读取方仍应优先判断 `schema`。

> GitHub raw 的响应头是 `text/plain`，浏览器内做运行时校验时建议改用 jsDelivr（`https://cdn.jsdelivr.net/gh/Chilfish/weibo-sdk@main/schemas/weibo-user-archive/v2.json`）。编辑器场景用 raw 即可。

## 2. 唯一事实源与生成

契约类型定义在 [`src/types/archive/IArchiveFile.ts`](../../src/types/archive/IArchiveFile.ts)。JSON Schema **不手写**，由 `ts-json-schema-generator` 从 TypeScript 类型生成：

```bash
pnpm schema:archive   # 重新生成 schemas/weibo-user-archive/v2.json
pnpm schema:check     # 生成并检查是否有未提交的漂移（CI 用）
```

生成参数固定为：

- `--no-type-check`：生成器只解析类型，不跑完整类型检查（类型检查由 `pnpm typecheck` 负责）；
- `--additional-properties`：允许未知字段，保证 v1 内新增 optional 字段时旧 schema 不会误拒；
- `--markdown-description`：把 JSDoc 带进编辑器悬停；
- `--no-top-ref`：避免 draft-07 中 `$ref` 同级键被忽略，让根节点的 `$id` / `$schema` 生效；
- `--id`：写入 canonical raw URL。

生成结果使用 draft-07；Ajv 8 默认支持，无需额外 meta-schema 配置。

## 3. 版本规则

- 每个版本的 schema 文件在该版本生命周期内文件名和 `$id` 保持稳定；`v1.json` 保留为历史文件，已生成的不再回写；
- 当前版本 v2 内**只允许新增 optional 字段**（读取方忽略未知键）；
- rename / remove / 类型或语义变更 → 新增 `v3.json`，同时更新 `ARCHIVE_SCHEMA_URL`，随包 major 发布；
- schema 的 `required` 只包含写入方一定会输出的字段，不把 optional 字段标成必填。

## 4. 校验

[`tests/unit/contract/archive-schema.test.ts`](../../tests/unit/contract/archive-schema.test.ts) 用 Ajv 校验一个由 TypeScript 类型约束的最小归档，覆盖：

- `$schema` / `schema` 的值与 schema 的 `$id` 一致；
- 最小归档通过；
- 缺失 `$schema` 被拒绝；
- 未知字段被允许（前向兼容）；
- 真实响应出现过的 `verified_type` 取值（`-1` / `0` / `1` / `2` / `3` / `7` / `200`）通过。

手工校验任意归档：

```bash
node -e "const Ajv=require('ajv');const fs=require('fs');const s=JSON.parse(fs.readFileSync('schemas/weibo-user-archive/v2.json','utf8'));const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const a=new Ajv({strict:false});console.log(a.validate(s,d),a.errors)" ./weibo-archive-<uid>.json
```

## 5. raw 响应不在归档契约内

归档 JSON 不包含每条微博的 `statuses/show` 原始响应。需要原始数据时使用 `--raw` / `--raw-out`，单独写 `<out>.raw.ndjson`。这样上游协议漂移不会污染存档契约，也避免文件体积失控（与 `contract-itweet-v2.md` §6 一致）。
