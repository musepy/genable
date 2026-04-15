# Agent Tool Schemas Reference

This document contains all 24 tool schemas exported from `src/engine/agent/tools/index.ts`.

## `new_task`
**Description**: Signals the start of a clear semantic task. Triggers a new Task Card in the UI.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "A concise title for the task (e.g., \"Create Login UI\")."
    },
    "description": {
      "type": "string",
      "description": "A brief description of what this task accomplishes."
    },
    "stepId": {
      "type": "string",
      "description": "Optional ID. Use this if you are continuing or refining a specific step from a previous plan."
    }
  },
  "required": [
    "title"
  ]
}
```

---

## `update_todo_list`
**Description**: Dynamically manages sub-steps (todos) within the current active task.

**Modes**: `PLANNING`, `EXECUTION`, `RECOVERY`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "items": {
      "type": "array",
      "description": "List of todo items.",
      "items": {
        "type": "object",
        "description": "A single todo item.",
        "properties": {
          "id": {
            "type": "string",
            "description": "Unique ID for the todo item."
          },
          "label": {
            "type": "string",
            "description": "Human-readable description of the todo."
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "completed",
              "failed"
            ],
            "description": "Current status of this specific sub-item."
          }
        },
        "required": [
          "id",
          "label",
          "status"
        ]
      }
    }
  },
  "required": [
    "items"
  ]
}
```

---

## `summarize_progress`
**Description**: Periodically reports high-level progress or completes a task.

**Modes**: `EXECUTION`, `VERIFICATION`, `RECOVERY`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "summary": {
      "type": "string",
      "description": "A user-friendly summary of what has been achieved."
    },
    "isComplete": {
      "type": "boolean",
      "description": "Whether this signals the completion of the current task."
    },
    "nextMilestone": {
      "type": "string",
      "description": "Optional hint about what the agent will work on next."
    }
  },
  "required": [
    "summary"
  ]
}
```

---

## `complete_task`
**Description**: [REQUIRED] Signal task completion. You MUST call this tool to end execution. Do NOT just stop responding - explicitly call this tool with a summary.

**Modes**: `EXECUTION`, `VERIFICATION`, `RECOVERY`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "summary": {
      "type": "string",
      "description": "Summary of what was accomplished"
    },
    "verification": {
      "type": "string",
      "description": "Optional: how user can verify the result"
    }
  },
  "required": [
    "summary"
  ]
}
```

---

## `getProjectUIContext`
**Description**: Retrieve a REFERENCE technical specification for project UI components. Use ONLY when user explicitly requests project-specific implementations. For free design or generic systems (iOS, shadcn), rely on your own knowledge.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "component": {
      "type": "string",
      "description": "Specific component name to get details for (e.g., \"Button\", \"Card\", \"Header\"). Case-insensitive."
    },
    "category": {
      "type": "string",
      "description": "Filter components by category.",
      "enum": [
        "layout",
        "input",
        "display",
        "feedback",
        "navigation"
      ]
    },
    "query": {
      "type": "string",
      "description": "Search query to find relevant components by name or description."
    },
    "includeTokens": {
      "type": "boolean",
      "description": "Include design tokens (colors, spacing, typography) in the response. Useful for understanding the design system."
    }
  }
}
```

---

## `getDesignSystemTokens`
**Description**: Retrieve the project's design tokens (colors, spacing, typography, radius). Use these values to ensure generated designs match the project's visual language.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "tokenType": {
      "type": "string",
      "description": "Specific token category to retrieve.",
      "enum": [
        "colors",
        "spacing",
        "typography",
        "radius",
        "all"
      ]
    }
  }
}
```

---

## `listProjectComponents`
**Description**: List all available UI components in the project with brief descriptions. Use this to discover what components exist before creating designs.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Filter by component category.",
      "enum": [
        "layout",
        "input",
        "display",
        "feedback",
        "navigation"
      ]
    }
  }
}
```

---

## `inspectDesign`
**Description**: 
[SUPER TOOL] Unified read tool for Figma state.

MODE OPTIONS:
- "selection": Get currently selected nodes (names, types, IDs)
- "hierarchy": Get full DSL tree of a node and children (requires nodeId)
- "node": Get DSL of a single node (requires nodeId)

REPLACES: getSelection, getDeepHierarchy, getNodeDSL
Use this instead of those tools.


**Modes**: `PLANNING`, `EXECUTION`, `VERIFICATION`, `RECOVERY`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "selection",
        "hierarchy",
        "node"
      ],
      "description": "What to inspect"
    },
    "nodeId": {
      "type": "string",
      "description": "Required for hierarchy/node modes. ID of node to inspect."
    },
    "depth": {
      "type": "number",
      "description": "For hierarchy mode: max depth (default 5, max 10)"
    }
  },
  "required": [
    "mode"
  ]
}
```

---

## `generateDesign`
**Description**: 
[ONE-SHOT] Generate a complete UI component or layout in a single call.
Output ALL nodes as a flat list with parent references. The system reconstructs and renders the full tree.

This is the PREFERRED tool for creating new designs. Use createNode only for single-node edits.
You can freely specify fontFamily for TEXT nodes (any Google Font, e.g. "Roboto", "Poppins", "Noto Sans SC").

## Output Format Rules
1. First node MUST have parent: null (root).
2. Every other node references its parent by id.
3. ALL styling (fills, cornerRadius, gap, padding, fontSize, etc.) MUST go inside 'props'.
4. TEXT nodes MUST have characters in 'props'.
5. Root node MUST have explicit width and height in 'props'.
6. ICON nodes MUST have iconName in 'props' (format: "prefix:name", e.g., "lucide:home", "mdi:account").


