# Color Token Usage Guidelines

## Core Principle
Use **SEMANTIC ROLES** instead of system-specific tokens for cross-design-system compatibility.

## Semantic Color Roles

### Text Colors
| Role | Usage | shadcn Token | M3 Token |
|------|-------|--------------|----------|
| `text.primary` | Main body text, headings | `foreground` | `onSurface` |
| `text.secondary` | Hints, placeholders, captions | `muted-foreground` | `onSurfaceVariant` |
| `text.disabled` | Disabled state text | `muted-foreground` | `onSurfaceVariant` |
| `text.inverse` | Text on colored surfaces | `primary-foreground` | `inverseOnSurface` |

### Surface Colors
| Role | Usage | shadcn Token | M3 Token |
|------|-------|--------------|----------|
| `surface.default` | Page background | `background` | `surface` |
| `surface.muted` | Subtle backgrounds | `muted` | `surfaceVariant` |
| `surface.card` | Card backgrounds | `card` | `surfaceContainerLow` |

### Action Colors
| Role | Usage | shadcn Token | M3 Token |
|------|-------|--------------|----------|
| `action.primary` | Primary buttons | `primary` | `primary` |
| `action.destructive` | Delete/danger actions | `destructive` | `error` |

## Usage in DSL

### ✅ CORRECT: Use semantic roles
```json
{
  "type": "TEXT",
  "props": {
    "content": "Secondary info",
    "color": "text.secondary"
  }
}
```

### ❌ WRONG: Use system-specific tokens directly
```json
{
  "type": "TEXT",
  "props": {
    "content": "Secondary info",
    "color": "muted-foreground"
  }
}
```

## Critical Rules

1. **NEVER use `muted` for text** - it's a background color
2. **Primary text should use `text.primary`**, not bare `foreground`
3. **For hints/placeholders, always use `text.secondary`**
4. **Badge text should use `text.inverse`** when on colored backgrounds
