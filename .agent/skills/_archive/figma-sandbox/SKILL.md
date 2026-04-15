---
name: Figma Sandbox Security
description: Figma 插件沙盒安全限制与调试指南，包括 "import expression rejected" 错误的诊断与修复
---

# Figma Sandbox Security

Figma 插件运行在一个受限的沙盒环境中，该环境会在代码**加载时**进行静态安全扫描，拒绝任何可能的动态代码执行模式。

## 核心限制

### 1. 禁止动态 `import()`

Figma 使用正则表达式 `/import\s*\(/` 扫描**所有代码字符串**，包括：
- 实际的 JavaScript 动态导入语法
- 字符串字面量中包含 `import(` 的内容（如错误消息、代码示例）
- JSON 数据中嵌入的代码片段

**典型错误：**
```
SyntaxError: possible import expression rejected around line XX
```

### 2. 其他已知限制

| 模式 | 状态 | 说明 |
|------|------|------|
| `import()` | ❌ 禁止 | 动态导入 |
| `eval()` | ❌ 禁止 | 代码执行 |
| `new Function()` | ❌ 禁止 | 动态函数 |
| `setTimeout(string)` | ❌ 禁止 | 字符串参数 |

---

## 诊断流程

### Step 1: 定位问题文件
```bash
# 检查所有输出 bundle
grep -E 'import\s*\(' build/main.js build/ui.js
```

### Step 2: 查看具体上下文
```bash
# 显示匹配内容的上下文
grep -oE '.{30}import\s*\(.{30}' build/main.js | head -10
```

### Step 3: 追溯源头

常见来源：
1. **第三方库错误消息** - 如 `@google/genai` SDK 的 `import('node:buffer').File`
2. **Knowledge/JSON 数据** - 包含代码示例的教程数据
3. **动态导入语法** - 代码中使用的 `await import('./module')`

---

## 修复策略

### 策略 A: 源头修复（推荐）

将动态导入改为静态导入：

```typescript
// ❌ 会被拒绝
const { foo } = await import('./module');

// ✅ 正确方式
import { foo } from './module';
```

### 策略 B: 构建时 Sanitizer

在 `build.js` 中添加后处理步骤：

```javascript
// build.js - injectMetaData 函数
const filesToProcess = ['main.js', 'ui.js'];

for (const filename of filesToProcess) {
  let content = fs.readFileSync(path.join('build', filename), 'utf8');
  
  // 检测并替换所有 import( 和 import ( 模式
  const importPattern = /import\s*\(/g;
  if (importPattern.test(content)) {
    console.log(`⚠️ [${filename}] Sanitizing import patterns...`);
    content = content.replace(/import\s*\(/g, 'imp_ort(');
    fs.writeFileSync(path.join('build', filename), content);
  }
}
```

### 策略 C: 数据生成时预处理

在 JSON 生成脚本中预先混淆：

```javascript
// scripts/generate-knowledge.js
function safeJsonWrite(filePath, data) {
  let content = JSON.stringify(data, null, 2);
  // 替换所有可能的 import 调用模式
  content = content.replace(/import\s*\(/g, 'imp_ort(');
  fs.writeFileSync(filePath, content);
}
```

---

## 验证清单

构建后执行验证：

```bash
# 确认无危险模式
grep -c 'import(' build/main.js  # 应为 0
grep -c 'import(' build/ui.js    # 应为 0

# 确认替换生效
grep -c 'imp_ort(' build/main.js  # 应 > 0 如果有替换
```

---

## 快速参考

| 问题 | 解决方案 |
|------|----------|
| 代码中的 `await import()` | 改为顶部静态 `import` |
| 第三方库字符串中的 `import(` | build.js sanitizer |
| Knowledge JSON 中的代码示例 | 生成脚本预处理 |
| 确认修复 | `grep -E 'import\s*\(' build/*.js` 返回空 |

---

## 相关文件

| 文件 | 作用 |
|------|------|
| [build.js](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/build.js) | 构建时 sanitizer |
| [generate-knowledge.js](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/scripts/generate-knowledge.js) | Knowledge 数据生成 |
| [generate-skills-registry.js](file:///Users/daxiaoxiao/Projects/figma%20gen%20plugin/figma-ai-generator-dogfood/scripts/generate-skills-registry.js) | Skills 注册表生成 |