**Modes**: `EXECUTION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "nodes": {
      "type": "array",
      "description": "Flat list of all nodes with parent references",
      "items": {
        "type": "object",
        "description": "A node: {id, parent, type, props}",
        "properties": {
          "id": {
            "type": "string",
            "description": "Semantic ID (e.g., \"email-label\", \"submit-btn\")"
          },
          "parent": {
            "type": "string",
            "description": "Parent node ID. For root node, use \"root\" or empty string."
          },
          "type": {
            "type": "string",
            "description": "FRAME | TEXT | RECTANGLE | ELLIPSE | LINE | ICON. Do NOT use VECTOR — use RECTANGLE for shapes, ELLIPSE for circles, ICON with iconName for icons."
          },
          "props": {
            "type": "object",
            "description": "All visual and layout properties for the node",
            "properties": {
              "name": {
                "type": "string",
                "description": "Layer name"
              },
              "iconName": {
                "type": "string",
                "description": "Iconify icon name for ICON nodes (e.g., \"lucide:home\", \"mdi:account\")"
              },
              "layoutMode": {
                "type": "string",
                "description": "HORIZONTAL | VERTICAL | NONE"
              },
              "primaryAxisAlignItems": {
                "type": "string",
                "description": "MIN | CENTER | MAX | SPACE_BETWEEN"
              },
              "counterAxisAlignItems": {
                "type": "string",
                "description": "MIN | CENTER | MAX"
              },
              "gap": {
                "type": "number",
                "description": "Spacing between children"
              },
              "padding": {
                "type": "number",
                "description": "Uniform padding (or use paddingTop/Right/Bottom/Left)"
              },
              "paddingTop": {
                "type": "number",
                "description": "Top padding"
              },
              "paddingRight": {
                "type": "number",
                "description": "Right padding"
              },
              "paddingBottom": {
                "type": "number",
                "description": "Bottom padding"
              },
              "paddingLeft": {
                "type": "number",
                "description": "Left padding"
              },
              "layoutPositioning": {
                "type": "string",
                "description": "AUTO | ABSOLUTE (for child in auto-layout parent)"
              },
              "constraints": {
                "type": "object",
                "description": "Pin/scale behavior relative to parent",
                "properties": {
                  "horizontal": {
                    "type": "string",
                    "description": "MIN | CENTER | MAX | STRETCH | SCALE | LEFT | RIGHT | LEFT_RIGHT"
                  },
                  "vertical": {
                    "type": "string",
                    "description": "MIN | CENTER | MAX | STRETCH | SCALE | TOP | BOTTOM | TOP_BOTTOM"
                  }
                }
              },
              "x": {
                "type": "number",
                "description": "Explicit x position. Valid for non-auto-layout parent, or ABSOLUTE child in auto-layout parent."
              },
              "y": {
                "type": "number",
                "description": "Explicit y position. Valid for non-auto-layout parent, or ABSOLUTE child in auto-layout parent."
              },
              "layoutGrow": {
                "type": "number",
                "description": "Auto-layout grow factor (usually 0 or 1)"
              },
              "layoutAlign": {
                "type": "string",
                "description": "MIN | CENTER | MAX | STRETCH | INHERIT"
              },
              "fills": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color OR gradient object. Solid: \"#FFFFFF\". Gradient: {\"type\":\"GRADIENT_LINEAR\",\"stops\":[{\"position\":0,\"color\":\"#C0C0C0\"},{\"position\":0.5,\"color\":\"#FFFFFF\"},{\"position\":1,\"color\":\"#808080\"}],\"angle\":135}"
                },
                "description": "Background fills. Hex strings for solid colors, or gradient objects for gradients."
              },
              "strokes": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color"
                },
                "description": "Border colors"
              },
              "strokeWeight": {
                "type": "number",
                "description": "Border width"
              },
              "cornerRadius": {
                "type": "number",
                "description": "Border radius in px"
              },
              "width": {
                "type": "number",
                "description": "Width in px (for FIXED sizing)"
              },
              "height": {
                "type": "number",
                "description": "Height in px (for FIXED sizing)"
              },
              "layoutSizingHorizontal": {
                "type": "string",
                "description": "FIXED | HUG | FILL"
              },
              "layoutSizingVertical": {
                "type": "string",
                "description": "FIXED | HUG | FILL"
              },
              "characters": {
                "type": "string",
                "description": "Text content (TEXT nodes only)"
              },
              "fontSize": {
                "type": "number",
                "description": "Font size in px"
              },
              "fontWeight": {
                "type": "string",
                "description": "e.g. \"Bold\", \"Medium\", \"Regular\""
              },
              "fontFamily": {
                "type": "string",
                "description": "Font family name. Supports any Google Font (e.g. \"Roboto\", \"Poppins\", \"Noto Sans SC\"). Defaults to \"Inter\"."
              },
              "lineHeight": {
                "type": "number",
                "description": "Line height in px (or {value, unit:\"PERCENT\"} for %)"
              },
              "letterSpacing": {
                "type": "number",
                "description": "Letter spacing in px"
              },
              "textAlignHorizontal": {
                "type": "string",
                "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
              },
              "textAlignVertical": {
                "type": "string",
                "description": "TOP | CENTER | BOTTOM"
              },
              "textCase": {
                "type": "string",
                "description": "ORIGINAL | UPPER | LOWER | TITLE | SMALL_CAPS | SMALL_CAPS_FORCED"
              },
              "textDecoration": {
                "type": "string",
                "description": "NONE | UNDERLINE | STRIKETHROUGH"
              },
              "textAutoResize": {
                "type": "string",
                "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
              },
              "textTruncation": {
                "type": "string",
                "description": "DISABLED | ENDING. Use ENDING for ellipsis (\"...\") truncation."
              },
              "maxLines": {
                "type": "number",
                "description": "Max visible lines before truncation. Requires textTruncation=ENDING and textAutoResize=TRUNCATE."
              },
              "paragraphSpacing": {
                "type": "number",
                "description": "Space between paragraphs in px"
              },
              "paragraphIndent": {
                "type": "number",
                "description": "First-line indent in px"
              },
              "opacity": {
                "type": "number",
                "description": "0.0 to 1.0"
              },
              "effects": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "Effect: {type, color, offset, blur, spread}",
                  "properties": {
                    "effectType": {
                      "type": "string",
                      "description": "DROP_SHADOW | INNER_SHADOW | LAYER_BLUR | BACKGROUND_BLUR"
                    },
                    "color": {
                      "type": "string",
                      "description": "Hex+alpha e.g. \"#0000001A\" (10% black), \"#4F46E533\" (20% indigo)"
                    },
                    "offset": {
                      "type": "object",
                      "description": "{x, y} in px",
                      "properties": {
                        "x": {
                          "type": "number",
                          "description": "Horizontal offset"
                        },
                        "y": {
                          "type": "number",
                          "description": "Vertical offset"
                        }
                      }
                    },
                    "blur": {
                      "type": "number",
                      "description": "Blur radius (4=subtle, 16=medium, 32=dramatic)"
                    },
                    "spread": {
                      "type": "number",
                      "description": "Spread radius (usually 0)"
                    }
                  }
                },
                "description": "Visual effects. Example: [{\"type\":\"DROP_SHADOW\",\"color\":\"#0000001A\",\"offset\":{\"x\":0,\"y\":4},\"blur\":16,\"spread\":0}]"
              }
            }
          }
        },
        "required": [
          "id",
          "type",
          "props"
        ]
      }
    },
    "stepId": {
      "type": "string",
      "description": "Plan step ID. MANDATORY if this call executes a task from your plan. Ensures progress is automatically marked as completed."
    }
  },
  "required": [
    "nodes"
  ]
}
```

---

## `renderSubtree`
**Description**: [STATE-DRIVEN] Render a complete UI subtree in one call. Use this for creating components or complex groups.
  
  Must provide a FLAT LIST of nodes (Adjacency List).
  - First node is the subtree root (parent: null).
  - All other nodes must reference a parentId from within this list.
  - All styling goes into 'props'.

**Modes**: `EXECUTION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "parentId": {
      "type": "string",
      "description": "Real Figma parent ID to attach this subtree to. If omitted, adds to current page."
    },
    "nodes": {
      "type": "array",
      "description": "Flat list of nodes to create. First node is root.",
      "items": {
        "type": "object",
        "description": "Node definition with id, type, props",
        "properties": {
          "id": {
            "type": "string",
            "description": "Temporary ID (e.g., \"root\", \"btn-text\")"
          },
          "parent": {
            "type": "string",
            "description": "Parent ID within this list. For root node, use \"root\" or empty string."
          },
          "type": {
            "type": "string",
            "description": "FRAME | TEXT | RECTANGLE | ELLIPSE | LINE | ICON"
          },
          "props": {
            "type": "object",
            "description": "All Figma properties (fills, gap, padding, etc.)",
            "properties": {
              "name": {
                "type": "string",
                "description": "Layer name"
              },
              "layoutMode": {
                "type": "string",
                "description": "HORIZONTAL | VERTICAL | NONE"
              },
              "gap": {
                "type": "number",
                "description": "Spacing between children"
              },
              "padding": {
                "type": "number",
                "description": "Uniform padding"
              },
              "fills": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color string"
                },
                "description": "Background colors (e.g. [\"#FFFFFF\"])"
              },
              "cornerRadius": {
                "type": "number",
                "description": "Border radius in px"
              },
              "width": {
                "type": "number",
                "description": "Width in px"
              },
              "height": {
                "type": "number",
                "description": "Height in px"
              },
              "layoutSizingHorizontal": {
                "type": "string",
                "description": "FIXED | HUG | FILL"
              },
              "layoutSizingVertical": {
                "type": "string",
                "description": "FIXED | HUG | FILL"
              },
              "characters": {
                "type": "string",
                "description": "Text content (for TEXT nodes)"
              },
              "fontSize": {
                "type": "number",
                "description": "Font size in px"
              },
              "fontWeight": {
                "type": "string",
                "description": "Bold | Medium | Regular"
              },
              "fontFamily": {
                "type": "string",
                "description": "Font family (e.g. \"Inter\", \"Roboto\")"
              },
              "lineHeight": {
                "type": "number",
                "description": "Line height in px"
              },
              "textAlignHorizontal": {
                "type": "string",
                "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
              },
              "textAutoResize": {
                "type": "string",
                "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
              },
              "textTruncation": {
                "type": "string",
                "description": "DISABLED | ENDING (ellipsis \"...\")"
              },
              "maxLines": {
                "type": "number",
                "description": "Max visible lines (requires textTruncation=ENDING)"
              },
              "opacity": {
                "type": "number",
                "description": "Opacity 0-1"
              },
              "strokeWeight": {
                "type": "number",
                "description": "Stroke width in px"
              },
              "strokes": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color string"
                },
                "description": "Stroke colors"
              },
              "effects": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "Effect object (drop shadow, blur)"
                },
                "description": "Shadow/blur effects"
              }
            }
          }
        }
      }
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign"
    }
  },
  "required": [
    "nodes"
  ]
}
```

---

## `patchNode`
**Description**: [STATE-DRIVEN] Update a single node's PROPERTIES (state).
  
  Does NOT handle structure changes (add/remove children).
  Simply merges the provided props into the target node.

