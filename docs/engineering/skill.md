---
name: ts-library-sdk-sdd
description: 基于规格驱动开发 (SDD) 与 Wide Events 模型的通用 TypeScript SDK 开发约束。
metadata:
  target-runtime: Isomorphic (Node.js/Browser/Edge)
  version: "2.0.0"
  tech-stack: TypeScript 5.x, Vitest, TSDoc, Bun/pnpm
---

# TypeScript SDK - 规格驱动开发规范

## 核心理念

逻辑实现必须严格服从于接口契约。SDK 的本质是一组离散逻辑的集合，通过**宽事件 (Wide Events)** 维持其运行时的透明度。

## 技术栈约束

- **核心语言**: TypeScript (Strict Mode, No Any, Exact Optional Property Types)
- **构建工具**: `tsup` (esbuild 为底层), 支持 ESM & CJS 双输出
- **并发控制**: 显式处理 Promise 竞争，严禁未捕获的浮动 Promise
- **可观测性**: 必须实现 Wide Events 埋点，严禁单一的 `console.log`

## SDK 架构九条宪法

### 第一条：契约优先与类型擦除预防 (Contract First)
所有公开 API 必须先定义 Interface/Type 规格。利用 `Readonly<T>` 确保不可变性。
- [ ] 导出类型是否覆盖了所有可能的调用路径？
- [ ] 是否利用了 Discriminated Unions 处理状态流转？

### 第二条：宽事件遥测 (Wide Events Implementation)
参考 `evlog` 标准，所有核心逻辑点必须产生宽事件。
**规范**：事件必须是扁平的键值对，包含 `event_name`, `timestamp`, `trace_id` 及当前全部上下文。
**代码示例**：
```typescript
// ✅ 正例：宽事件捕获内部状态
this.telemetry.emit({
  event: 'request_retry',
  retry_count: 2,
  internal_buffer_size: this.buffer.length,
  last_error_code: 'ECONNRESET',
  latency_ms: 150
})
```

### 第三条：无副作用核心 (Stateless Core)
核心业务逻辑应定义为纯函数。IO 操作（网络、存储）必须通过适配器接口注入。
- [ ] 核心算法是否脱离了 `window` 或 `process`？

### 第四条：资源管理与内存安全 (Resource Management)
SDK 必须显式处理销毁逻辑。涉及定时器、连接池或长轮询的类必须实现 `dispose()` 方法。
- [ ] 是否存在闭包导致的内存泄漏点？
- [ ] 所有的 Event Listener 是否有对应的移除逻辑？

### 第五条：零/低依赖原则 (Minimal Dependencies)
尽量减少生产环境依赖（Dependencies）。优先使用原生 Web API 的同构实现（如 `fetch`）。
- [ ] 引入的第三方库是否支持 Tree-shaking？

### 第六条：错误拓扑化 (Structured Error Handling)
禁止直接抛出 `Error` 字符串。必须继承自定义 `BaseError`，并附带错误代码（ErrorCode）与元数据。
```typescript
export class SDKError extends Error {
  constructor(public readonly code: string, public readonly metadata: Record<string, any>) {
    super(`[${code}] ...`)
  }
}
```

### 第七条：防御性并发 (Defensive Concurrency)
在单例模式或状态化 SDK 中，必须处理竞态条件（Race Conditions）。使用 `Mutex` 或序列化队列处理敏感状态。

### 第八条：版本演进兼容性 (Semantic Versioning)
任何 Breaking Change 必须在编译期通过 `deprecated` 注解提醒，并保留至少一个主版本（Major Version）的存续期。

### 第九条：自动化文档 (Living Documentation)
所有公开方法必须具备 TSDoc 注释，说明参数边界、异常情况及 Wide Event 触发点。

## 代码生成检查清单

- [ ] 函数复杂度 (Cyclomatic Complexity) < 10
- [ ] 异步函数是否使用了 `AbortController` 支撑中止操作？
- [ ] Wide Events 是否覆盖了 Happy Path 和 Error Path？
- [ ] 包体积是否经过 `size-limit` 验证？
```

---

### 扩展思考

1.  **时间序列追踪 (Temporal Traceability)**：通过 Wide Events，SDK 的使用者可以将日志直接接入 ClickHouse 或 Honeycomb。由于每个事件都携带了“宽上下文”，分析师可以在不重新埋点的情况下，通过事后回溯发现长尾延迟或复杂的异常模式。
2.  **混合分发模型 (Isomorphic Distribution)**：在设计 SDK 时，需针对 `package.json` 中的 `exports` 字段进行精细配置，确保在 Node.js 环境下加载 CJS 或特定的原生绑定，而在浏览器环境下通过 CDN 加载轻量级的 ESM 版本。
3.  **类型安全性增强**：建议在 SDK 中广泛使用 `branded types` 或 `opaque types`，防止调用方将不兼容的基础类型（如普通的 `string`）误传为经过校验的 `IdentityKey`，从而在编译期阻断 80% 的工程风险。
