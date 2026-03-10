# Error Catalog

Agent-facing error pattern registry. Check this file when debugging to see if the issue matches a known pattern.

Format: each entry is a pattern, not a one-off bug. Entries should help diagnose *future* similar issues.

---

## TYPE-001: Figma API 返回对象但 metadata 声明为 scalar

**症状**: XML 输出中出现 `[object Object]`
**根因**: `PROP_METADATA` 的 `type` 字段与 Figma API 实际返回类型不匹配
**发现方式**: trigger result 中 grep `[object Object]`
**影响**: read 工具返回脏数据 → LLM 基于错误信息做决策
**已知实例**:
- `lineHeight` — Figma 返回 `{unit: "PIXELS", value: 24}`，metadata 声明 `scalar`
- `letterSpacing` — Figma 返回 `{unit: "PIXELS", value: 0}`，metadata 声明 `scalar`
**修复**: `propertyTransformer.ts` 对 `{unit, value}` 对象提取 `.value`；`xmlSerializer.ts` 加 `typeof === 'object'` 防御
**防线**:
- [ ] PropertyTransformer 加 runtime assert（scalar 返回 object 时 warn）
- [x] XmlSerializer 输出层 skip object values
**检测脚本**: `cat /tmp/figma-bridge/results/*/meta.json | grep -o '\[object Object\]' | wc -l`

---

## TRUNC-001: LLM tool call 参数被截断，XML 不完整

**症状**: `XML_PARSE_ERROR: Unterminated element <text>`，XML 末尾出现 `…` (U+2026)
**根因**: LLM 输出 token 超限或流式传输中断，tool call 的 `xml` 参数被截断为不完整 XML
**发现方式**: trigger result 中搜 `Unterminated element`；截断 XML 长度异常短（如 201 chars vs 正常 600+ chars）
**影响**: XML 解析失败 → 错误返回 LLM → LLM 重试 → 翻倍耗时
**复现特征**:
- Kimi K2.5 100% 复现（两次 trigger 完全一致的截断点、完全一致的 4 个 tool call）
- 截断发生在第 3 个并行 tool call，第 1/2/4 个正常（非累积 token 限制）
- XML 末尾带 `…` (U+2026)，说明是 LLM 内部截断（非网络中断）
**代码缺陷**: `agentRuntime.ts` 的 TRUNCATION GUARD 在 `else` 分支（无 tool call 时才检查 `finishReason`）。有 tool call 时即使 `finishReason=length`，仍会执行已截断的 tool call
**防线**:
- [ ] 在 tool dispatch 前检查 `finishReason`，如果是 `length` 则丢弃可疑 tool call 并注入续写提示
- [ ] XML parser 层：检测 `…` 尾字符，直接返回 `TRUNCATED` 错误码（区别于语法错误）
- [ ] 考虑 pre-dispatch XML 完整性校验（闭合标签检查）
**检测脚本**: `python3 -c "..." # 搜 trigger 中 xml 末尾含 U+2026 的 tool call`

---

## TRUNC-002: LLM 在 XML 属性中写入 gradient JSON，破坏 XML 解析

**症状**: `XML_PARSE_ERROR: Empty attribute name`；XML 中出现 `fills="[{\"type\":\"GRADIENT_LINEAR\",...}]"`
**根因**: LLM 从 read 结果学到了 gradient 的 JSON 结构，尝试用 `\"` 转义写入 XML 属性，但 XML parser 将 `\"` 视为属性边界断裂
**发现方式**: trigger result 中搜 `Empty attribute name`；检查 XML 中是否含 escaped JSON
**影响**: XML 解析失败 → LLM 重试 2-3 次（先用 `&quot;` 再 fallback 到 solid color）→ 额外 2-3 个 iteration
**重试模式** (观测到的 3 次尝试):
1. `fills="[{\"type\":...}]"` → 失败（`\"` 破坏 XML）
2. `fills="[{\"type\":...}]"` → 再次失败（同样错误）
3. `fills="[{&quot;type&quot;:...}]"` → 成功（正确 XML 转义）或 `fill="#6366F1"` → 成功（放弃 gradient，用 solid）
**防线**:
- [ ] XML parser 层：检测 JSON-escaped quotes 模式，返回更具体的错误提示（如 "Use &amp;quot; instead of \\" in XML attributes"）
- [ ] read 工具返回 gradient 时用简化格式（如 `gradient="linear,#6366F1,#8B5CF6"`）而非原始 JSON
- [ ] 或在 prompt 中明确禁止在 XML 属性中写入 JSON 对象

---

<!-- 新增条目模板:
## CATEGORY-NNN: 简短描述

**症状**: 用户或日志看到什么
**根因**: 代码层面为什么发生
**发现方式**: 怎么发现的
**影响**: 对 LLM / 设计质量的影响
**已知实例**: 具体 case
**修复**: 怎么修的
**防线**: 已加 / 待加的预防措施
-->