**Modes**: `EXECUTION`, `VERIFICATION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "ID of the node to update"
    },
    "props": {
      "type": "object",
      "description": "Properties to merge (fills, cornerRadius, layoutMode, etc.)",
      "properties": {
        "name": {
          "type": "string",
          "description": "Layer name"
        },
        "layoutMode": {
          "type": "string",
          "description": "HORIZONTAL | VERTICAL | NONE"
        },
        "gap": {
          "type": "number",
          "description": "Spacing between children"
        },
        "padding": {
          "type": "number",
          "description": "Uniform padding"
        },
        "fills": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Hex color string"
          },
          "description": "Background colors (e.g. [\"#FFFFFF\"])"
        },
        "cornerRadius": {
          "type": "number",
          "description": "Border radius in px"
        },
        "width": {
          "type": "number",
          "description": "Width in px"
        },
        "height": {
          "type": "number",
          "description": "Height in px"
        },
        "layoutSizingHorizontal": {
          "type": "string",
          "description": "FIXED | HUG | FILL"
        },
        "layoutSizingVertical": {
          "type": "string",
          "description": "FIXED | HUG | FILL"
        },
        "characters": {
          "type": "string",
          "description": "Text content (for TEXT nodes)"
        },
        "fontSize": {
          "type": "number",
          "description": "Font size in px"
        },
        "fontWeight": {
          "type": "string",
          "description": "Bold | Medium | Regular"
        },
        "fontFamily": {
          "type": "string",
          "description": "Font family (e.g. \"Inter\", \"Roboto\")"
        },
        "lineHeight": {
          "type": "number",
          "description": "Line height in px"
        },
        "textAlignHorizontal": {
          "type": "string",
          "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
        },
        "textAutoResize": {
          "type": "string",
          "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
        },
        "textTruncation": {
          "type": "string",
          "description": "DISABLED | ENDING (ellipsis \"...\")"
        },
        "maxLines": {
          "type": "number",
          "description": "Max visible lines (requires textTruncation=ENDING)"
        },
        "opacity": {
          "type": "number",
          "description": "Opacity 0-1"
        },
        "strokeWeight": {
          "type": "number",
          "description": "Stroke width in px"
        },
        "strokes": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Hex color string"
          },
          "description": "Stroke colors"
        },
        "effects": {
          "type": "array",
          "items": {
            "type": "object",
            "description": "Effect object (drop shadow, blur)"
          },
          "description": "Shadow/blur effects"
        }
      }
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign"
    }
  },
  "required": [
    "nodeId",
    "props"
  ]
}
```

---

## `batchOperations`
**Description**: 
[SUPER TOOL] Execute multiple Figma operations in a single ordered call.
Use opId-based references (nodeRef/parentRef) to chain operations without guessing IDs.
If referencing existing nodes, pass nodeId/parentId directly (do NOT use nodeRef/parentRef).
CROSS-TURN CONTINUITY: Response includes idMap mapping opId -> real nodeId. In subsequent turns, use REAL nodeIds from that map, NOT virtual opIds.
Operations always execute sequentially.

EXAMPLE (Hierarchical Row):
{
  "operations": [
    {
      "opId": "row-container",
      "action": "createNode",
      "params": {
        "type": "FRAME",
        "name": "Data Row",
        "props": { "layoutMode": "HORIZONTAL", "gap": 12, "padding": 16 },
        "children": [
          { "opId": "col-1", "action": "createNode", "params": { "type": "TEXT", "name": "Label", "props": { "characters": "Metric Name" } } },
          { "opId": "col-2", "action": "createNode", "params": { "type": "TEXT", "name": "Value", "props": { "characters": "1,234" } } }
        ]
      }
    }
  ]
}


