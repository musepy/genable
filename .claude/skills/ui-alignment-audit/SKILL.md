---
name: ui-alignment-audit
description: Systematic UI alignment audit — calculate all element positions, build preview with debug guides, automate pass/fail verification with playwright screenshots
trigger: (check alignment|audit spacing|verify layout|检查对齐|间距审计|对齐审查|alignment grid|文字对齐|左右对齐)
---

# UI Alignment Audit

Systematic methodology for verifying that ALL text across every UI page aligns to a shared grid. Prevents the "8 different left edges" problem where each component independently picks padding values.

## Core Principle

**Text alignment is the primary grid. Containers are derived.**

Don't start from containers and hope text aligns. Start from "all text must be at X pixels" and calculate container padding backward.

## Alignment Grid (This Project)

```
PLUGIN_WIDTH = 340px  (tokens.grid.pluginWidth)
SCROLL_PAD   = 12px   (tokens.grid.scrollPad)   — scroll area / page horizontal padding
BLOCK_PAD    = 10px   (tokens.grid.blockPad)     — content block internal horizontal padding

TEXT_LEFT    = 22px   (tokens.grid.textLeft)      — all text left edge
TEXT_RIGHT   = 318px  (tokens.grid.textRight)     — all text right edge
OUTER_PAD    = 22px   (tokens.grid.outerPad)      — for elements outside scroll area
```

**Two contexts:**
- Inside scroll area: `padding: Npx ${blockPad}px` → text at scrollPad + blockPad = 22
- Outside scroll area: `padding: Npx ${outerPad}px` → text at outerPad = 22

**Border rule:** Use `box-shadow: inset 0 0 0 0.5px` instead of `border` to avoid 1px offset.

**Nesting rule:** Only outermost container has horizontal padding. Children use `padding: Npx 0`.

## Workflow

### Step 1: Inventory All Elements

For each UI page (Chat, Settings, Onboarding, etc.), list every element that contains text:

```
Element              | padding/margin            | Context (in/out scroll)
---------------------|---------------------------|------------------------
User message         | padding: 4px 10px         | inside scroll (12px)
Tool header          | padding: 2px 10px         | inside scroll
StatusBlock          | padding: 4px 22px         | outside scroll
Canvas TextBlock     | engine T0=10              | inside scroll
Input textarea       | paddingLeft: 10           | inside scroll (via wrapper 12px)
Settings row         | padding: 6px 10px         | inside settings scroll (12px)
```

### Step 2: Calculate Absolute Positions

For each element, compute:
- **TextL** = sum of all left padding/margin from plugin edge to text
- **TextR** = PLUGIN_WIDTH minus sum of all right padding/margin
- **Target**: TextL = 22, TextR = 318

Flag any element where TextL != 22 or TextR != 318.

### Step 3: Build Preview HTML

Create `tools/ui-alignment-preview.html` with:
- Simulated plugin frame (340px)
- All element types rendered with real CSS values
- Debug mode (`?debug`): vertical guide lines at TEXT_LEFT (red), TEXT_RIGHT (red), SCROLL edges (blue)
- Audit mode (`?audit`): auto-measurement table with pass/fail per element

Key implementation pattern for the audit:
```js
function measureInFrame(el, label, frame) {
  const r = el.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const s = getComputedStyle(el);
  const padL = parseFloat(s.paddingLeft) || 0;
  const padR = parseFloat(s.paddingRight) || 0;
  const textL = Math.round(r.left - fr.left + padL);
  const textR = Math.round(r.right - fr.left - padR);
  return { textL, textR, ok: textL === 22 && textR === 318 };
}
```

### Step 4: Automated Verification

Use playwright CLI to screenshot and verify:
```bash
npx playwright screenshot --browser chromium --viewport-size="900,1200" \
  --full-page --wait-for-timeout=1500 \
  "file:///path/to/ui-alignment-preview.html?audit" \
  /tmp/audit.png
```

Red-highlighted rows in the audit table = misaligned elements.

### Step 5: Fix and Re-verify

