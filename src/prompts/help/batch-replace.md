---
id: batch-replace
title: Batch Replace (Bulk Property Changes)
keywords: [replace, batch, bulk, search, rebranding, theme, switching, fillColor, textColor, strokeColor, fontSize, fontFamily, fontWeight, cornerRadius, gap, from-to]
whenToUse: When making bulk style changes across a subtree like rebranding or theme switching
---

### BATCH REPLACE (bulk property changes)
Use `replace` for bulk style changes across a subtree (e.g., rebranding, theme switching):

1. **Search first** to discover current values:
```json
replace({"mode": "search", "rootId": "100:5", "properties": ["fillColor", "fontSize"]})
```

2. **Replace** with precise from→to mappings:
```json
replace({"mode": "replace", "rootId": "100:5", "replacements": {"fillColor": [{"from": "#3B82F6", "to": "#8B5CF6"}]}})
```

Supported properties: fillColor, textColor, strokeColor, cornerRadius, gap, fontSize, fontFamily, fontWeight.
