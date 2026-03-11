# 003-e2e-selfcheck-and-expected-errors

**Date**: 2026-03-11

## Summary

SDK 在启动阶段缺少严谨的会话自检（Cookie 存在性/是否过期），并且服务层对上游 API 返回过度信任，导致在 Cookie 过期或参数错误等“预期内失败”场景下，容易出现读取 `undefined` 引发的非结构化异常，错误诊断困难。

## Impact

- 调用方看到的错误往往是“Cannot read properties of undefined”一类的运行时异常，而不是可诊断的业务错误。
- E2E 测试在 Cookie 过期时缺少明确失败原因与自检入口，反馈链路不完整。

## Root Cause

1. **缺少启动自检的明确入口**：`WeiboSDK.checkSession()` 之前是占位实现，未真正验证 Cookie 会话有效性。
2. **服务层缺少响应校验**：`UserService` 等对 `ok` 与必需字段未做断言，导致 cookie/参数错误时返回结构变化直接穿透。
3. **错误类型不够细**：缺少将“ok!=1 / 缺字段”映射为结构化错误的统一策略。

## Resolution

- 新增 `WeiboSDK.selfCheck()`，在启动阶段通过不带 uid 的 `ajax/profile/detail` 进行会话自检。
- 为 `UserService` / `TweetService.show` 增加 `ok !== 1` 与必需字段缺失的显式校验，并抛出结构化错误：
  - `WeiboSessionExpiredError`（会话不可用）
  - `WeiboAPINotOkError`（接口明确失败）
  - `UnexpectedAPIResponseError`（响应缺字段/结构异常）
- 更新 e2e 用例：真实请求前先调用 `selfCheck()`，保证失败时原因明确。

## Preventative Actions

- 建立“响应可信边界”：所有跨网络返回必须在边界层做 `ok` 与关键字段断言。
- 逐步把校验逻辑提炼为可复用的 response guard/validator，避免重复与遗漏。
- 在关键路径补齐 Wide Events（happy path + error path），让 E2E 失败可追踪。

## Follow-ups

- 增加覆盖 Cookie 过期与参数错误的 e2e 负例（默认跳过，通过环境变量显式开启）。
- 将更多 endpoint 纳入统一的响应校验与错误映射策略。