**Modes**: `EXECUTION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "operations": {
      "type": "array",
      "description": "Ordered list of operations to execute",
      "items": {
        "type": "object",
        "description": "Single operation definition",
        "required": [
          "opId",
          "action",
          "params"
        ],
        "properties": {
          "opId": {
            "type": "string",
            "description": "Unique operation ID (Virtual ID) for intra-batch references. Use this as a handle for nodes created in this batch."
          },
          "action": {
            "type": "string",
            "description": "Operation type to execute",
            "enum": [
              "createNode",
              "setNodeLayout",
              "setNodeStyles",
              "updateNodeProperties",
              "createIcon",
              "deleteNode",
              "applyDesignPatch",
              "patchNode"
            ]
          },
          "params": {
            "type": "object",
            "description": "Parameters for the action. Use nodeRef/parentRef for opId references.",
            "properties": {
              "type": {
                "type": "string",
                "description": "Node type (e.g. FRAME, TEXT)"
              },
              "parentId": {
                "type": "string",
                "description": "Real Figma parent ID"
              },
              "parentRef": {
                "type": "string",
                "description": "Virtual ID (opId) of the parent created in this batch"
              },
              "nodeId": {
                "type": "string",
                "description": "Real Figma node ID"
              },
              "nodeRef": {
                "type": "string",
                "description": "Virtual ID (opId) of the node to modify"
              },
              "children": {
                "type": "array",
                "description": "Recursive child operations (createNode only).",
                "items": {
                  "type": "object",
                  "description": "Child createNode operation",
                  "properties": {
                    "opId": {
                      "type": "string",
                      "description": "Unique ID"
                    },
                    "action": {
                      "type": "string",
                      "description": "Must be createNode"
                    },
                    "params": {
                      "type": "object",
                      "description": "Parameters for child creation",
                      "properties": {
                        "type": {
                          "type": "string",
                          "description": "Node type (FRAME | TEXT | ICON | etc.)"
                        },
                        "props": {
                          "type": "object",
                          "description": "Visual properties",
                          "properties": {
                            "name": {
                              "type": "string",
                              "description": "Layer name"
                            },
                            "layoutMode": {
                              "type": "string",
                              "description": "HORIZONTAL | VERTICAL | NONE"
                            },
                            "gap": {
                              "type": "number",
                              "description": "Spacing between children"
                            },
                            "padding": {
                              "type": "number",
                              "description": "Uniform padding"
                            },
                            "fills": {
                              "type": "array",
                              "items": {
                                "type": "string",
                                "description": "Hex color string"
                              },
                              "description": "Background colors (e.g. [\"#FFFFFF\"])"
                            },
                            "cornerRadius": {
                              "type": "number",
                              "description": "Border radius in px"
                            },
                            "width": {
                              "type": "number",
                              "description": "Width in px"
                            },
                            "height": {
                              "type": "number",
                              "description": "Height in px"
                            },
                            "layoutSizingHorizontal": {
                              "type": "string",
                              "description": "FIXED | HUG | FILL"
                            },
                            "layoutSizingVertical": {
                              "type": "string",
                              "description": "FIXED | HUG | FILL"
                            },
                            "characters": {
                              "type": "string",
                              "description": "Text content (for TEXT nodes)"
                            },
                            "fontSize": {
                              "type": "number",
                              "description": "Font size in px"
                            },
                            "fontWeight": {
                              "type": "string",
                              "description": "Bold | Medium | Regular"
                            },
                            "fontFamily": {
                              "type": "string",
                              "description": "Font family (e.g. \"Inter\", \"Roboto\")"
                            },
                            "lineHeight": {
                              "type": "number",
                              "description": "Line height in px"
                            },
                            "textAlignHorizontal": {
                              "type": "string",
                              "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
                            },
                            "textAutoResize": {
                              "type": "string",
                              "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
                            },
                            "textTruncation": {
                              "type": "string",
                              "description": "DISABLED | ENDING (ellipsis \"...\")"
                            },
                            "maxLines": {
                              "type": "number",
                              "description": "Max visible lines (requires textTruncation=ENDING)"
                            },
                            "opacity": {
                              "type": "number",
                              "description": "Opacity 0-1"
                            },
                            "strokeWeight": {
                              "type": "number",
                              "description": "Stroke width in px"
                            },
                            "strokes": {
                              "type": "array",
                              "items": {
                                "type": "string",
                                "description": "Hex color string"
                              },
                              "description": "Stroke colors"
                            },
                            "effects": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "description": "Effect object (drop shadow, blur)"
                              },
                              "description": "Shadow/blur effects"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              "props": {
                "type": "object",
                "description": "For patchNode: Properties to update.",
                "properties": {
                  "name": {
                    "type": "string",
                    "description": "Layer name"
                  },
                  "layoutMode": {
                    "type": "string",
                    "description": "HORIZONTAL | VERTICAL | NONE"
                  },
                  "gap": {
                    "type": "number",
                    "description": "Spacing between children"
                  },
                  "padding": {
                    "type": "number",
                    "description": "Uniform padding"
                  },
                  "fills": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Hex color string"
                    },
                    "description": "Background colors (e.g. [\"#FFFFFF\"])"
                  },
                  "cornerRadius": {
                    "type": "number",
                    "description": "Border radius in px"
                  },
                  "width": {
                    "type": "number",
                    "description": "Width in px"
                  },
                  "height": {
                    "type": "number",
                    "description": "Height in px"
                  },
                  "layoutSizingHorizontal": {
                    "type": "string",
                    "description": "FIXED | HUG | FILL"
                  },
                  "layoutSizingVertical": {
                    "type": "string",
                    "description": "FIXED | HUG | FILL"
                  },
                  "characters": {
                    "type": "string",
                    "description": "Text content (for TEXT nodes)"
                  },
                  "fontSize": {
                    "type": "number",
                    "description": "Font size in px"
                  },
                  "fontWeight": {
                    "type": "string",
                    "description": "Bold | Medium | Regular"
                  },
                  "fontFamily": {
                    "type": "string",
                    "description": "Font family (e.g. \"Inter\", \"Roboto\")"
                  },
                  "lineHeight": {
                    "type": "number",
                    "description": "Line height in px"
                  },
                  "textAlignHorizontal": {
                    "type": "string",
                    "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
                  },
                  "textAutoResize": {
                    "type": "string",
                    "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
                  },
                  "textTruncation": {
                    "type": "string",
                    "description": "DISABLED | ENDING (ellipsis \"...\")"
                  },
                  "maxLines": {
                    "type": "number",
                    "description": "Max visible lines (requires textTruncation=ENDING)"
                  },
                  "opacity": {
                    "type": "number",
                    "description": "Opacity 0-1"
                  },
                  "strokeWeight": {
                    "type": "number",
                    "description": "Stroke width in px"
                  },
                  "strokes": {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "description": "Hex color string"
                    },
                    "description": "Stroke colors"
                  },
                  "effects": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "description": "Effect object (drop shadow, blur)"
                    },
                    "description": "Shadow/blur effects"
                  }
                }
              },
              "stepId": {
                "type": "string",
                "description": "Optional step ID pass-through"
              },
              "patches": {
                "type": "array",
                "description": "For applyDesignPatch: Array of patch definitions. MUST be used for applyDesignPatch.",
                "items": {
                  "type": "object",
                  "description": "A single patch operation",
                  "properties": {
                    "nodeId": {
                      "type": "string",
                      "description": "Real Figma node ID"
                    },
                    "nodeRef": {
                      "type": "string",
                      "description": "Virtual ID (opId) of the node to modify"
                    },
                    "layout": {
                      "type": "object",
                      "description": "Layout properties",
                      "properties": {
                        "layoutMode": {
                          "type": "string",
                          "description": "Auto layout mode (HORIZONTAL, VERTICAL, NONE)"
                        },
                        "layoutAlign": {
                          "type": "string",
                          "description": "Align self (MIN, MAX, CENTER, STRETCH)"
                        },
                        "primaryAxisAlignItems": {
                          "type": "string",
                          "description": "Primary axis alignment"
                        },
                        "counterAxisAlignItems": {
                          "type": "string",
                          "description": "Counter axis alignment"
                        },
                        "itemSpacing": {
                          "type": "number",
                          "description": "Spacing between children"
                        },
                        "paddingLeft": {
                          "type": "number",
                          "description": "Left padding"
                        },
                        "paddingRight": {
                          "type": "number",
                          "description": "Right padding"
                        },
                        "paddingTop": {
                          "type": "number",
                          "description": "Top padding"
                        },
                        "paddingBottom": {
                          "type": "number",
                          "description": "Bottom padding"
                        },
                        "sizing": {
                          "type": "object",
                          "description": "Sizing constraints",
                          "properties": {
                            "horizontal": {
                              "type": "string",
                              "description": "Horizontal sizing (HUG, FILL, FIXED)"
                            },
                            "vertical": {
                              "type": "string",
                              "description": "Vertical sizing (HUG, FILL, FIXED)"
                            }
                          }
                        }
                      }
                    },
                    "styles": {
                      "type": "object",
                      "description": "Style properties",
                      "properties": {
                        "fills": {
                          "type": "array",
                          "description": "Fill properties",
                          "items": {
                            "type": "object",
                            "description": "Paint object"
                          }
                        },
                        "strokes": {
                          "type": "array",
                          "description": "Stroke properties",
                          "items": {
                            "type": "object",
                            "description": "Paint object"
                          }
                        },
                        "strokeWeight": {
                          "type": "number",
                          "description": "Stroke weight in pixels"
                        },
                        "cornerRadius": {
                          "type": "number",
                          "description": "Corner radius in pixels"
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Layer opacity (0 to 1)"
                        }
                      }
                    },
                    "props": {
                      "type": "object",
                      "description": "General node properties (characters, iconName, etc.)",
                      "properties": {
                        "name": {
                          "type": "string",
                          "description": "Layer name"
                        },
                        "layoutMode": {
                          "type": "string",
                          "description": "HORIZONTAL | VERTICAL | NONE"
                        },
                        "gap": {
                          "type": "number",
                          "description": "Spacing between children"
                        },
                        "padding": {
                          "type": "number",
                          "description": "Uniform padding"
                        },
                        "fills": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "Hex color string"
                          },
                          "description": "Background colors (e.g. [\"#FFFFFF\"])"
                        },
                        "cornerRadius": {
                          "type": "number",
                          "description": "Border radius in px"
                        },
                        "width": {
                          "type": "number",
                          "description": "Width in px"
                        },
                        "height": {
                          "type": "number",
                          "description": "Height in px"
                        },
                        "layoutSizingHorizontal": {
                          "type": "string",
                          "description": "FIXED | HUG | FILL"
                        },
                        "layoutSizingVertical": {
                          "type": "string",
                          "description": "FIXED | HUG | FILL"
                        },
                        "characters": {
                          "type": "string",
                          "description": "Text content (for TEXT nodes)"
                        },
                        "fontSize": {
                          "type": "number",
                          "description": "Font size in px"
                        },
                        "fontWeight": {
                          "type": "string",
                          "description": "Bold | Medium | Regular"
                        },
                        "fontFamily": {
                          "type": "string",
                          "description": "Font family (e.g. \"Inter\", \"Roboto\")"
                        },
                        "lineHeight": {
                          "type": "number",
                          "description": "Line height in px"
                        },
                        "textAlignHorizontal": {
                          "type": "string",
                          "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
                        },
                        "textAutoResize": {
                          "type": "string",
                          "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
                        },
                        "textTruncation": {
                          "type": "string",
                          "description": "DISABLED | ENDING (ellipsis \"...\")"
                        },
                        "maxLines": {
                          "type": "number",
                          "description": "Max visible lines (requires textTruncation=ENDING)"
                        },
                        "opacity": {
                          "type": "number",
                          "description": "Opacity 0-1"
                        },
                        "strokeWeight": {
                          "type": "number",
                          "description": "Stroke width in px"
                        },
                        "strokes": {
                          "type": "array",
                          "items": {
                            "type": "string",
                            "description": "Hex color string"
                          },
                          "description": "Stroke colors"
                        },
                        "effects": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "description": "Effect object (drop shadow, blur)"
                          },
                          "description": "Shadow/blur effects"
                        }
                      }
                    }
                  }
                }
              },
              "name": {
                "type": "string",
                "description": "Layer name"
              },
              "layoutMode": {
                "type": "string",
                "description": "HORIZONTAL | VERTICAL | NONE"
              },
              "gap": {
                "type": "number",
                "description": "Spacing between children"
              },
              "padding": {
                "type": "number",
                "description": "Uniform padding"
              },
              "fills": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color string"
                },
                "description": "Background colors (e.g. [\"#FFFFFF\"])"
              },
              "cornerRadius": {
                "type": "number",
                "description": "Border radius in px"
              },
              "width": {
                "type": "number",
                "description": "Width in px"
              },
              "height": {
                "type": "number",
                "description": "Height in px"
              },
              "layoutSizingHorizontal": {
                "type": "string",
                "description": "FIXED | HUG | FILL"
              },
              "layoutSizingVertical": {
                "type": "string",
                "description": "FIXED | HUG | FILL"
              },
              "characters": {
                "type": "string",
                "description": "Text content (for TEXT nodes)"
              },
              "fontSize": {
                "type": "number",
                "description": "Font size in px"
              },
              "fontWeight": {
                "type": "string",
                "description": "Bold | Medium | Regular"
              },
              "fontFamily": {
                "type": "string",
                "description": "Font family (e.g. \"Inter\", \"Roboto\")"
              },
              "lineHeight": {
                "type": "number",
                "description": "Line height in px"
              },
              "textAlignHorizontal": {
                "type": "string",
                "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
              },
              "textAutoResize": {
                "type": "string",
                "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
              },
              "textTruncation": {
                "type": "string",
                "description": "DISABLED | ENDING (ellipsis \"...\")"
              },
              "maxLines": {
                "type": "number",
                "description": "Max visible lines (requires textTruncation=ENDING)"
              },
              "opacity": {
                "type": "number",
                "description": "Opacity 0-1"
              },
              "strokeWeight": {
                "type": "number",
                "description": "Stroke width in px"
              },
              "strokes": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color string"
                },
                "description": "Stroke colors"
              },
              "effects": {
                "type": "array",
                "items": {
                  "type": "object",
                  "description": "Effect object (drop shadow, blur)"
                },
                "description": "Shadow/blur effects"
              },
              "iconName": {
                "type": "string",
                "description": "For ICON nodes"
              },
              "size": {
                "type": "number",
                "description": "For ICON nodes"
              },
              "color": {
                "type": "string",
                "description": "For ICON/TEXT nodes"
              }
            }
          },
          "reason": {
            "type": "string",
            "description": "Why this operation is being performed. Helps maintain context and avoid redundant loops."
          },
          "preconditions": {
            "type": "object",
            "description": "Optional validation rules to check before execution.",
            "properties": {
              "nodeType": {
                "type": "string",
                "description": "Expected node type (e.g. FRAME, TEXT)"
              },
              "parentHasAutoLayout": {
                "type": "boolean",
                "description": "Requires parent to have auto-layout"
              }
            }
          },
          "dependsOn": {
            "type": "array",
            "description": "Optional list of opIds that must succeed before this operation",
            "items": {
              "type": "string",
              "description": "opId dependency"
            }
          }
        }
      }
    },
    "strategy": {
      "type": "string",
      "description": "Execution strategy (sequential only)",
      "enum": [
        "sequential"
      ]
    },
    "onError": {
      "type": "string",
      "description": "Error handling strategy for dependent operations",
      "enum": [
        "skip-dependents",
        "continue"
      ]
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    }
  },
  "required": [
    "operations"
  ]
}
```

