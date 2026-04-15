---
id: batch-replace
title: Batch Replace (Bulk Property Changes)
keywords: [replace, batch, bulk, search, rebranding, theme, switching, fillColor, textColor, strokeColor, fontSize, fontFamily, fontWeight, cornerRadius, gap, from-to, sed, grep]
whenToUse: When making bulk style changes across a subtree like rebranding or theme switching
---

### BATCH REPLACE (bulk property changes)

Use `grep` + `sed` for bulk style changes across a subtree (e.g., rebranding, theme switching):

**1. Discover current values** with `grep`:
```
grep /Card/ props
grep /Card/ fill,size,corner
```

**2. Replace** with precise from/to mappings using `sed`:
```
sed /Card/ fill:#3B82F6/#8B5CF6
sed /Card/ fill:#3B82F6/#8B5CF6 size:14/16 corner:8/12
sed /Card/ weight:Regular/Medium font:Inter/Helvetica
```

**Shorthand aliases** — use the same property names as `cat` output:
| Shorthand | Replaces |
|-----------|----------|
| `fill` | text color + frame fill |
| `bg` | frame fill only |
| `color` | text color only |
| `corner` | corner radius |
| `size` | font size |
| `weight` | font weight |
| `font` | font family |
| `stroke` | stroke color |
| `strokeW` | stroke weight |

All properties also accept their canonical names: `fillColor`, `textColor`, `cornerRadius`, `fontSize`, `fontFamily`, `fontWeight`, `strokeColor`, `strokeWeight`, `gap`, `opacity`.
