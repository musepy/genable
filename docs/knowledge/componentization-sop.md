# Componentization SOP — 组件化最短路径

> 从 Login Form 实操提炼。解决 agent 40 次迭代死循环的根因。

## 核心原则

**Components-first, NOT design-first.**

先在画布顶层创建原子组件，再用 instance 组装页面。
绝不在已有组件内部创建子组件（Figma API 硬限制）。

## 失败模式（必须避免）

### 1. Component inside Component
```
create_component(icon inside Login Form component)
→ "Cannot move node. Reparenting would create a component inside a component"
```
**正确做法**: 组件在顶层创建，表单用 `<instance ref="..."/>` 引用。

### 2. ID 丢失追踪
```
clone_node → id "1444:58962"
create_component("1444:58962") → 返回新 id "1444:58966"
create_instance("1444:58962") → FAIL! 旧 ID 已失效
```
**规则**: `create_component` 后旧 ID 立即失效，必须用返回值中的新 ID。

### 3. JS 沙箱绕过
```
js({ code: "node.remove()" })        → BLOCKED
js({ code: "figma.currentPage..." })  → BLOCKED
js({ code: "parent.insertChild()" }) → BLOCKED
```
**规则**: 必须用对应工具 `delete_node` / `find_nodes` / `move_node`，不要试图用 `js` 绕过。

## 最短路径（4 步）

### Step 1: 创建原子组件（1 次 jsx）

用 `<component>` 元素直接创建 Figma Component，不需要先建 frame 再转换。

```jsx
jsx({markup: `
<component name="Text Input" w={356} layout="column" gap={8}>
  <text name="Label" size={14} weight="Medium" fill="#374151">Label</text>
  <frame name="Input Box" w="fill" h={44} corner={8} stroke="#D1D5DB"
         layout="row" align="center" p={{left: 16, right: 16}}>
    <text name="Placeholder" size={14} fill="#9CA3AF">Placeholder text</text>
  </frame>
</component>

<component name="Primary Button" w={356} h={48} corner={8} bg="#4F46E5"
           layout="row" justify="center" align="center">
  <text name="Label" size={16} weight="SemiBold" fill="#FFFFFF">Button</text>
</component>

<component name="Social Button" w={356} h={44} corner={8} stroke="#D1D5DB"
           layout="row" gap={8} justify="center" align="center">
  <frame name="Icon" w={20} h={20} corner={4} bg="#E5E7EB"/>
  <text name="Label" size={14} weight="Medium" fill="#374151">Continue with Service</text>
</component>
`})
```

**关键**: 多个 `<component>` 在同一次 jsx 调用中创建，全部在画布顶层。

### Step 2: 添加组件属性（inspect + add_component_prop）

先 `inspect` 拿子节点 ID，然后 **并行** 添加所有 props：

```
inspect({node: "{TextInputId}", mode: "tree", depth: 3})
→ 拿到 Label ID、Placeholder ID

add_component_prop({node: TextInputId, name: "Label", type: "TEXT", default: "Label", bind: LabelId})
add_component_prop({node: TextInputId, name: "Placeholder", type: "TEXT", default: "Placeholder text", bind: PlaceholderId})
add_component_prop({node: ButtonId, name: "Label", type: "TEXT", default: "Button", bind: ButtonLabelId})
add_component_prop({node: SocialId, name: "Label", type: "TEXT", default: "Continue with Service", bind: SocialLabelId})
add_component_prop({node: SocialId, name: "Show Icon", type: "BOOLEAN", default: "true", bind: IconId})
// ↑ 全部并行发送
```

### Step 3: 用 instance 组装页面（1 次 jsx）

用 `<instance ref="ComponentName"/>` 直接在 jsx 中创建实例：

```jsx
jsx({markup: `
<frame name="Login Form" w={420} layout="column" gap={24} p={32}
       bg="#FFFFFF" corner={16} shadow="0 4 24 rgba(0,0,0,0.08)">
  <frame name="Header" w="fill" layout="column" gap={8}>
    <text size={28} weight="Bold" fill="#111827">Sign In</text>
    <text size={14} fill="#6B7280" w="fill">Welcome back</text>
  </frame>

  <frame name="Fields" w="fill" layout="column" gap={16}>
    <instance ref="Text Input"/>
    <instance ref="Text Input"/>
  </frame>

  <instance ref="Primary Button"/>

  <frame name="Divider" w="fill" layout="row" gap={12} align="center">
    <line w="fill" stroke="#E5E7EB"/>
    <text size={14} fill="#9CA3AF">or</text>
    <line w="fill" stroke="#E5E7EB"/>
  </frame>

  <frame name="Social" w="fill" layout="column" gap={12}>
    <instance ref="Social Button"/>
    <instance ref="Social Button"/>
  </frame>

  <frame name="Footer" w="fill" layout="row" gap={4} justify="center">
    <text size={14} fill="#6B7280">Don't have an account?</text>
    <text size={14} fill="#4F46E5" weight="Medium">Sign up</text>
  </frame>
</frame>
`})
```

**注意**: `<instance ref="..."/>` 上的属性覆盖（如 `Label="Email"`）目前不生效。需要 Step 4。

### Step 4: 批量覆盖 instance 文本（1 次 set_text）

Instance 子节点 ID 格式: `I{instanceId};{componentChildId}`

```
set_text({nodes: [
  {node: "I{emailInstanceId};{labelTextId}", text: "Email"},
  {node: "I{emailInstanceId};{placeholderTextId}", text: "you@example.com"},
  {node: "I{pwdInstanceId};{labelTextId}", text: "Password"},
  {node: "I{pwdInstanceId};{placeholderTextId}", text: "••••••••"},
  {node: "I{buttonInstanceId};{buttonLabelId}", text: "Sign In"},
  {node: "I{googleInstanceId};{socialLabelId}", text: "Continue with Google"},
  {node: "I{appleInstanceId};{socialLabelId}", text: "Continue with Apple"}
]})
```

**关键**: 一次 `set_text` 批量处理所有 7 个文本覆盖，不要逐个调用。

## 工具调用统计

| 步骤 | 工具 | 次数 | 可并行 |
|------|------|------|--------|
| 1. 创建组件 | jsx | 1 | - |
| 2a. 读子节点 | inspect | 1 | - |
| 2b. 绑定属性 | add_component_prop | 5 | ✅ 全部并行 |
| 3. 组装表单 | jsx | 1 | - |
| 4. 文本覆盖 | set_text | 1 | - |
| 验证 | inspect+screenshot | 1 | - |

**总计: 10 次调用，4 步有效操作。**

## 对比：失败路径 vs SOP 路径

| 维度 | Qwen 失败路径 | SOP 路径 |
|------|-------------|---------|
| 迭代次数 | 40（全部耗尽） | 10 |
| 完成度 | 未完成 | 100% |
| 根因 | design-first → 组件内建组件 → ID丢失 → JS绕过 → 死循环 | components-first → instance 组装 → 无冲突 |
| 关键差异 | 先建 flat design，再试图 componentize | 先建 component，再用 instance 组装 |

## 适用范围

此 SOP 适用于任何包含可复用元素的页面组件化：
- **Form**: Input、Button、Select → instance
- **Card list**: Card component → multiple instances
- **Navigation**: NavItem component → instances with text override
- **Dashboard**: Widget components → instances in grid

核心不变: **先建原子组件，再用 instance 组装。绝不在组件内部创建子组件。**