---

## `applyDesignPatch`
**Description**: 
[SUPER TOOL] Apply multiple changes to multiple nodes in a single atomic operation.
Extremely efficient for refining a whole component (e.g., changing colors and spacing at once).


**Modes**: `EXECUTION`, `VERIFICATION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "patches": {
      "type": "array",
      "description": "List of changes to apply",
      "items": {
        "type": "object",
        "description": "A single patch targeting a node",
        "properties": {
          "nodeId": {
            "type": "string",
            "description": "Target node ID"
          },
          "layout": {
            "type": "object",
            "description": "Optional layout changes (same as setNodeLayout)",
            "properties": {
              "layoutMode": {
                "type": "string",
                "enum": [
                  "NONE",
                  "HORIZONTAL",
                  "VERTICAL"
                ],
                "description": "Layout mode"
              },
              "gap": {
                "type": "number",
                "description": "Gap value"
              },
              "padding": {
                "type": "object",
                "description": "Padding object",
                "properties": {
                  "top": {
                    "type": "number",
                    "description": "Top padding"
                  },
                  "right": {
                    "type": "number",
                    "description": "Right padding"
                  },
                  "bottom": {
                    "type": "number",
                    "description": "Bottom padding"
                  },
                  "left": {
                    "type": "number",
                    "description": "Left padding"
                  }
                }
              },
              "sizing": {
                "type": "object",
                "description": "Sizing object",
                "properties": {
                  "horizontal": {
                    "type": "string",
                    "description": "Horizontal sizing"
                  },
                  "vertical": {
                    "type": "string",
                    "description": "Vertical sizing"
                  }
                }
              },
              "layoutPositioning": {
                "type": "string",
                "enum": [
                  "AUTO",
                  "ABSOLUTE"
                ],
                "description": "ABSOLUTE ignores parent auto layout flow"
              },
              "constraints": {
                "type": "object",
                "description": "Parent pin/scale behavior",
                "properties": {
                  "horizontal": {
                    "type": "string",
                    "description": "MIN | CENTER | MAX | STRETCH | SCALE | LEFT | RIGHT | LEFT_RIGHT"
                  },
                  "vertical": {
                    "type": "string",
                    "description": "MIN | CENTER | MAX | STRETCH | SCALE | TOP | BOTTOM | TOP_BOTTOM"
                  }
                }
              },
              "x": {
                "type": "number",
                "description": "Explicit x position"
              },
              "y": {
                "type": "number",
                "description": "Explicit y position"
              },
              "layoutGrow": {
                "type": "number",
                "description": "Auto-layout grow factor"
              },
              "layoutAlign": {
                "type": "string",
                "description": "MIN | CENTER | MAX | STRETCH | INHERIT"
              }
            }
          },
          "styles": {
            "type": "object",
            "description": "Optional style changes (same as setNodeStyles)",
            "properties": {
              "fills": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color string"
                },
                "description": "Fill colors"
              },
              "cornerRadius": {
                "type": "number",
                "description": "Corner radius"
              },
              "opacity": {
                "type": "number",
                "description": "Opacity"
              }
            }
          },
          "textAndFont": {
            "type": "object",
            "description": "[DEPRECATED] Use props instead. Previously named \"properties\".",
            "properties": {
              "characters": {
                "type": "string",
                "description": "Text content"
              },
              "fontSize": {
                "type": "number",
                "description": "Font size"
              }
            }
          },
          "props": {
            "type": "object",
            "description": "[PREFERRED] Unified design properties",
            "properties": {
              "fills": {
                "type": "array",
                "items": {
                  "type": "string",
                  "description": "Hex color or gradient object"
                },
                "description": "Hex strings for solid colors, or gradient objects for gradients"
              },
              "cornerRadius": {
                "type": "number",
                "description": "Corner radius"
              },
              "padding": {
                "type": "number",
                "description": "Padding"
              },
              "gap": {
                "type": "number",
                "description": "Gap"
              },
              "layoutMode": {
                "type": "string",
                "enum": [
                  "HORIZONTAL",
                  "VERTICAL",
                  "NONE"
                ],
                "description": "Layout mode"
              },
              "layoutPositioning": {
                "type": "string",
                "enum": [
                  "AUTO",
                  "ABSOLUTE"
                ],
                "description": "ABSOLUTE ignores parent auto layout flow"
              },
              "constraints": {
                "type": "object",
                "description": "Parent pin/scale behavior",
                "properties": {
                  "horizontal": {
                    "type": "string",
                    "description": "MIN | CENTER | MAX | STRETCH | SCALE | LEFT | RIGHT | LEFT_RIGHT"
                  },
                  "vertical": {
                    "type": "string",
                    "description": "MIN | CENTER | MAX | STRETCH | SCALE | TOP | BOTTOM | TOP_BOTTOM"
                  }
                }
              },
              "x": {
                "type": "number",
                "description": "Explicit x position"
              },
              "y": {
                "type": "number",
                "description": "Explicit y position"
              },
              "width": {
                "type": "number",
                "description": "Width"
              },
              "height": {
                "type": "number",
                "description": "Height"
              },
              "characters": {
                "type": "string",
                "description": "Text content (TEXT nodes only)"
              },
              "fontSize": {
                "type": "number",
                "description": "Font size in px"
              },
              "fontWeight": {
                "type": "string",
                "description": "e.g. \"Bold\", \"Medium\", \"Regular\""
              },
              "fontFamily": {
                "type": "string",
                "description": "Font family name. Supports any Google Font (e.g. \"Roboto\", \"Poppins\", \"Noto Sans SC\"). Defaults to \"Inter\"."
              },
              "lineHeight": {
                "type": "number",
                "description": "Line height in px (or {value, unit:\"PERCENT\"} for %)"
              },
              "letterSpacing": {
                "type": "number",
                "description": "Letter spacing in px"
              },
              "textAlignHorizontal": {
                "type": "string",
                "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
              },
              "textAlignVertical": {
                "type": "string",
                "description": "TOP | CENTER | BOTTOM"
              },
              "textCase": {
                "type": "string",
                "description": "ORIGINAL | UPPER | LOWER | TITLE | SMALL_CAPS | SMALL_CAPS_FORCED"
              },
              "textDecoration": {
                "type": "string",
                "description": "NONE | UNDERLINE | STRIKETHROUGH"
              },
              "textAutoResize": {
                "type": "string",
                "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
              },
              "textTruncation": {
                "type": "string",
                "description": "DISABLED | ENDING. Use ENDING for ellipsis (\"...\") truncation."
              },
              "maxLines": {
                "type": "number",
                "description": "Max visible lines before truncation. Requires textTruncation=ENDING and textAutoResize=TRUNCATE."
              },
              "paragraphSpacing": {
                "type": "number",
                "description": "Space between paragraphs in px"
              },
              "paragraphIndent": {
                "type": "number",
                "description": "First-line indent in px"
              }
            }
          }
        },
        "required": [
          "nodeId"
        ]
      }
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    },
    "reason": {
      "type": "string",
      "description": "Why this design patch is being applied."
    }
  },
  "required": [
    "patches"
  ]
}
```

