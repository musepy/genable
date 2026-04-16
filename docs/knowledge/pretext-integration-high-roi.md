# Pretext Integration — High ROI Analysis

> Pretext: 纯 JS 文字测量 & 布局库，绕过 DOM `getBoundingClientRect`，支持所有语言（CJK/RTL/emoji）。
> 仓库: https://github.com/chenglou/pretext (39K stars)

## 高 ROI 应用点（只看 UI Canvas 层）

### 1. 替换 Canvas Markdown Engine（ROI: ⭐⭐⭐⭐⭐）

**当前实现** (`src/ui/components/canvas-markdown/engine.ts`):

| 函数 | 当前逻辑 | Pretext 替换方案 | 收益 |
|------|---------|-----------------|------|
| `segmentText()` (256-288) | 手写 CJK Unicode 范围检测 | `prepareWithSegments()` 内置 unicode segmentation | 更准确的 emoji 组合、阿拉伯语分段 |
| `ctx.measureText(seg)` (401,452,502) | 每次换行都测量 | `prepare()` 缓存测量结果 | resize 只需纯算术 `layout()` |
| 换行逻辑 (455-458) | 手写 `lineX + segW > textRight` | `layoutWithLines()` | 标准化换行算法 |
| Bidi/RTL | **缺失** | Pretext 已实现（pdf.js Bidi） | 支持阿拉伯语、希伯来语用户 |

**代码对比**:

```ts
// 当前 engine.ts:256-288, 401-502
function segmentText(text: string): string[] {
  const segs: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isCJK(code)) {
      if (buf) { segs.push(buf); buf = ''; }
      segs.push(text[i]!);
    } else if (text[i] === ' ') {
      buf += ' ';
      segs.push(buf);
      buf = '';
    } else {
      buf += text[i];
    }
  }
  if (buf) segs.push(buf);
  return segs;
}

// Canvas measureText 在循环中调用
const segW = ctx.measureText(seg).width;
if (lineX + segW > textRight && lineX > textLeft) {
  lineX = textLeft;
  lineY += style.lineHeight;
}
```

**Pretext 方案**:

```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

// 一次性分析 + 测量（resize 不重测）
const prepared = prepareWithSegments(text, '12px Inter')
const { lines } = layoutWithLines(prepared, maxWidth, lineHeight)

// 渲染
for (const line of lines) {
  ctx.fillText(line.text, line.x, line.y)
}
```

**ROI 计算**:
- **开发成本**: 1-2 天（替换 `segmentText` + `layout` 逻辑）
- **性能提升**: resize 场景从 O(n) Canvas API 调用 → O(1) 纯算术
- **国际化**: 阿拉伯语/RTL 用户从"无法使用" → "正确渲染"
- **维护**: 手写 Unicode 范围检测 → 库维护

---

### 2. Figma iframe Sandbox 兼容性（ROI: ⭐⭐⭐⭐）

**关键限制** (`docs/knowledge/vercel-sdk/vercel-sdk-bundle-feasibility.md`):

| 限制 | 影响 | Pretext 是否符合 |
|------|------|----------------|
| 无 Node.js API | 不能用 fs/path | ✅ Pretext 是纯浏览器 JS |
| 禁止 `eval()`/`new Function()` | 动态代码执行 | ✅ Pretext 无动态代码 |
| `neutral` target | 需要 browser-first | ✅ Pretext 目标是浏览器 Canvas |
| CORS 限制 | 不能直接调用外部 API | ✅ Pretext 无外部调用 |

**验证步骤**:
```bash
# 1. 安装
npm install @chenglou/pretext

# 2. 检查 bundle size
node build.js
# 当前 main.js (sandbox): 646 KB
# 预估增加: ~30 KB (Pretext dist)

# 3. Sandbox smoke test
# 在 Figma desktop 运行插件，验证 canvas measureText 替换工作
```

---

### 3. 性能场景对比（ROI: ⭐⭐⭐）

