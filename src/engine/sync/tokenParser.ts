/**
 * @file tokenParser.ts
 * @description Parser for CSS custom properties and JSON to structured token data.
 * Ensures bi-directional consistency between DTCG and Figma formats.
 */

export interface TokenValue {
  colorSpace?: 'srgb';
  components?: number[];
  alpha?: number;
  hex?: string;
  [key: string]: any;
}

export interface TokenData {
  name: string; // Hierarchical name, e.g., "color/bg/primary"
  value: any; 
  type?: string; // DTCG type: 'color', 'dimension', 'number', etc.
  originalValue?: any;
}

export interface TokenMode {
  name: string; // 'Light', 'Dark', etc.
  tokens: TokenData[];
}

export class TokenParser {
  /**
   * Figma Variable Type mapping
   */
  private static readonly TYPE_MAP: Record<string, string> = {
    'color': 'COLOR',
    'dimension': 'FLOAT',
    'number': 'FLOAT',
    'float': 'FLOAT',
    'boolean': 'BOOLEAN',
    'string': 'STRING'
  };

  /**
   * Parse a structured JSON object into TokenModes.
   * Supports DTCG-compliant JSON and custom 'modes' wrapper.
   */
  static parseJSON(json: any): TokenMode[] {
    const modes: TokenMode[] = [];

    if (json.modes && typeof json.modes === 'object') {
      for (const [modeName, content] of Object.entries(json.modes)) {
        modes.push({
          name: modeName,
          tokens: this.flattenJSON(content as object)
        });
      }
    } else if (json.$extensions && json.$extensions['com.figma.modeName']) {
      modes.push({
        name: json.$extensions['com.figma.modeName'],
        tokens: this.flattenJSON(json)
      });
    } else {
      modes.push({
        name: 'Default',
        tokens: this.flattenJSON(json)
      });
    }

    return modes;
  }

  /**
   * Flattens nested JSON into TokenData list.
   * Optimized for DTCG standard ($value).
   */
  static flattenJSON(obj: object, path: string = ''): TokenData[] {
    let tokens: TokenData[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('$') && key !== '$value' && key !== '$type') continue;

      const currentPath = path ? `${path}/${key}` : key;

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const dtcgValue = value['$value'] ?? (value as any)['value'];
        const dtcgType = value['$type'] ?? (value as any)['type'];

        if (dtcgValue !== undefined) {
          tokens.push({
            name: this.standardizeName(currentPath),
            value: dtcgValue,
            type: (dtcgType || this.inferType(dtcgValue)).toLowerCase(),
            originalValue: dtcgValue
          });
        } else {
          tokens.push(...this.flattenJSON(value, currentPath));
        }
      } else {
        tokens.push({
          name: this.standardizeName(currentPath),
          value: value,
          type: this.inferType(value).toLowerCase(),
          originalValue: value
        });
      }
    }

    return tokens;
  }

  /**
   * Reconstruct DTCG JSON from Token list.
   * Inverse of flattenJSON.
   */
  static unflattenJSON(tokens: TokenData[]): any {
    const root: any = {};

    for (const token of tokens) {
      const parts = token.name.split('/');
      let current = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          current[part] = {
            '$value': token.value,
            '$type': token.type
          };
        } else {
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      }
    }

    return root;
  }

  /**
   * Standardizes naming: CSS-style (hyphens) to Figma-style (slashes).
   */
  static standardizeName(name: string): string {
    if (name.includes('/')) return name;
    return name.replace(/-/g, '/');
  }

  /**
   * Reverses standardization for export/DTCG naming.
   */
  static destandardizeName(name: string): string {
    return name.replace(/\//g, '-');
  }

  private static inferType(value: any): string {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') {
      if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl')) return 'color';
      if (value.endsWith('px') || /^\d+$/.test(value)) return 'dimension';
    }
    if (typeof value === 'object' && value !== null) {
      if (value.hex || (value.r !== undefined && value.g !== undefined)) return 'color';
    }
    return 'string';
  }

  /**
   * Map DTCG type to Figma API VariableResolvedDataType
   */
  static getFigmaType(dtcgType: string): string {
    return this.TYPE_MAP[dtcgType.toLowerCase()] || 'STRING';
  }

  /**
   * Resolve variable references (e.g., var(--gray-1)) to their actual values.
   * Required by DesignSystemManager.
   */
  static resolveLinks(modes: TokenMode[], preserveAliases: boolean = false): TokenMode[] {
    return modes.map(mode => {
      const tokenMap = new Map(mode.tokens.map(t => [t.name, t.value]));
      
      const resolvedTokens = mode.tokens.map(token => {
        let value = token.value;
        let depth = 0;
        const MAX_DEPTH = 5;

        if (typeof value === 'string' && value.includes('var(--')) {
            if (preserveAliases) {
              // Convert var(--gray-1) to {gray/1}
              value = value.replace(/var\(--([\w-]+)\)/g, (_, varName) => {
                return `{${this.standardizeName(varName)}}`;
              });
            } else {
              while (typeof value === 'string' && value.includes('var(--') && depth < MAX_DEPTH) {
                value = value.replace(/var\(--([\w-]+)\)/g, (_, varName) => {
                  const standardized = this.standardizeName(varName);
                  return tokenMap.get(standardized) || `var(--${varName})`;
                });
                depth++;
              }
            }
        }

        return {
          ...token,
          value: value
        };
      });

      return {
        ...mode,
        tokens: resolvedTokens
      };
    });
  }

  /**
   * Legacy CSS parser for backward compatibility if needed.
   */
  static parse(cssString: string): TokenMode[] {
    const modes: TokenMode[] = [];
    const rootMatches = cssString.match(/:root\s*{([^}]*)}/g);
    if (rootMatches) {
      const allRootTokens: TokenData[] = [];
      for (const block of rootMatches) {
        const innerContent = block.match(/:root\s*{([^}]*)}/)?.[1];
        if (innerContent) {
          const declarationRegex = /--([^:]+):\s*([^;]+);/g;
          let match;
          while ((match = declarationRegex.exec(innerContent)) !== null) {
            const name = match[1].trim();
            const value = match[2].trim();
            allRootTokens.push({
              name: this.standardizeName(name),
              value,
              type: this.inferType(value),
              originalValue: value
            });
          }
        }
      }
      if (allRootTokens.length > 0) {
        modes.push({ name: 'Light', tokens: allRootTokens });
      }
    }
    return modes;
  }
}
