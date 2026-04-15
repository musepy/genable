# Runtime 状态展示设计哲学

## 1. 目标

为运行中任务提供稳定、可理解、可干预的状态反馈，确保用户在任意时刻都能回答三个问题：

- 现在在做什么？
- 做到哪一步了？
- 我现在能做什么？

---

## 2. 核心设计哲学

### 2.1 可观测（Observable）

系统必须持续暴露运行态，而不是仅在完成后给结果。  
用户不需要猜测任务是否卡住，能直接看到当前状态和时间。

### 2.2 可控（Controllable）

状态展示必须包含即时操作提示，例如 `esc to interrupt`。  
用户应始终拥有中断能力，不被动等待。

### 2.3 低认知负担（Low Cognitive Load）

单行状态只放最关键信号，避免长句和混杂信息。  
优先一眼可扫描，而不是“信息最全”。

### 2.4 韧性优先（Resilience First）

连接异常应以可恢复模型呈现（如重连计数），而不是一次失败即终止。  
错误信息应说明“发生了什么”与“系统下一步如何处理”。

---

## 3. 标准状态行（Canonical Pattern）

推荐格式：

`◦ <State> (<Elapsed> • <Action>)`

示例：

- `◦ Working (5s • esc to interrupt)`
- `◦ Reconnecting... 3/5 (10s • esc to interrupt)`

字段定义：

- `State`：当前阶段（Working / Reconnecting / Completed / Canceled / Failed）
- `Elapsed`：已耗时，不是预计剩余时间
- `Action`：当前可执行的用户操作

---

## 4. 信息分类（6 类）

状态展示信息分为以下六类：

1. 状态信息（State）
2. 时间信息（Time）
3. 操作信息（Action）
4. 连接信息（Connection）
5. 错误原因（Error Cause）
6. 最终结果（Result）

说明：

- `Working` 主要体现 1/2/3
- `Reconnecting` 主要体现 1/2/3/4
- 断连错误文案体现 5
- 任务结束态体现 6

---

## 5. 文案语义约束

### 5.1 必须明确的语义

- `Working`：任务正在执行，连接仍可用
- `Reconnecting n/5`：系统在自动重连，第 n 次尝试，最大 5 次
- `Stream disconnected before completion`：响应在完成前中断
- `Connection closed normally`：连接按协议关闭，不等同于程序崩溃

### 5.2 严禁暗示的语义

- Spinner 不表示完成百分比
- `Reconnecting 3/5` 不表示模型思考进度
- `Elapsed` 不代表剩余时间预测

---

## 6. 最小可用状态流（MVS）

一个完整且可理解的最小状态流应包含：

1. `Working`
2. `Progress`（可选，但建议）
3. `Blocked`（仅在发生阻塞时）
4. `Result`

当出现网络抖动时，在 `Working` 与 `Result` 之间允许插入 `Reconnecting`。

---

## 7. 验收标准

满足以下条件即可认为状态展示达标：

- 用户在 1 秒内能识别当前是否仍在运行
- 用户在 3 秒内能识别是否可手动中断
- 重连场景中可见尝试次数与上限
- 失败场景中包含可解释原因，而非仅“失败”
- 正常完成场景中有明确终态与结果交付

