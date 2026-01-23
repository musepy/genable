---
name: figma-to-code
description: >
  This skill should be used when generating Figma node structures from natural language descriptions.
  It ensures semantically correct layouts, proper sizing constraints, and accessible design patterns.
  Use this whenever the user asks to create, modify, or convert UI components.
---

# Figma to Code Generator

> Generate production-ready Figma designs as JSON from natural language descriptions.

## Decision Tree: Choosing Your Approach

```
User prompt → Is selection provided?
    ├─ Yes → Is it a text node?
    │         ├─ Yes → CONVERT_TEXT mode (Level 1 context)
    │         └─ No → Is it a container?
    │             ├─ Yes → MODIFY_LAYOUT mode (Level 2 context)
    │             └─ No → STYLE_CHANGE mode (Level 1 context)
    └─ No → Is prompt about a component?
        ├─ Yes → GENERATE_COMPONENT mode (Level 2 context)
        │         └─ Inject component specs from references/component-specs.md
        └─ No → Is prompt about a page/layout?
            ├─ Yes → GENERATE_PAGE mode (Level 3 context)
            │         └─ Inject layout rules from references/layout-rules.md
            └─ No → SIMPLE_GENERATE mode (Level 1 context)

On failure/retry → Escalate to Level 4 (add few-shot examples)
```

---

## Iron Laws (NEVER VIOLATE)

These constraints are absolute. Violation will be automatically corrected.

### 1. Button Height
```
Rule: Button height MUST be 44-48px
NEVER: 50px, 52px, 60px or any value > 48px
Fix: Force height to 44px
```

### 2. Nested Container Sizing
```
Rule: Nested containers MUST use "layoutSizingHorizontal": "FILL"
NEVER: Fixed widths like 320px, 360px, 375px, 390px, 393px inside layouts
Exception: Sidebar, Modal, Dialog (can be fixed)
Fix: Remove width, set layoutSizingHorizontal to FILL
```

### 3. Horizontal Child Fill
```
Rule: Children in HORIZONTAL layout MUST use FILL sizing
NEVER: FIXED sizing for direct children of HORIZONTAL containers
Fix: Set layoutSizingHorizontal to FILL, remove width
```

### 4. Avatar Circularity
```
Rule: Avatars MUST be circular
Formula: cornerRadius = MIN(width, height) / 2
Example: 64px avatar → cornerRadius: 32
```

### 5. Shadow Opacity
```
Rule: Shadows MUST be subtle (8-15% opacity)
NEVER: Pure black shadows (#000000)
Fix: Use "#00000014" (8% opacity)
```

### 6. Dark Background Contrast
```
Rule: Text on dark backgrounds MUST be white
Trigger: Background luminance < 100
Fix: Set text color to #FFFFFF
```

### 7. Input Field Height
```
Rule: Input fields MUST be 44-48px height
NEVER: < 40px or > 56px
Fix: Set height to 48px
```

### 8. Card Minimum Padding
```
Rule: Cards MUST have at least 16px padding
NEVER: Padding < 12px on any side
Fix: Set minimum padding to 16px
```

### 9. Divider Lines
```
Rule: Dividers MUST be 1px height, FILL width
NEVER: height FILL for dividers
Match: Names containing "line", "divider", "separator", "hr"
Exclude: "headline", "outline", "timeline", etc.
```

### 10. Text Line Height
```
Rule: Text MUST have explicit line height
Default: 150% of fontSize
Fix: Add lineHeight: { value: 150, unit: 'PERCENT' }
```

---

## Context Levels (Progressive Disclosure)

### Level 1: Minimal (Simple modifications)
- Role and task description
- Output schema only
- ~200 tokens

### Level 2: Standard (Component generation)
- Level 1 + Iron Law constraints
- Component anatomy if requested
- ~500 tokens

### Level 3: Full (Page/layout generation)
- Level 2 + Design system context
- Pattern insights and references
- Few-shot examples for complex layouts
- ~1000 tokens

### Level 4: Maximum (Retry/failure recovery)
- Level 3 + Multiple few-shot examples
- Explicit error correction guidance
- ~2000 tokens

---

## Output Schema

```json
{
  "type": "FRAME" | "TEXT" | "INSTANCE" | "VECTOR",
  "props": {
    "name": "string",
    "layout": "VERTICAL" | "HORIZONTAL" | "NONE",
    "gap": "number (multiples of 4: 4, 8, 12, 16, 24, 32)",
    "padding": { "top": "number", "right": "number", "bottom": "number", "left": "number" },
    "layoutSizingHorizontal": "FIXED" | "HUG" | "FILL",
    "layoutSizingVertical": "FIXED" | "HUG" | "FILL",
    "width": "number (ONLY for Root or FIXED)",
    "height": "number (ONLY for FIXED)",
    "fills": ["#HEX"],
    "cornerRadius": "number",
    "effects": [{"type": "DROP_SHADOW", "color": "#RRGGBBAA", "offset": {"x": 0, "y": 4}, "blur": 16}],
    "content": "string (TEXT only)",
    "fontSize": "number (TEXT only)",
    "fontWeight": "Regular | Medium | SemiBold | Bold",
    "color": "#HEX (TEXT only)"
  },
  "children": []
}
```

---

## Style Best Practices

1. **Contrast**: Light text on dark bg, Dark text on light bg
2. **Visual Hierarchy**:
   - H1: 24-32px Bold
   - Body: 14-16px Regular
   - Caption: 12px Muted
3. **Effects**:
   - Shadows: Soft and subtle (color: "#00000014", blur: 16, y: 4)
   - Borders: Subtle 1px borders (#E5E7EB) for cards/inputs
4. **Spacing**: Use multiples of 4 (4, 8, 12, 16, 24, 32)
