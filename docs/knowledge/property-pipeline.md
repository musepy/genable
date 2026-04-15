# Property Pipeline: 三层属性系统

新增属性时需要同步修改的三个层级。

## 三层架构

### Layer 1: ABBREV_EXPANSION (prop-dsl.ts)
- 作用：缩写 → 规范属性名（parser 层）
- 例：`crossGap` → `counterAxisSpacing`, `w` → `width`, `bg` → `background`
- 时机：flatOpsParser 的 `buildProps()` 中展开

### Layer 2: PROPS + PROP_METADATA (constants/figma-api.ts)
- 作用：属性定义 + Figma API 映射（source of truth）
- `PROPS`: 属性名常量枚举
- `PROP_METADATA`: 类型(scalar/enum)、figmaKey、枚举值映射、范围约束
- 例：`PROPS.gap = 'gap'`, `PROP_METADATA[PROPS.gap] = { figmaKey: 'itemSpacing', type: 'scalar' }`

### Layer 3: KNOWN_PROP_KEYS (constants/figma-api.ts)
- 作用：白名单，normalizeProps 的最终过滤器
- **自动派生**：`Set([...PROPS values, ...PROP_METADATA keys, ...figmaKey values])`
- 不在这个 Set 里的属性会被 normalizeProps (node-normalizers.ts:262-268) 静默丢弃

## 依赖关系

```
ABBREV_EXPANSION 的输出值 ──必须存在于──▶ KNOWN_PROP_KEYS ──派生自──▶ PROPS + PROP_METADATA
```

## 新增属性 Checklist

1. **PROPS** (figma-api.ts): 加属性名常量
2. **PROP_METADATA** (figma-api.ts): 加元数据（type, figmaKey, 范围等）
3. **ABBREV_EXPANSION** (prop-dsl.ts): 如需缩写，加映射
4. **NUMERIC_PROPS / STRING_VALUE_PROPS** (prop-dsl.ts): 加到正确的值分类集合
5. **PROP_ORDER** (executor.ts): 如有依赖顺序（如必须在 layoutMode 之后），加排序优先级
6. **normalizeProps NAME_ALIASES** (node-normalizers.ts): 如需 CSS 别名（update 路径不经过 ABBREV_EXPANSION）

## 冗余说明

`gap` 同时存在于：
- ABBREV_EXPANSION: `gap` → `itemSpacing`（create 路径，parser 展开）
- normalizeProps NAME_ALIASES: `gap` → `itemSpacing`（update 路径，normalizer 展开）

这不是 bug——update 命令直接走 normalizeProps，不经过 ABBREV_EXPANSION，所以两处都需要。

## 历史 Bug

**counterAxisSpacing 被丢弃** (2026-03-13): `crossGap` → `counterAxisSpacing` 加了 ABBREV_EXPANSION，但没加 PROPS/PROP_METADATA，导致 KNOWN_PROP_KEYS 不包含它，被 normalizeProps 白名单过滤。修复：补全 Layer 2。
