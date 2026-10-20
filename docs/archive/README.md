# 归档（Archive）

> 已完成阶段的规划文档统一归档于此。**仅供历史查阅，不再主动读取**（避免污染上下文）。
> 活跃文档只在 `docs/planning/` 与 docs 各分类目录；本目录是「已完成」的墓碑。

## 归档规则

- **何时归档**：一个阶段/特性交付完成后，其规划文档不再需要被主动读取时。
- **归档对象**：阶段 TODO、一次性方案、已完成的计划文档（如「Phase X 计划」）。
- **不归档**：`docs/engineering/technical-spec.md`（现行契约）、`docs/planning/roadmap.md`（活跃路线图）、`docs/engineering/error-diagnostics.md` / `docs/engineering/cli.md` / `docs/requirements/glossary.md` / `docs/planning/architecture.md`（持续引用）。
- **归档后**：在 `docs/README.md` 的「存档」分类登记一行，标注「历史记录，不主动读取」。

## 已归档条目

| 文档 | 说明 |
|---|---|
| [todo.md](./todo.md) | 早期 TODO（P0/P1/P2 完成记录）——完成状态已收敛进 [todo-contract-freeze.md](./todo-contract-freeze.md) 与 [backlog.md](../planning/backlog.md)，本文件为历史记录 |
| [todo-archive-mvp.md](./todo-archive-mvp.md) | 归档 MVP（P0 契约收口 + A1-A8 断点续传流）——已完成，承接见 [todo-contract-freeze.md](./todo-contract-freeze.md)，本文件为历史记录 |
| [todo-contract-freeze.md](./todo-contract-freeze.md) | 上一阶段行动计划（契约冻结 P0 + 归档硬化 P1 + 下游集成就绪 P2）——已完成，0.1.0 已发布（0.1.1 重发）；承接见 [todo-post-0.1.0.md](./todo-post-0.1.0.md)，本文件为历史记录 |
| [todo-post-0.1.0.md](./todo-post-0.1.0.md) | 上一阶段行动计划（0.1.0 发布 + 0.2.0 用户数据面 / 可靠性 / DX）——已完成并归档；未实现项按维护者裁定不再推进（见 §11），本文件为历史记录 |

## 常见问题

- **为什么归档？** 完成的规划文档继续留在活跃区，会让 AI/人类每次读上下文都重放历史，浪费 token 并可能误导当前决策。
- **想找回旧计划？** 本目录即最终归档处；git 历史也可追溯。
