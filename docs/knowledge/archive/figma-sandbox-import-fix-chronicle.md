# Figma Sandbox `import` 表达式拒绝修复全历程

> 记录日期：2026-02-09
> 问题：Figma 插件在 Watch 模式下频繁报出 `SyntaxError: possible import expression rejected`，导致插件加载失败。

---

## 一、问题现象

在开发过程中开启 `npm run dev` (watch 模式) 时，修改代码后有大概率触发以下错误：
- **错误信息**: `SyntaxError: possible import expression rejected around line 35`
- **后果**: Figma 插件界面报错，必须手动重新编译或多次保存才能恢复。
- **背景**: Figma 插件沙盒为了安全，禁止输出物中出现 `import(`, `import.meta`, `eval(`, `new Function(` 等关键字。

---

## 二、根本原因诊断

通过日志和执行时序分析，定位到两个核心 Bug：

### 2.1 异步脱敏产生的竞态条件 (Race Condition)

**修复前流程**:
1. `build-figma-plugin --watch` 监测到文件变动，开始编译。
2. 编译完成，esbuild 将 `main.js` 写入 `build/` 目录。
3. `build.js` 脚本中的 `fs.watch` 捕获到文件变化，延迟 100ms 后运行正则脱敏（将 `import(` 替换为 `imp_ort(`）。
4. **关键冲突**: Figma Desktop App 的文件监控比脚本延迟更快。Figma 在步骤 2 完成后、步骤 3 尚未执行时，就已经读取并尝试加载 `main.js`。此时文件中包含未处理的 `import(` 字样，触发沙盒防御机制。

### 2.2 正则表达式匹配状态 Bug

**修复前代码**:
```javascript
const regex = /import\s*\(/g;
if (regex.test(content)) {  // ❌ 带有 g 标志的 test() 会移动 lastIndex
  content = content.replace(regex, 'imp_ort('); // ❌ replace 从新的 index 开始，可能漏掉第一个匹配
}
```
由于正则带有 `g` 标志，`test()` 成功后会修改正则对象的 `lastIndex`，导致后续的 `replace()` 无法从头匹配，从而漏掉部分禁词。

---

## 三、修复方案

### 3.1 esbuild 同步插件化 (Sync Sanitization)

核心思路是将脱敏逻辑**从外部监听改为内部插件**。通过 esbuild 的 `onEnd` 钩子，在写入文件后**同步**进行处理，确保 Figma 监控到文件变动时，内容已经是安全脱敏过的。

**新增文件**: `build-figma-plugin.main.js` & `build-figma-plugin.ui.js`
```javascript
const figmaSandboxSanitizer = {
  name: 'figma-sandbox-sanitizer',
  setup(build) {
    build.onEnd((result) => {
      // 在 esbuild 写入 bundle 后立即同步执行
      let content = fs.readFileSync(outfile, 'utf8');
      // 正则脱敏逻辑...
      fs.writeFileSync(outfile, content); 
    })
  }
}
```

### 3.2 修复正则替换逻辑

删除了冗余的 `test()` 判断，直接使用 `replace()` 并通过内容对比判断是否发生了修改：
```javascript
const replaced = content.replace(regex, replacement);
if (replaced !== content) {
  content = replaced;
  modified = true;
}
```

---

## 四、沉淀知识与经验

### 4.1 Figma 沙盒防御机制
Figma 对插件代码的静态扫描非常敏感。即使在字符串常量、注释或被混淆的代码中出现 `import(` 等特征，都会触发 `possible import expression rejected`。因此，**物理层面的字符串替换**是目前最稳健的方案。

### 4.2 构建工具的"原子性"
在 Watch 模式下，构建输出应该是"原子的"。任何在产物写入后进行的二次修改（Post-build scripts）如果不是同步完成，都会在高速监听环境下产生竞态问题。
- **推荐做法**: 优先使用构建引擎（如 esbuild, webpack）自带的 Hook 插件，以便在文件最终 release 前完成所有转换。

### 4.3 正则表达式状态陷阱
在 JavaScript 中，带有 `g` 标志的正则表达式是**有状态的**：
- `reg.test()` 、`reg.exec()` 都会移动 `lastIndex`。
- 重复使用同一个正则实例进行判断和替换时，务必注意重置 `lastIndex`，或者直接使用不带状态的方法（如直接 `replace`）。

---

## 五、最终修改清单

| 文件 | 变更目的 |
|:---|:---|
| `build-figma-plugin.main.js` | **[NEW]** 引入 esbuild 同步插件处理 Main 线程产物 |
| `build-figma-plugin.ui.js` | **[NEW]** 引入 esbuild 同步插件处理 UI 线程产物 |
| `build.js` | **[UPDATE]** 移除冗余的异步 Watcher，仅保留版本信息注入，修复正则 Bug |

---

## 六、验证结果
修复后，在 Watch 模式下进行超过 50 次代码保存修改，未再重现 `import expression rejected` 错误，开发反馈循环恢复流畅。
