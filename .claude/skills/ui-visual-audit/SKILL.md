---
name: ui-visual-audit
description: Systematic UI visual audit — alignment grid, theme colors, canvas flicker. All verified by code measurement, not by eye.
trigger: (check alignment|audit spacing|verify layout|检查对齐|间距审计|对齐审查|alignment grid|文字对齐|左右对齐|主题颜色|亮暗切换|theme color|dark mode|闪烁|flicker|visual audit|视觉审查)
---

# UI Visual Audit

Three audits under one principle: **don't trust eyes, measure with code**.

| Audit | What | How | Tool |
|-------|------|-----|------|
| Alignment | Text left/right pixel positions | `getBoundingClientRect` + padding calc | `ui-alignment-preview.html?audit` |
| Theme | Canvas pixel colors in light/dark | `getImageData` pixel sampling on solid blocks | `theme-color-test.html` |
| Flicker | Blank frames during theme toggle | Pixel sampling between clear→render | `flicker-test.html?auto` |

## Core Principle

**Code verification > visual inspection.**

- 1px alignment error: invisible to eye, caught by `textL === 22`
- Wrong theme color on canvas: hard to spot in context, caught by `luminance(pixel) > 180`
- Canvas flicker: 16ms flash, caught by `isBlank(pixel) === true` count

## Audit 1: Alignment Grid

### Grid Constants (`tokens.grid`)

```
PLUGIN_WIDTH = 340px    scrollPad = 12px    blockPad = 10px
TEXT_LEFT    = 22px     TEXT_RIGHT = 318px  OUTER_PAD = 22px
```

- Inside scroll area: `padding: Npx ${blockPad}px` → text at 22
- Outside scroll area: `padding: Npx ${outerPad}px` → text at 22
- Border: use `box-shadow: inset` instead of `border` to avoid 1px offset
- Nesting: only outermost container has horizontal padding

### Measurement

```js
function measure(el, frame) {
  const r = el.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();
  const s = getComputedStyle(el);
  const textL = Math.round(r.left - fr.left + parseFloat(s.paddingLeft));
  const textR = Math.round(r.right - fr.left - parseFloat(s.paddingRight));
  return { textL, textR, pass: textL === 22 && textR === 318 };
}
```

**Pass criteria**: `textL === 22 && textR === 318` — exact, not approximate.

### Run

```bash
npx playwright screenshot --browser chromium --viewport-size="900,1200" \
  --full-page --wait-for-timeout=1500 \
  "file:///path/to/tools/ui-alignment-preview.html?audit" /tmp/align-audit.png
```

Red rows = misaligned. Fix, re-run until all green.

### Common Fixes

| Problem | Fix |
|---------|-----|
| border adds 1px | `border: none; box-shadow: inset 0 0 0 0.5px` |
| Double padding (nested) | Outer: `padding: Npx ${blockPad}px`, inner: `padding: Npx 0` |
| Outside scroll area | Use `outerPad` not `blockPad` |
| Hardcoded pixels | Replace with `tokens.grid.*` |

---

## Audit 2: Theme Colors

Canvas `fillStyle` cannot use CSS variables (`var(--gray-12)`). Must resolve to actual RGB values. Verify the resolved colors are correct for each theme.

### Measurement

Render solid color blocks (NOT text — anti-aliasing corrupts samples) and read pixels:

```js
// Resolve CSS variable via probe element
function resolveVar(varName, prop = 'color') {
  const probe = document.createElement('div');
  probe.style[prop] = `var(${varName})`;
  document.body.appendChild(probe);
  const val = getComputedStyle(probe)[prop];
  document.body.removeChild(probe);
  return val;  // e.g. "rgb(23, 23, 23)"
}

// Sample canvas pixel
function samplePixel(ctx, x, y) {
  const px = ctx.getImageData(x, y, 1, 1).data;
  return { r: px[0], g: px[1], b: px[2] };
}

function luminance(px) {
  return 0.299 * px.r + 0.587 * px.g + 0.114 * px.b;
}
```

### Pass Criteria

| Element | Light mode | Dark mode |
|---------|-----------|-----------|
| Background | L > 200 | L < 60 |
| --gray-12 (text) | L < 60 | L > 180 |
| --gray-11 (secondary) | L < 160 | L > 120 |
| --accent-11 | B > R && B > 80 | B > R && B > 80 |
| Fade gradient end | matches bg ±10 | matches bg ±10 |
| **Floating card** bg/text/close/fade | same rules as above | same rules as above |

**Key rule**: sample from solid `fillRect` blocks, not from text pixels (anti-aliasing makes text edge pixels unreliable).

### Run

