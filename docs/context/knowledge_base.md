# 知识库 (Knowledge Base - Long-Term Memory)
> **用途**: 已验证的事实、确定的模式和系统常量。
> **来源**: 当置信度 > 95% 时从 `Hypothesis Log` 晋升而来。

## 🧠 系统架构知识 (System Architecture)

### 配置层架构 (2026-01-20)
- **SSOT (单一事实来源)**: `DesignSystemLoader` 是所有设计系统配置的唯一入口。
- **约束位置**: `src/config/systems/{id}/constraints.json` (取代了旧的 `semantic-constraints.json`)。
- **启发式位置**: `src/config/systems/{id}/heuristics.json` (包含外观阈值、评分标准、布局默认值)。
- **模式位置**: `src/config/systems/{id}/patterns.json` (包含组件特定的 Regex 模式和意图识别关键词 `INTENT_KEYWORDS`)。
- **逻辑原则**: 引擎代码 (`layout.ts`, `appearance.ts`, `layerFilter.ts`, `intentRecognizer.ts`) **禁止硬编码**任何阈值或模式，必须通过 `designSystemLoader` 动态获取。

## 🧩 复用模式 (Recurring Patterns)

### 动态正则构建
- **策略**: 由于 JSON 不支持存储 Regex 对象，我们在 `patterns.json` 中存储字符串形式的 Regex。
- **实现**: 在使用侧 (如 `layoutRules.ts`) 使用 `new RegExp(patternString, flags)` 动态还原。
- **注意**: 在 JSON 中编写 Regex 字符串时，反斜杠需要双重转义 (例如 `\\d+`)。

### 错误处理规范
- **截断检测**: 通过 `errors.ts` 中的 `isTruncatedOutput` 检测，依据是 `JSON` 结构或 `DSL_START` 模式是否完整。

## 📚 术语表 (Vocabulary)
- **Identity Nexus**: 身份中枢，指代新的 `DesignSystemLoader` 架构，负责集中管理所有“我是谁/我长什么样”的配置。
- **Stateless Engine**: 无状态引擎，指代后处理规则不再持有状态，而是纯粹的逻辑执行者。