Common fixes:
| Problem | Solution |
|---------|----------|
| border adds 1px | `border: none; box-shadow: inset 0 0 0 0.5px` |
| Double padding (nested containers) | Outer has padding, inner has `padding: Npx 0` |
| Element outside scroll area | Use `outerPad` (22px) instead of `blockPad` (10px) |
| Hardcoded pixel values | Replace with `tokens.grid.blockPad` / `tokens.grid.outerPad` |

After fixing, re-run the audit screenshot to confirm all rows are green.

### Step 6: Token-ize

All alignment values should reference `tokens.grid.*`, not hardcoded numbers:
- `tokens.grid.blockPad` — inside scroll area
- `tokens.grid.outerPad` — outside scroll area  
- `tokens.grid.scrollPad` — scroll container padding

Single source of truth: `src/ui/design-system/tokens/layout.ts` → `grid` export.

## Verification Methods

两种验证方式，必须至少用一种，不能只靠肉眼看截图。

### 方式 A：代码验证（精确）

在预览 HTML 中嵌入审计函数，用 `getBoundingClientRect()` + `getComputedStyle()` 精确测量每个元素的像素位置：

```js
function measure(el, frame) {
  const r = el.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const s = getComputedStyle(el);
  const textL = Math.round(r.left - fr.left + parseFloat(s.paddingLeft));
  const textR = Math.round(r.right - fr.left - parseFloat(s.paddingRight));
  const okL = textL === TARGET_L;
  const okR = textR === TARGET_R;
  return { textL, textR, okL, okR };
}
```

输出为 HTML 表格，不对齐的行标红（`background: #fff0f0`）。通过 `?audit` URL 参数触发。

**判定标准**：`textL === 22 && textR === 318`，不是"接近"，是精确相等。

### 方式 B：视觉验证（辅助）

在 canvas 或 DOM 上画对齐辅助线（`?debug` URL 参数）：
- 红色虚线 = TEXT 边缘（22, 318）
- 蓝色虚线 = CONTAINER 边缘（12, 328）

Canvas 内部辅助线实现：
```js
ctx.setLineDash([2, 4]);
ctx.strokeStyle = 'rgba(255,0,0,0.5)';
ctx.beginPath(); ctx.moveTo(T0, 0); ctx.lineTo(T0, totalH); ctx.stroke();
```

DOM 辅助线实现：
```css
.debug-line { position: absolute; top: 0; bottom: 0; border-left: 1px dashed red; }
.debug-line.t-left { left: 22px; }
```

视觉验证用于快速检查，但**不能替代代码验证**——1px 偏差肉眼不可见。

### 自动化截图复现

用 playwright CLI 截图，确保在无头浏览器中也能复现：
```bash
# 截审计表
npx playwright screenshot --browser chromium --viewport-size="900,1200" \
  --full-page --wait-for-timeout=1500 \
  "file:///path/to/ui-alignment-preview.html?audit" /tmp/audit.png

# 截视觉辅助线
npx playwright screenshot --browser chromium --viewport-size="340,900" \
  --full-page --wait-for-timeout=1000 \
  "file:///path/to/ui-alignment-preview.html?debug" /tmp/debug.png
```

**复现要点**：
- viewport 宽度必须能容纳 340px plugin frame（加上 body padding）
- `--wait-for-timeout` 至少 1000ms（等 canvas 渲染 + 审计函数执行）
- 审计表截图：viewport 要足够宽（≥700px），否则表格文字太小无法读取
- 结果截图用 `Read` 工具查看，确认无红色行

## When to Run

- After adding new UI components
- After changing padding/margin on any element
- After restructuring layout hierarchy (moving elements in/out of scroll areas)
- Before any UI-related PR

## Key Files

- `src/ui/design-system/tokens/layout.ts` — `grid` token definitions
- `tools/ui-alignment-preview.html` — preview with debug guides + audit
- `tools/canvas-md-preview.html` — markdown rich rendering preview

## Anti-Patterns

- **"looks close enough"** — 1px off is visible at 340px width, always verify with numbers
- **Using `tokens.space[N]` for alignment padding** — space tokens are for spacing between elements, not for grid alignment. Use `tokens.grid.*`
- **border: Npx solid** on containers that need pixel-perfect text alignment — borders eat layout space
- **Measuring by eye in screenshots** — always use the automated audit table
