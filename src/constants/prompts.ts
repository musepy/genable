/**
 * @file prompts.ts
 * @description Centralized storage for system prompts and templates.
 * [ALIGNED] This file now strictly follows JSON-only protocols.
 */

/**
 * Global Icon Usage Template (Semantic Naming)
 * Used across different prompt sections to ensure consistent icon property generation.
 */
export const ICON_SEMANTIC_TEMPLATE = `
### ICON USAGE (Semantic Naming)
CRITICAL ICON RULES:
1. Only use icons you are confident exist in common icon sets.
2. Use the 'prefix:name' format (e.g., "lucide:arrow-right", "mdi:home") and kebab-case names.
3. If you are not sure, omit the ICON node rather than guessing.`;

/**
 * Base formatting rules for the LLM to ensure valid JSON FlatNode structure.
 */
export const JSON_FORMAT_RULES = `
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
    "width": 320,          // Number | "FILL" | "HUG"
    "height": 240,         // Number | "FILL" | "HUG"
    "characters": "Text content" 
  }
}

#### CONVENIENCE ALIASES (Normalized Automatically)
For ease of generation, you can also use these common property names:
- "backgroundColor": mapped to "fills"
- "borderRadius": mapped to "cornerRadius"
- "content": mapped to "characters"
- "spacing": mapped to "gap"
- "layout": mapped to "layoutMode" (e.g. "layout": "HORIZONTAL")

#### CRITICAL RULES:
1. **NO NESTING**: Do not use "children" property. Use "parent" references.
2. **VALID JSON**: Ensure every property and string is double-quoted.
3. **NO PROSE**: Output ONLY the JSON array.
`;