---

## `planDesign`
**Description**: 
[PLANNING] Create a CONCISE execution plan (MAX 8 steps). Each step should group related operations.
Do NOT create one step per node — group sibling nodes, container+children, or related style changes into single steps.

EXAMPLE: For "Create a login form with email, password, and sign-in button":
- Step 1: Create root container "Login Form" with header (title + subtitle)
- Step 2: Create form fields (email input + password input)
- Step 3: Create sign-in button and social login buttons
- Step 4: Apply final layout and styles

ANTI-PATTERN (TOO GRANULAR - DO NOT DO THIS):
- Step 1: Create container → Step 2: Create title → Step 3: Create subtitle → ... (20 steps)


**Modes**: `PLANNING`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "analysis": {
      "type": "string",
      "description": "Analysis of the user request and design requirements"
    },
    "steps": {
      "type": "array",
      "description": "Ordered list of HIGH-LEVEL design milestones (NOT individual tool calls). Each step groups multiple related operations.",
      "items": {
        "type": "object",
        "description": "A component-level milestone that requires MULTIPLE tool calls to complete",
        "properties": {
          "stepNumber": {
            "type": "number",
            "description": "Step order (1, 2, 3...)"
          },
          "action": {
            "type": "string",
            "description": "High-level description of what to build (e.g., \"Build header section with logo, title, and navigation links\"). NOT a tool name."
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Name of a node/element to create"
            },
            "description": "List of nodes/elements this step will create (e.g., [\"Header Frame\", \"Logo\", \"Title Text\", \"Nav Links\"])"
          },
          "reasoning": {
            "type": "string",
            "description": "Why this step is needed"
          }
        }
      }
    }
  },
  "required": [
    "analysis",
    "steps"
  ]
}
```

---

## `searchDesignKnowledge`
**Description**: Search for UI/UX design knowledge, aesthetic directions, visual inspiration, style priorities, color palettes, or industry-specific patterns.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string",
      "description": "The specific knowledge domain to search within.",
      "enum": [
        "reasoning",
        "styles",
        "colors",
        "typography",
        "landing",
        "charts",
        "products",
        "guidelines",
        "stacks",
        "figmaLayout"
      ]
    },
    "query": {
      "type": "string",
      "description": "The search query or keyword."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of results to return (default 3)."
    }
  },
  "required": [
    "domain",
    "query"
  ]
}
```

---

## `getComponentAnatomy`
**Description**: Retrieve a REFERENCE structural blueprint for a specific UI component. Use ONLY when user explicitly requests project/system patterns. For custom or relative adjustments, rely on your own design reasoning.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "componentName": {
      "type": "string",
      "description": "The semantic name of the component (e.g., \"button\", \"card\", \"badge\")."
    }
  },
  "required": [
    "componentName"
  ]
}
```

---

## `getFigmaLayoutRules`
**Description**: Retrieve specific Figma layout constraints and rules (Do/Don't) to ensure design system compliance.

**Modes**: `PLANNING`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "topic": {
      "type": "string",
      "description": "Specific topic to filter rules (e.g., \"auto layout\", \"sizing\")."
    },
    "severityFilter": {
      "type": "string",
      "description": "Filter rules by severity level.",
      "enum": [
        "Critical",
        "High",
        "Medium",
        "Low"
      ]
    }
  }
}
```

---

## `createNode`
**Description**: 
[ATOMIC] Create FRAME, TEXT, RECTANGLE, ELLIPSE, or LINE.

⚠️ HIERARCHY RULE:
- For complex structures, use 'batchOperations' with the 'children' array to build deep hierarchies in a single call.
- When creating parent-child hierarchy WITHOUT 'batchOperations':
  1. MUST wait for parent's createNode to return nodeId BEFORE creating child.
  2. parentId MUST be the exact nodeId from a COMPLETED previous createNode.

Returns: {nodeId: "124:567"} - Use this ID as parentId for child nodes.


