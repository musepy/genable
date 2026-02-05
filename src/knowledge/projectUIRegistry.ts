/**
 * @file projectUIRegistry.ts
 * @description Registry of project UI components for LLM context injection.
 *
 * This registry provides metadata about the project's UI components,
 * allowing the LLM to understand and reference existing code patterns
 * when generating Figma designs.
 *
 * Usage: LLM calls getProjectUIContext tool -> returns component metadata
 */

export interface UIComponentMeta {
  name: string;
  path: string;
  description: string;
  category: 'layout' | 'input' | 'display' | 'feedback' | 'navigation';
  props: PropDefinition[];
  variants?: Record<string, VariantDefinition>;
  figmaMapping?: FigmaMapping;
  codeSnippet?: string;
}

export interface PropDefinition {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  default?: any;
  options?: string[];
}

export interface VariantDefinition {
  description: string;
  props: Record<string, any>;
}

export interface FigmaMapping {
  nodeType: string;
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  defaultProps?: Record<string, any>;
}

/**
 * Project UI Component Registry
 *
 * NOTE: This is a static registry. When you update UI components,
 * run `npm run sync:ui-registry` to regenerate (future enhancement).
 */
export const PROJECT_UI_REGISTRY: Record<string, UIComponentMeta> = {
  'Button': {
    "name": "Button",
    "path": "src/ui/components/Button.tsx",
    "description": "Interactive button component with multiple variants and states",
    "category": "input",
    "props": [
      {
        "name": "variant",
        "type": "string",
        "description": "Visual style of the button",
        "options": [
          "primary",
          "secondary",
          "ghost",
          "outline",
          "destructive"
        ],
        "default": "primary"
      },
      {
        "name": "size",
        "type": "string",
        "description": "Vertical size of the button",
        "options": [
          "sm",
          "md",
          "lg"
        ],
        "default": "md"
      },
      {
        "name": "children",
        "type": "ReactNode",
        "description": "Button text or content",
        "required": true
      },
      {
        "name": "leftIcon",
        "type": "ReactNode",
        "description": "Icon displayed before text"
      },
      {
        "name": "disabled",
        "type": "boolean",
        "description": "Disables interaction",
        "default": false
      }
    ],
    "variants": {
      "primary": {
        "description": "Main action button with accent background",
        "props": {
          "background": "var(--accent-9)",
          "color": "white"
        }
      },
      "secondary": {
        "description": "Subtle secondary action",
        "props": {
          "background": "var(--gray-3)",
          "color": "var(--gray-12)"
        }
      }
    },
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "HORIZONTAL",
      "defaultProps": {
        "gap": 4,
        "borderRadius": 6,
        "primaryAxisAlignItems": "CENTER",
        "counterAxisAlignItems": "CENTER"
      }
    },
    "codeSnippet": "<Button variant=\"primary\" size=\"md\" leftIcon={<Plus />}>New Design</Button>\n"
  },

  'Card': {
    "name": "Card",
    "path": "src/ui/components/ui/Card.tsx",
    "description": "Container component with header, content, and footer sections",
    "category": "display",
    "props": [
      {
        "name": "children",
        "type": "ReactNode",
        "description": "Card content",
        "required": true
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "VERTICAL",
      "defaultProps": {
        "padding": 16,
        "gap": 16,
        "borderRadius": "var(--radius-5)",
        "fills": [
          {
            "type": "SOLID",
            "color": "var(--color-surface)"
          }
        ]
      }
    }
  },

  'Header': {
    "name": "Header",
    "path": "src/ui/components/Header.tsx",
    "description": "Plugin top bar with New Chat button, theme toggle, and settings",
    "category": "navigation",
    "props": [
      {
        "name": "title",
        "type": "string",
        "description": "Header title"
      },
      {
        "name": "showActions",
        "type": "boolean",
        "description": "Whether to show right-side actions",
        "default": true
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "HORIZONTAL",
      "defaultProps": {
        "height": 52,
        "paddingHorizontal": 12,
        "primaryAxisAlignItems": "SPACE_BETWEEN",
        "counterAxisAlignItems": "CENTER"
      }
    }
  },

  'Input': {
    "name": "Input",
    "path": "src/ui/components/Input.tsx",
    "description": "Text input field component",
    "category": "input",
    "props": [
      {
        "name": "value",
        "type": "string",
        "description": "Input value"
      },
      {
        "name": "onChange",
        "type": "function",
        "description": "Change handler"
      },
      {
        "name": "placeholder",
        "type": "string",
        "description": "Placeholder text"
      },
      {
        "name": "disabled",
        "type": "boolean",
        "description": "Disable input",
        "default": false
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "HORIZONTAL",
      "defaultProps": {
        "height": 40,
        "paddingHorizontal": 12,
        "borderRadius": 6,
        "border": "1px solid var(--gray-6)"
      }
    }
  },

  'Flex': {
    "name": "Flex",
    "path": "src/ui/components/layout/Flex.tsx",
    "description": "Horizontal flex layout primitive",
    "category": "layout",
    "props": [
      {
        "name": "gap",
        "type": "number | string",
        "description": "Gap between children"
      },
      {
        "name": "align",
        "type": "string",
        "description": "Cross-axis alignment",
        "options": [
          "start",
          "center",
          "end",
          "stretch"
        ]
      },
      {
        "name": "justify",
        "type": "string",
        "description": "Main-axis alignment",
        "options": [
          "start",
          "center",
          "end",
          "between",
          "around"
        ]
      },
      {
        "name": "wrap",
        "type": "boolean",
        "description": "Allow wrapping",
        "default": false
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "HORIZONTAL"
    }
  },

  'Stack': {
    "name": "Stack",
    "path": "src/ui/components/layout/Stack.tsx",
    "description": "Vertical flex layout primitive",
    "category": "layout",
    "props": [
      {
        "name": "gap",
        "type": "number | string",
        "description": "Gap between children"
      },
      {
        "name": "align",
        "type": "string",
        "description": "Cross-axis alignment",
        "options": [
          "start",
          "center",
          "end",
          "stretch"
        ]
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "VERTICAL"
    }
  },

  'ModelSelector': {
    "name": "ModelSelector",
    "path": "src/ui/components/ModelSelector.tsx",
    "description": "Dropdown selector for AI model selection",
    "category": "input",
    "props": [
      {
        "name": "value",
        "type": "string",
        "description": "Selected model ID",
        "required": true
      },
      {
        "name": "onChange",
        "type": "function",
        "description": "Selection change handler",
        "required": true
      },
      {
        "name": "variant",
        "type": "string",
        "description": "Display style",
        "options": [
          "ghost",
          "chip"
        ],
        "default": "ghost"
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "HORIZONTAL",
      "defaultProps": {
        "height": 28,
        "paddingHorizontal": 8,
        "gap": 4,
        "borderRadius": 6
      }
    }
  },

  'Toast': {
    "name": "Toast",
    "path": "src/ui/components/ui/Toast.tsx",
    "description": "Notification toast component",
    "category": "feedback",
    "props": [
      {
        "name": "message",
        "type": "string",
        "description": "Toast message",
        "required": true
      },
      {
        "name": "type",
        "type": "string",
        "description": "Toast type",
        "options": [
          "info",
          "success",
          "warning",
          "error"
        ],
        "default": "info"
      },
      {
        "name": "duration",
        "type": "number",
        "description": "Auto-dismiss duration in ms",
        "default": 3000
      }
    ],
    "figmaMapping": {
      "nodeType": "FRAME",
      "layoutMode": "HORIZONTAL",
      "defaultProps": {
        "padding": 12,
        "gap": 8,
        "borderRadius": 8
      }
    }
  },
};

/**
 * Synced Semantic Rules
 */
export const SEMANTIC_RULES = {
  "rules": [
    {
      "token": "BUTTON",
      "keywords": [
        "button",
        "btn",
        "action"
      ],
      "weight": 10
    },
    {
      "token": "ICON_BUTTON",
      "keywords": [
        "iconbutton",
        "icon-button",
        "btn-icon"
      ],
      "weight": 12
    },
    {
      "token": "AVATAR",
      "keywords": [
        "avatar",
        "profile",
        "user-pic"
      ],
      "weight": 15
    },
    {
      "token": "CARD",
      "keywords": [
        "card",
        "panel",
        "surface"
      ],
      "weight": 8
    },
    {
      "token": "BADGE",
      "keywords": [
        "badge",
        "tag",
        "chip",
        "label"
      ],
      "weight": 10
    }
  ],
  "settings": {
    "match_score": 10,
    "exact_match_bonus": 20,
    "min_threshold": 10
  }
};

export const PROJECT_DESIGN_TOKENS = {
  colors: {
    background: 'var(--color-background)',
    surface: 'var(--color-surface)',
    textPrimary: 'var(--gray-12)',
    textSecondary: 'var(--gray-11)',
    accent: 'var(--accent-9)',
    error: 'var(--error-9)',
    border: 'var(--gray-6)',
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 24,
    6: 32,
  },
  typography: {
    fontSize: { 1: 12, 2: 14, 3: 16 },
    fontWeight: { regular: 400, medium: 500, semibold: 600 },
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  radius: {
    small: 4,
    medium: 6,
    large: 8,
    full: 9999,
  },
};

/**
 * Get all component names
 */
export function getComponentNames(): string[] {
  return Object.keys(PROJECT_UI_REGISTRY);
}

/**
 * Get component by name (case-insensitive)
 */
export function getComponent(name: string): UIComponentMeta | undefined {
  const normalizedName = name.toLowerCase();
  return Object.values(PROJECT_UI_REGISTRY).find(
    c => c.name.toLowerCase() === normalizedName
  );
}

/**
 * Search components by keyword
 */
export function searchComponents(query: string): UIComponentMeta[] {
  const normalizedQuery = query.toLowerCase();
  return Object.values(PROJECT_UI_REGISTRY).filter(c =>
    c.name.toLowerCase().includes(normalizedQuery) ||
    c.description.toLowerCase().includes(normalizedQuery) ||
    c.category.toLowerCase().includes(normalizedQuery)
  );
}

/**
 * Get components by category
 */
export function getComponentsByCategory(category: UIComponentMeta['category']): UIComponentMeta[] {
  return Object.values(PROJECT_UI_REGISTRY).filter(c => c.category === category);
}