| 场景 | 当前 | Pretext | 差异 |
|------|------|---------|------|
| **初始渲染** | `measureText` × N 次 | `prepare()` × 1 次 + `layout()` | 相同（都需测量） |
| **窗口 resize** | `measureText` × N 次（重测） | `layout()` 纯算术（缓存） | **显著提升** |
| **滚动虚拟化** | 无法预测高度 | `prepare()` → `layout(height)` | **解锁新能力** |
| **阿拉伯语用户** | 文本乱序 | 正确 RTL 分段 | **从 0 → 1** |

---

### 4. 不适用的场景（ROI: ⭐）

| 场景 | 原因 |
|------|------|
| Figma TEXT node 创建 | Figma API 是渲染引擎，无法绕过 |
| Figma 文字测量缓存 | Figma 无预计算 API，最终高度由 Figma 决定 |

---

## 实施路径（最小侵入）

### Phase 1: 验证 Sandbox 兼容性（半天）

```bash
# 创建测试文件
tools/ui-preview/pretext-sandbox-test.html

# 引入 Pretext
<script src="https://unpkg.com/@chenglou/pretext/dist/layout.js"></script>

# 测试核心 API
const prepared = prepareWithSegments('测试文字', '12px Inter')
const { lines } = layoutWithLines(prepared, 300, 18)
console.log(lines) // 验证输出

# 在 Figma desktop 运行，检查是否有 sandbox error
```

### Phase 2: 替换 segmentText（1 天）

**文件**: `src/ui/components/canvas-markdown/engine.ts`

**修改点**:
1. 删除 `isCJK()` + `segmentText()` (256-288)
2. 修改 `layout()` 函数，使用 `prepareWithSegments()`
3. 替换 `ctx.measureText()` → Pretext 缓存测量

**验证**:
- `tools/canvas-md-preview.html` 对比 Before/After
- 中英混排、emoji 组合测试

### Phase 3: Bidi 支持（可选，半天）

如果用户反馈需要阿拉伯语支持：
- Pretext 已内置 Bidi
- 验证 RTL 文本渲染正确

---

## 风险评估

| 风险 | 影响 | 应对 |
|------|------|------|
| Pretext API 不稳定 | 0.0.4 版本 | 等待 1.0 稳定版，或 fork 固定版本 |
| Bundle 增加 | +30 KB | 可接受（当前 646 KB，+4.6%） |
| Canvas DPI 处理差异 | 可能影响测量精度 | 测试 DPI=2 场景（MacBook Pro） |
| Emoji 组合序列 | Pretext 支持，需验证 | 用 👨‍👩‍👧‍👦 测试 |

---

## 结论

**ROI 排序**:
1. **替换 Canvas Markdown Engine** - 高 ROI，低风险
2. **Sandbox 兼容性验证** - 必要前置步骤
3. **Bidi/emoji 支持** - 根据用户需求决定

**不推荐**:
- Figma TEXT node 预计算（架构不适用）
- 绕过 Figma API（Pretext 核心价值对 Figma 无效）

**下一步**:
1. 创建 `tools/ui-preview/pretext-sandbox-test.html` 验证 sandbox 兼容性
2. 如果通过，替换 `engine.ts` 的 `segmentText` + 换行逻辑
3. 用 `tools/ui-alignment-preview.html` + `tools/theme-color-test.html` 验证 UI 不破坏

---

## 参考文件

| 文件 | 用途 |
|------|------|
| `src/ui/components/canvas-markdown/engine.ts` | 当前 Canvas 布局引擎（替换目标） |
| `src/ui/components/canvas-markdown/CanvasTextBlock.tsx` | Canvas TextBlock 组件（调用 engine） |
| `tools/ui-preview/canvas-textblock.html` | Before/After 验证工具 |
| `.claude/skills/ui-visual-audit/SKILL.md` | UI 审查方法论 |
| `docs/knowledge/vercel-sdk/vercel-sdk-bundle-feasibility.md` | Figma sandbox 限制参考 |