**Modes**: `RECOVERY`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "FRAME",
        "TEXT",
        "RECTANGLE",
        "ELLIPSE",
        "LINE"
      ],
      "description": "Type of node to create. Invalid values will return INVALID_NODE_TYPE."
    },
    "name": {
      "type": "string",
      "description": "Descriptive name for the layer (e.g., \"Main Card\", \"Login Button\"). AVOID generic names like \"unnamed\" or \"layer\".",
      "minimum": 1
    },
    "parentId": {
      "type": "string",
      "description": "[BLOCKING DEPENDENCY] Parent node ID from a COMPLETED createNode call.\n⚠️ MUST wait for parent createNode to return before using this.\nIf omitted, node is added to current page (root level).\nNEVER use a predicted, placeholder, or guessed ID."
    },
    "characters": {
      "type": "string",
      "description": "Initial text content (Only used if type=TEXT). Defaults to \"Text\"."
    },
    "layout": {
      "type": "object",
      "description": "[INLINE OPTIMIZATION] Configure Auto Layout (padding, gap, sizing) during creation to save iterations. Same schema as setNodeLayout.",
      "properties": {
        "layoutMode": {
          "type": "string",
          "enum": [
            "NONE",
            "HORIZONTAL",
            "VERTICAL"
          ],
          "description": "Auto layout direction"
        },
        "sizing": {
          "type": "object",
          "description": "Sizing rules",
          "properties": {
            "horizontal": {
              "type": "string",
              "enum": [
                "FIXED",
                "HUG",
                "FILL"
              ],
              "description": "Horizontal sizing"
            },
            "vertical": {
              "type": "string",
              "enum": [
                "FIXED",
                "HUG",
                "FILL"
              ],
              "description": "Vertical sizing"
            }
          }
        },
        "padding": {
          "type": "object",
          "description": "Padding values",
          "properties": {
            "horizontal": {
              "type": "number",
              "description": "Horizontal padding"
            },
            "vertical": {
              "type": "number",
              "description": "Vertical padding"
            },
            "top": {
              "type": "number",
              "description": "Top padding"
            },
            "right": {
              "type": "number",
              "description": "Right padding"
            },
            "bottom": {
              "type": "number",
              "description": "Bottom padding"
            },
            "left": {
              "type": "number",
              "description": "Left padding"
            }
          }
        },
        "gap": {
          "type": "number",
          "description": "Gap between children"
        },
        "layoutPositioning": {
          "type": "string",
          "enum": [
            "AUTO",
            "ABSOLUTE"
          ],
          "description": "For children in auto-layout parent: ABSOLUTE ignores auto-layout flow."
        },
        "constraints": {
          "type": "object",
          "description": "Pin/scale behavior relative to parent (for non-auto-layout or ABSOLUTE children).",
          "properties": {
            "horizontal": {
              "type": "string",
              "enum": [
                "MIN",
                "CENTER",
                "MAX",
                "STRETCH",
                "SCALE",
                "LEFT",
                "RIGHT",
                "LEFT_RIGHT"
              ],
              "description": "Horizontal constraint"
            },
            "vertical": {
              "type": "string",
              "enum": [
                "MIN",
                "CENTER",
                "MAX",
                "STRETCH",
                "SCALE",
                "TOP",
                "BOTTOM",
                "TOP_BOTTOM"
              ],
              "description": "Vertical constraint"
            }
          }
        },
        "x": {
          "type": "number",
          "description": "Explicit x position. Works on non-auto-layout parent, or ABSOLUTE child in auto-layout parent."
        },
        "y": {
          "type": "number",
          "description": "Explicit y position. Works on non-auto-layout parent, or ABSOLUTE child in auto-layout parent."
        },
        "width": {
          "type": "number",
          "description": "Explicit width",
          "minimum": 0.01
        },
        "height": {
          "type": "number",
          "description": "Explicit height",
          "minimum": 0.01
        }
      }
    },
    "styles": {
      "type": "object",
      "description": "[DEPRECATED] Use props instead.",
      "properties": {
        "fills": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Hex or variable"
          },
          "description": "Background/Text colors"
        },
        "strokes": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Hex or variable"
          },
          "description": "Stroke colors"
        },
        "strokeWeight": {
          "type": "number",
          "description": "Stroke thickness"
        },
        "cornerRadius": {
          "type": "number",
          "description": "Corner radius"
        },
        "opacity": {
          "type": "number",
          "description": "Layer opacity (0-1)"
        }
      }
    },
    "props": {
      "type": "object",
      "description": "[PREFERRED] Unified design properties (fills, cornerRadius, padding, gap, etc.)",
      "properties": {
        "fills": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Hex color"
          },
          "description": "Background colors"
        },
        "cornerRadius": {
          "type": "number",
          "description": "Corner radius (px)"
        },
        "padding": {
          "type": "number",
          "description": "Uniform padding (px)"
        },
        "gap": {
          "type": "number",
          "description": "Gap between children (px)"
        },
        "layoutMode": {
          "type": "string",
          "enum": [
            "HORIZONTAL",
            "VERTICAL",
            "NONE"
          ],
          "description": "Auto Layout mode"
        },
        "primaryAxisAlignItems": {
          "type": "string",
          "enum": [
            "MIN",
            "CENTER",
            "MAX",
            "SPACE_BETWEEN"
          ],
          "description": "Primary axis alignment"
        },
        "counterAxisAlignItems": {
          "type": "string",
          "enum": [
            "MIN",
            "CENTER",
            "MAX"
          ],
          "description": "Counter axis alignment"
        },
        "layoutSizingHorizontal": {
          "type": "string",
          "enum": [
            "FIXED",
            "HUG",
            "FILL"
          ],
          "description": "Horizontal sizing"
        },
        "layoutSizingVertical": {
          "type": "string",
          "enum": [
            "FIXED",
            "HUG",
            "FILL"
          ],
          "description": "Vertical sizing"
        },
        "layoutPositioning": {
          "type": "string",
          "enum": [
            "AUTO",
            "ABSOLUTE"
          ],
          "description": "ABSOLUTE = ignore parent auto layout flow (if parent is auto-layout)"
        },
        "constraints": {
          "type": "object",
          "description": "Pin/scale behavior relative to parent",
          "properties": {
            "horizontal": {
              "type": "string",
              "enum": [
                "MIN",
                "CENTER",
                "MAX",
                "STRETCH",
                "SCALE",
                "LEFT",
                "RIGHT",
                "LEFT_RIGHT"
              ],
              "description": "Horizontal constraint"
            },
            "vertical": {
              "type": "string",
              "enum": [
                "MIN",
                "CENTER",
                "MAX",
                "STRETCH",
                "SCALE",
                "TOP",
                "BOTTOM",
                "TOP_BOTTOM"
              ],
              "description": "Vertical constraint"
            }
          }
        },
        "x": {
          "type": "number",
          "description": "Explicit x position"
        },
        "y": {
          "type": "number",
          "description": "Explicit y position"
        },
        "width": {
          "type": "number",
          "description": "Fixed width",
          "minimum": 0.01
        },
        "height": {
          "type": "number",
          "description": "Fixed height",
          "minimum": 0.01
        },
        "characters": {
          "type": "string",
          "description": "Text content (TEXT nodes only)"
        },
        "fontSize": {
          "type": "number",
          "description": "Font size in px"
        },
        "fontWeight": {
          "type": "string",
          "description": "e.g. \"Bold\", \"Medium\", \"Regular\""
        },
        "fontFamily": {
          "type": "string",
          "description": "Font family name. Supports any Google Font (e.g. \"Roboto\", \"Poppins\", \"Noto Sans SC\"). Defaults to \"Inter\"."
        },
        "lineHeight": {
          "type": "number",
          "description": "Line height in px (or {value, unit:\"PERCENT\"} for %)"
        },
        "letterSpacing": {
          "type": "number",
          "description": "Letter spacing in px"
        },
        "textAlignHorizontal": {
          "type": "string",
          "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
        },
        "textAlignVertical": {
          "type": "string",
          "description": "TOP | CENTER | BOTTOM"
        },
        "textCase": {
          "type": "string",
          "description": "ORIGINAL | UPPER | LOWER | TITLE | SMALL_CAPS | SMALL_CAPS_FORCED"
        },
        "textDecoration": {
          "type": "string",
          "description": "NONE | UNDERLINE | STRIKETHROUGH"
        },
        "textAutoResize": {
          "type": "string",
          "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
        },
        "textTruncation": {
          "type": "string",
          "description": "DISABLED | ENDING. Use ENDING for ellipsis (\"...\") truncation."
        },
        "maxLines": {
          "type": "number",
          "description": "Max visible lines before truncation. Requires textTruncation=ENDING and textAutoResize=TRUNCATE."
        },
        "paragraphSpacing": {
          "type": "number",
          "description": "Space between paragraphs in px"
        },
        "paragraphIndent": {
          "type": "number",
          "description": "First-line indent in px"
        }
      }
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    }
  },
  "required": [
    "type",
    "name"
  ]
}
```

---

## `setNodeLayout`
**Description**: 
Configure Auto Layout for a Frame.
Set Padding, Gap, and Sizing (FIXED/HUG/FILL).
Use nodeId from createNode response.

CRITICAL CONSTRAINTS:
- HUG sizing requires Auto Layout context. Valid when:
  1. The node itself has layoutMode=VERTICAL/HORIZONTAL (becomes an Auto Layout container), OR
  2. The parent node has Auto Layout enabled
- FILL sizing requires the parent to have Auto Layout
- FIXED sizing works in all contexts

BEST PRACTICE: When creating a container that should HUG its content,
set layoutMode to VERTICAL/HORIZONTAL in the SAME setNodeLayout call.


**Modes**: `RECOVERY`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "Target node ID (from createNode response)"
    },
    "layoutMode": {
      "type": "string",
      "enum": [
        "NONE",
        "HORIZONTAL",
        "VERTICAL"
      ],
      "description": "Auto layout direction. Set to VERTICAL/HORIZONTAL to enable Auto Layout. Invalid values return INVALID_LAYOUT_MODE."
    },
    "sizing": {
      "type": "object",
      "properties": {
        "horizontal": {
          "type": "string",
          "enum": [
            "FIXED",
            "HUG",
            "FILL"
          ],
          "description": "Horizontal sizing. HUG requires Auto Layout context (see constraints above)."
        },
        "vertical": {
          "type": "string",
          "enum": [
            "FIXED",
            "HUG",
            "FILL"
          ],
          "description": "Vertical sizing. HUG requires Auto Layout context (see constraints above)."
        }
      },
      "description": "Layout sizing rules"
    },
    "padding": {
      "type": "object",
      "properties": {
        "horizontal": {
          "type": "number",
          "minimum": 0,
          "description": "Horizontal padding (px)"
        },
        "vertical": {
          "type": "number",
          "minimum": 0,
          "description": "Vertical padding (px)"
        },
        "top": {
          "type": "number",
          "minimum": 0,
          "description": "Top padding (px)"
        },
        "right": {
          "type": "number",
          "minimum": 0,
          "description": "Right padding (px)"
        },
        "bottom": {
          "type": "number",
          "minimum": 0,
          "description": "Bottom padding (px)"
        },
        "left": {
          "type": "number",
          "minimum": 0,
          "description": "Left padding (px)"
        }
      },
      "description": "Padding values in pixels"
    },
    "gap": {
      "type": "number",
      "minimum": 0,
      "description": "Gap between children (Auto Layout only)"
    },
    "layoutPositioning": {
      "type": "string",
      "enum": [
        "AUTO",
        "ABSOLUTE"
      ],
      "description": "When parent is Auto Layout: ABSOLUTE lets this child ignore flow and use x/y."
    },
    "constraints": {
      "type": "object",
      "description": "Pin/scale behavior relative to parent.",
      "properties": {
        "horizontal": {
          "type": "string",
          "enum": [
            "MIN",
            "CENTER",
            "MAX",
            "STRETCH",
            "SCALE",
            "LEFT",
            "RIGHT",
            "LEFT_RIGHT"
          ],
          "description": "Horizontal constraint mode"
        },
        "vertical": {
          "type": "string",
          "enum": [
            "MIN",
            "CENTER",
            "MAX",
            "STRETCH",
            "SCALE",
            "TOP",
            "BOTTOM",
            "TOP_BOTTOM"
          ],
          "description": "Vertical constraint mode"
        }
      }
    },
    "x": {
      "type": "number",
      "description": "Explicit x position. Valid for non-auto-layout parent or ABSOLUTE child in auto-layout parent."
    },
    "y": {
      "type": "number",
      "description": "Explicit y position. Valid for non-auto-layout parent or ABSOLUTE child in auto-layout parent."
    },
    "layoutGrow": {
      "type": "number",
      "description": "Auto-layout grow value for flow children (typically 0 or 1)."
    },
    "layoutAlign": {
      "type": "string",
      "enum": [
        "MIN",
        "CENTER",
        "MAX",
        "STRETCH",
        "INHERIT"
      ],
      "description": "Auto-layout cross-axis alignment for flow children."
    },
    "width": {
      "type": "number",
      "minimum": 0.01,
      "description": "Explicit width (only for FIXED sizing)"
    },
    "height": {
      "type": "number",
      "minimum": 0.01,
      "description": "Explicit height (only for FIXED sizing)"
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    }
  },
  "required": [
    "nodeId"
  ]
}
```

