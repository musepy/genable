# PrefixHash 运行记录（2026-03-01）

## 背景

- 目标：确认多轮迭代中“稳定前缀”是否发生变化。
- 方法：观察 `LLMGenCoordinator` 输出的 `PrefixHash` 日志。

## 关键观测

1. 第 0 轮：`prefix_stable=false`（首轮基线，无上一轮可比）。
2. 第 1、2 轮：`prefix_stable=true`，且 `stable_hash/system_hash/first_user_hash` 持续一致。
3. 结论：可排除“前缀在迭代中变化”的问题。
4. 说明：token 估算仅用于趋势，不作为 cache hit 判据。

## 日志摘录

```text
[LLMGenCoordinator] PrefixHash iter=0 prefix_stable=false stable_hash=1lgq8cq system_hash=17mpg7k first_user_hash=tabtcy systems=2 messages=3 headRoles=system>system>user
[LLMGenCoordinator] PrefixHash iter=1 prefix_stable=true stable_hash=1lgq8cq system_hash=17mpg7k first_user_hash=tabtcy systems=2 messages=5 headRoles=system>system>user>model>tool
[LLMGenCoordinator] PrefixHash iter=2 prefix_stable=true stable_hash=1lgq8cq system_hash=17mpg7k first_user_hash=tabtcy systems=2 messages=7 headRoles=system>system>user>model>tool>model
```

## 同期实现变更（本地性能）

- `ContextManager` 增加消息级 token 缓存，减少重复估算。
- `AgentRuntime` 移除 `manageContext()` 之后的重复 `updateTokens()`。