```bash
npx playwright screenshot --browser chromium --viewport-size="800,1600" \
  --full-page --wait-for-timeout=2000 \
  "file:///path/to/tools/theme-color-test.html" /tmp/theme-audit.png
```

Page auto-runs both themes and shows pass/fail table.

### Common Fixes

| Problem | Fix |
|---------|-----|
| `getPropertyValue` returns empty | Use probe element: `div.style.color = 'var(--x)'; getComputedStyle(div).color` |
| Canvas doesn't re-render on theme switch | MutationObserver on `<html>` attributes + `requestAnimationFrame` |
| Fade gradient uses `'transparent'` | Use `rgba(r,g,b,0)` with same RGB as background |
| Fallback color wrong for one theme | Detect current theme, use appropriate default |

---

## Audit 3: Canvas Flicker

When canvas re-renders (theme switch, content update), `clearRect` → `render` creates a blank frame. Verify double-buffering eliminates it.

### Measurement

```js
// After clearRect, BEFORE render — sample center pixel
const px = ctx.getImageData(W/2, H/2, 1, 1).data;
const isBlank = px[3] === 0;  // fully transparent = cleared canvas
```

### Pass Criteria

| Method | Blank frames allowed |
|--------|---------------------|
| clearRect → render (bad) | Will have blank frames |
| offscreen → drawImage (good) | **0 blank frames** |

### Double-buffer Pattern

```js
// Render to offscreen canvas
const offscreen = document.createElement('canvas');
offscreen.width = width * dpr;
offscreen.height = height * dpr;
const octx = offscreen.getContext('2d');
octx.setTransform(dpr, 0, 0, dpr, 0, 0);
// ... all drawing on octx ...

// Atomic swap — visible canvas never blank
canvas.width = width * dpr;
canvas.height = height * dpr;
const ctx = canvas.getContext('2d');
ctx.drawImage(offscreen, 0, 0);
```

### Run

```bash
npx playwright screenshot --browser chromium --viewport-size="700,600" \
  --wait-for-timeout=3000 \
  "file:///path/to/tools/flicker-test.html?auto" /tmp/flicker.png
```

Auto-runs 20 rapid toggles. Result shows blank frame count for each method.

---

## Before/After Preview Method

When fixing a visual bug, don't apply directly to real code. Instead:

1. **Create a preview page** in `tools/ui-preview/` that simulates the real plugin UI
2. **Add two panels side by side**: Before (reproducing current bugs) and After (with fixes)
3. **Add Audit button** that auto-samples pixels from both panels, reports pass/fail
4. **Verify After panel passes all checks** before touching real code
5. **Apply verified fixes** to real code in one clean commit

Example: `tools/ui-preview/canvas-textblock.html` — Before shows probe-based fade + no float theme re-render; After shows destination-out + double-buffer + theme listener. Audit confirms After fixes all issues Before has.

**Key patterns verified this way:**
- `destination-out` fade: `ctx.globalCompositeOperation = 'destination-out'` — theme-independent, no bg color probe
- Double-buffer: offscreen canvas → `drawImage` — no flicker (0/20 blank frames vs 20/20)
- `useThemeKey()`: MutationObserver + rAF on `<html>` attributes → canvas re-renders on theme toggle

## When to Run

| Trigger | Which audit |
|---------|-------------|
| Changed padding/margin | Alignment |
| Changed CSS variables / theme code | Theme colors |
| Changed canvas rendering pipeline | Flicker + Theme |
| Adding new UI component | Alignment |
| Before UI-related PR | All three |

## Key Files

| File | Purpose |
|------|---------|
| `src/ui/design-system/tokens/layout.ts` | `grid` token definitions |
| `tools/ui-alignment-preview.html` | Alignment audit (`?audit` / `?debug`) |
| `tools/theme-color-test.html` | Theme color audit (auto-runs both themes) |
| `tools/flicker-test.html` | Flicker audit (`?auto` for stress test) |
| `tools/canvas-md-preview.html` | Markdown rich rendering preview |
| `tools/ui-preview/canvas-textblock.html` | Before/After canvas TextBlock comparison + audit |

## Anti-Patterns

- **"looks close enough"** — 1px alignment error, wrong theme shade, single-frame flicker are all invisible to eye
- **Sampling text pixels for color** — anti-aliasing blends with background; use solid `fillRect` blocks
- **`setTimeout` for theme debounce** — creates visible delay where DOM updated but canvas stale; use `requestAnimationFrame`
- **`'transparent'` in canvas gradients** — resolves to `rgba(0,0,0,0)`, creates gray band; use `rgba(r,g,b,0)` matching background
- **`border` on containers** — eats 1px from layout; use `box-shadow: inset`