---

## `setNodeStyles`
**Description**: 
Update visual styling (Fills, Strokes, Effects).
Use nodeId from createNode response.


**Modes**: `RECOVERY`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "Target node ID (from createNode response)"
    },
    "fills": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^#[0-9A-Fa-f]{6}$",
        "description": "Color hex code (e.g., \"#FF0000\") or variable name"
      },
      "maxItems": 10,
      "description": "Background colors / Text colors"
    },
    "strokes": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^#[0-9A-Fa-f]{6}$",
        "description": "Color hex code"
      },
      "maxItems": 5,
      "description": "Stroke colors"
    },
    "strokeWeight": {
      "type": "number",
      "minimum": 0,
      "maximum": 100,
      "description": "Stroke thickness"
    },
    "cornerRadius": {
      "type": "number",
      "minimum": 0,
      "maximum": 1000,
      "description": "Radius in pixels"
    },
    "opacity": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "Layer opacity (0-1)"
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    }
  },
  "required": [
    "nodeId"
  ]
}
```

---

## `createIcon`
**Description**: Fetch and create an icon from Iconify library.

**Modes**: `EXECUTION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Optional semantic ID"
    },
    "parentId": {
      "type": "string",
      "description": "Parent node ID"
    },
    "iconName": {
      "type": "string",
      "description": "Iconify name (e.g., \"lucide:home\", \"mdi:account\")"
    },
    "size": {
      "type": "number",
      "minimum": 1,
      "maximum": 1000,
      "description": "Size in pixels (default 24)"
    },
    "color": {
      "type": "string",
      "pattern": "^#[0-9A-Fa-f]{6}$",
      "description": "Icon color hex"
    },
    "layout": {
      "type": "object",
      "description": "[INLINE OPTIMIZATION] Configure Auto Layout (padding, gap, sizing) during creation. Same schema as setNodeLayout.",
      "properties": {
        "sizing": {
          "type": "object",
          "description": "Sizing rules",
          "properties": {
            "horizontal": {
              "type": "string",
              "enum": [
                "FIXED",
                "HUG",
                "FILL"
              ],
              "description": "Horizontal sizing"
            },
            "vertical": {
              "type": "string",
              "enum": [
                "FIXED",
                "HUG",
                "FILL"
              ],
              "description": "Vertical sizing"
            }
          }
        }
      }
    },
    "styles": {
      "type": "object",
      "description": "[DEPRECATED] Use props instead.",
      "properties": {
        "opacity": {
          "type": "number",
          "description": "Layer opacity (0-1)"
        }
      }
    },
    "props": {
      "type": "object",
      "description": "[PREFERRED] Unified design properties (fills, opacity, width, height, etc.)",
      "properties": {
        "fills": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Hex color"
          },
          "description": "Icon colors"
        },
        "opacity": {
          "type": "number",
          "description": "Layer opacity (0-1)"
        },
        "width": {
          "type": "number",
          "description": "Icon width"
        },
        "height": {
          "type": "number",
          "description": "Icon height"
        }
      }
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    }
  },
  "required": [
    "iconName"
  ]
}
```

---

## `updateNodeProperties`
**Description**: 
Update TEXT (fontSize, fontFamily, fontWeight, align) or general properties (visible, name).
Use nodeId from createNode response.


**Modes**: `RECOVERY`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "Target node ID (from createNode response)"
    },
    "properties": {
      "type": "object",
      "description": "Key-value pairs to update.",
      "properties": {
        "characters": {
          "type": "string",
          "description": "Text content (TEXT nodes only)"
        },
        "fontSize": {
          "type": "number",
          "description": "Font size in px"
        },
        "fontWeight": {
          "type": "string",
          "description": "e.g. \"Bold\", \"Medium\", \"Regular\""
        },
        "fontFamily": {
          "type": "string",
          "description": "Font family name. Supports any Google Font (e.g. \"Roboto\", \"Poppins\", \"Noto Sans SC\"). Defaults to \"Inter\"."
        },
        "lineHeight": {
          "type": "number",
          "description": "Line height in px (or {value, unit:\"PERCENT\"} for %)"
        },
        "letterSpacing": {
          "type": "number",
          "description": "Letter spacing in px"
        },
        "textAlignHorizontal": {
          "type": "string",
          "description": "LEFT | CENTER | RIGHT | JUSTIFIED"
        },
        "textAlignVertical": {
          "type": "string",
          "description": "TOP | CENTER | BOTTOM"
        },
        "textCase": {
          "type": "string",
          "description": "ORIGINAL | UPPER | LOWER | TITLE | SMALL_CAPS | SMALL_CAPS_FORCED"
        },
        "textDecoration": {
          "type": "string",
          "description": "NONE | UNDERLINE | STRIKETHROUGH"
        },
        "textAutoResize": {
          "type": "string",
          "description": "NONE | WIDTH_AND_HEIGHT | HEIGHT | TRUNCATE"
        },
        "textTruncation": {
          "type": "string",
          "description": "DISABLED | ENDING. Use ENDING for ellipsis (\"...\") truncation."
        },
        "maxLines": {
          "type": "number",
          "description": "Max visible lines before truncation. Requires textTruncation=ENDING and textAutoResize=TRUNCATE."
        },
        "paragraphSpacing": {
          "type": "number",
          "description": "Space between paragraphs in px"
        },
        "paragraphIndent": {
          "type": "number",
          "description": "First-line indent in px"
        }
      }
    },
    "stepId": {
      "type": "string",
      "description": "Optional step ID from planDesign to mark as completed upon success"
    }
  },
  "required": [
    "nodeId",
    "properties"
  ]
}
```

---

## `deleteNode`
**Description**: Remove a node from the document.

**Modes**: `EXECUTION`

**Execution Strategy**: `sequential`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "nodeId": {
      "type": "string",
      "description": "ID of node to delete"
    }
  },
  "required": [
    "nodeId"
  ]
}
```

---

## `validateLayout`
**Description**: Apply formal Figma layout constraints (Auto Layout rules, sizing mutual exclusion) to a node tree and return detailed lint feedback.

**Modes**: `VERIFICATION`, `RECOVERY`

**Execution Strategy**: `parallel`

**Parameters Schema**:
```json
{
  "type": "object",
  "properties": {
    "node": {
      "type": "object",
      "description": "The NodeLayer tree (DSL) to validate."
    },
    "checkTypes": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "sizing",
          "dependency",
          "autoLayout",
          "semantic"
        ],
        "description": "Type of check to perform"
      },
      "description": "Specific validation checks to run."
    }
  },
  "required": [
    "node"
  ]
}
```

---

