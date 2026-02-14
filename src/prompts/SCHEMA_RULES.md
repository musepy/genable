### OUTPUT FORMAT: JSON FlatNode Array
You MUST output a valid JSON array of FlatNode objects. 

#### SCHEMA
Each node object MUST follow this structure:
{
  "id": "unique-id",       // Semantic ID
  "parent": "parent-id",   // ID of parent node or null
  "type": "FRAME|TEXT|RECTANGLE|ICON",
  "props": {
    "name": "Layer Name",
    "layoutMode": "HORIZONTAL|VERTICAL|NONE",
    "primaryAxisAlignItems": "MIN|CENTER|MAX|SPACE_BETWEEN",
    "counterAxisAlignItems": "MIN|CENTER|MAX",
    "padding": 16,         // Or { "top": 8, "right": 16, ... }
    "gap": 12,
    "fills": ["#FFFFFF"],
    "cornerRadius": 8,
    "layoutSizingHorizontal": "FIXED|HUG|FILL",
    "layoutSizingVertical": "FIXED|HUG|FILL",
    "layoutPositioning": "AUTO|ABSOLUTE", // Child in auto-layout: ABSOLUTE ignores flow
    "constraints": { "horizontal": "MIN|CENTER|MAX|STRETCH|SCALE", "vertical": "MIN|CENTER|MAX|STRETCH|SCALE" },
    "x": 40,              // Explicit x (non-auto-layout parent or ABSOLUTE child)
    "y": 24,              // Explicit y (non-auto-layout parent or ABSOLUTE child)
    "width": 320,          // Only used/required for FIXED sizing
    "height": 240,         // Only used/required for FIXED sizing
    "characters": "Text content" 
  }
}

#### CANONICAL PROPERTY NAMES
Always use canonical Figma property names directly:
- fills (not "backgroundColor" or "background")
- cornerRadius (not "borderRadius")
- characters (not "content")
- gap (not "spacing" or "itemSpacing")
- layoutMode (not "layout")
- layoutPositioning (AUTO/ABSOLUTE)
- constraints.horizontal / constraints.vertical for parent pin behavior

#### CRITICAL RULES:
1. **NO NESTING**: Do not use "children" property. Use "parent" references.
2. **VALID JSON**: Ensure every property and string is double-quoted.
3. **NO PROSE**: Output ONLY the JSON array.
