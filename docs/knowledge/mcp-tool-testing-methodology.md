# MCP Tool Capability Testing Methodology

From a comprehensive MCP tool test (2026-03-12) covering layout, effects, fills, strokes, and layer blending.

## Core Principles

### 1. Dimension Isolation → Cross-Combination

Single-attribute tests ("does shadow work?") rarely expose bugs. Real issues appear at **dimension intersections**:
- `layout:'row'` alone OK, but without `height:'hug'` defaults to h:100
- `shadow` single-layer OK, but `drop;drop;inset` triple syntax tests parser boundaries
- `w:'fill'` on normal frame OK, but on degraded frame update silently fails

**Method**: List independent dimensions (layout, positioning, effects, fills...), then intentionally create cross-points.

### 2. Control Group Design

Each test section needs **contrast pairs**, not isolated samples:
- AutoLayout vs no AutoLayout (layout engine vs absolute positioning)
- Opacity 1.0 → 0.1 in 5 steps (gradient, not just one value)
- `flex-end` vs `space-between` (different values within same dimension)

Contrast lets you instantly see "which value is wrong" instead of "something seems off but unsure where."

### 3. Intentionally Hit CSS ≠ Figma Mental Model Gaps

This is the highest-frequency bug source. **Actively use CSS thinking** in tests to see how the tool handles it:
- `alignItems:'stretch'` → Figma has no such value, should error or degrade
- `height:'auto'` vs `height:'hug'` → CSS auto ≠ Figma hug
- Default assumptions (CSS flex children stretch by default, Figma does not)

**Method**: Maintain a "CSS ↔ Figma confusion" checklist, test each boundary.

### 4. Complexity Escalation + Ultimate Composite

```
Section 1: Basic capability (single dimension)
Section 2: Contrast capability (same dimension, different values)
Section 3: Combination capability (cross-dimension)
Section 4: Composite (everything stacked in one real component)
```

The composite is the **most valuable test**. If a Dashboard Widget with nested autolayout + multi-layer shadow + stroke + stats + progress bar + glow dot renders correctly, it proves dimensions don't interfere with each other. One composite > five isolated single-attribute tests.

### 5. Inspect + Screenshot Immediately After Creation

**Don't trust return values. Trust rendered results.**

- `design()` returning `{"created": 9}` doesn't mean all properties are correct
- `inspect()` retrieves the actual property tree — verify `sizingH:'fill'` actually took effect
- `screenshot` is the final judge — visually confirm layout isn't broken

**Method**: `inspect(screenshot:true)` after each section, don't wait until everything is done.

### 6. Error Path Is Also a Test Target

The most valuable finding is often not "what works" but **"what happens when things break"**:
- Degraded frame: subsequent `update` silently fails → must delete + recreate
- Invalid enum value: no runtime error, silently degrades to 100x100 empty frame

These are real user pitfalls. **Intentionally construct invalid input to test error recovery path.**

## Test Structure Template

```
Test Panel (column, gap:32, p:40)
├── Section 1 — [Dimension A] basic + variants
│   ├── Case: default behavior
│   ├── Case: non-default value
│   ├── Case: nested / compound
│   └── Case: CSS-thinking trap
├── Section 2 — [Dimension B] with contrast to A
│   ├── Case: opposite of A's approach
│   └── Case: free-form / edge case
├── Section 3 — [Dimension C + D] cross-combination
│   ├── Case: C alone
│   ├── Case: D alone
│   └── Case: C + D combined
└── Section 4 — Composite (A + B + C + D in one real component)
    └── Realistic UI component exercising all dimensions
```

## Discovered Issues (2026-03-12)

| Issue | Root Cause | Resolution |
|-------|-----------|------------|
| `alignItems:'stretch'` rejected | Not a valid Figma enum (MIN/MAX/CENTER/BASELINE only) | Use `sizingH:'fill'` on children instead |
| Degraded frame resists `update` | Validation failure at creation time corrupts frame state | Must delete + recreate, cannot patch |
| `layout:'row'` without `height:'hug'` → h:100 | Figma default frame height is 100, autolayout hug must be explicit | Always pair `layout` with `height:'hug'` or explicit `h` |

## Key Takeaway

> Test **combinations and failure modes**, not individual properties. The MCP tool's single-attribute handling is almost always correct — bugs live at intersections and in recovery paths.
