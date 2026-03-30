/**
 * @file figmaSync.ts
 * @description Bridges parsed tokens to Figma Variables API.
 */

import { TokenMode } from './tokenParser';
import { parseHexToRGBA, rgbaToHex } from '../../utils/colorUtils';
import type { RGBA } from '../../utils/colorUtils';

export class FigmaSync {
  /**
   * Sync parsed tokens to Figma Local Variables.
   */
  static async syncTokens(modes: TokenMode[], collectionName: string = 'Design Tokens'): Promise<{ message: string; error?: boolean }> {
    try {
      let collection = (await figma.variables.getLocalVariableCollectionsAsync())
        .find(c => c.name === collectionName);

      if (!collection) {
        collection = figma.variables.createVariableCollection(collectionName);
      }

      // 1. Manage Modes
      const figmaModes = collection.modes;
      const modeMap = new Map<string, string>(); // modeName -> modeId

      for (const tokenMode of modes) {
        let figmaMode = figmaModes.find(m => m.name === tokenMode.name);
        if (!figmaMode) {
          // Rename default mode if it's generic
          if (figmaModes.length === 1 && figmaModes[0].name.startsWith('Mode')) {
            collection.renameMode(figmaModes[0].modeId, tokenMode.name);
            figmaMode = collection.modes[0];
          } else {
            try {
              const newModeId = collection.addMode(tokenMode.name);
              figmaMode = collection.modes.find(m => m.modeId === newModeId);
            } catch (e) {
              console.error(`[FigmaSync] Failed to add mode ${tokenMode.name}`, e);
            }
          }
        }
        if (figmaMode) {
          modeMap.set(tokenMode.name, figmaMode.modeId);
        }
      }

      // 2. Sync Variables
      // Cache all variables across all collections to support cross-collection aliases
      const allVariables = await figma.variables.getLocalVariablesAsync();
      const collectionVariables = allVariables.filter(v => v.variableCollectionId === collection!.id);

      for (const tokenMode of modes) {
        const modeId = modeMap.get(tokenMode.name);
        if (!modeId) continue;

        // Pass 1: Create all variables first to handle forward references
        for (const token of tokenMode.tokens) {
          let variable = collectionVariables.find(v => v.name === token.name);
          
          let rawType = token.type || this.guessVariableType(token.value, token.name);
          if (!rawType) continue;

          // Normalize type to Figma Enum
          let type: VariableResolvedDataType;
          const t = rawType.toUpperCase();
          if (t === 'COLOR' || t === 'COLOUR') type = 'COLOR';
          else if (t === 'FLOAT' || t === 'NUMBER' || t === 'DIMENSION') type = 'FLOAT';
          else if (t === 'BOOLEAN' || t === 'BOOL') type = 'BOOLEAN';
          else type = 'STRING';

          if (!variable) {
            variable = figma.variables.createVariable(token.name, collection!, type);
            collectionVariables.push(variable);
            allVariables.push(variable);
          } else if (variable.resolvedType !== type) {
             console.log(`[FigmaSync] Type mismatch for ${token.name} (${variable.resolvedType} -> ${type}). Recreating...`);
             variable.remove();
             const allIdx = allVariables.findIndex(v => v.id === variable?.id);
             if (allIdx !== -1) allVariables.splice(allIdx, 1);
             variable = figma.variables.createVariable(token.name, collection!, type);
             const idx = collectionVariables.findIndex(v => v.name === token.name);
             if (idx !== -1) collectionVariables[idx] = variable;
             allVariables.push(variable);
          }
        }

        // Pass 2: Set Values / Aliases
        for (const token of tokenMode.tokens) {
           const variable = collectionVariables.find(v => v.name === token.name);
           if (!variable) continue;
           
           let rawType = token.type || this.guessVariableType(token.value, token.name);
           let type: VariableResolvedDataType = 'STRING'; 
           if (rawType) {
              const t = rawType.toUpperCase();
              if (t === 'COLOR' || t === 'COLOUR') type = 'COLOR';
              else if (t === 'FLOAT' || t === 'NUMBER' || t === 'DIMENSION') type = 'FLOAT';
              else if (t === 'BOOLEAN' || t === 'BOOL') type = 'BOOLEAN';
           }

          // Handle Alias or Value
          // Format: {group/subgroup/name}
          if (token.value.startsWith('{') && token.value.endsWith('}')) {
            // Standardize path: lowercased, dots to slashes
            const rawAlias = token.value.slice(1, -1);
            const aliasPath = rawAlias.replace(/\./g, '/').toLowerCase();
            
            // Strategies to find the variable:
            // 1. Exact Match
            let targetVar = allVariables.find(v => v.name.toLowerCase() === aliasPath);

            // 2. Suffix Match (resolve "colors/blue/9" -> "blue/9")
            if (!targetVar) {
               targetVar = allVariables.find(v => {
                 const vName = v.name.toLowerCase();
                 // Check if variable name ends with the alias path (unlikely) 
                 // OR if alias path ends with the variable name (more likely, e.g. alias "tokens/colors/blue/9" -> var "blue/9")
                 return aliasPath.endsWith(vName) || vName.endsWith(aliasPath);
               });
            }

            // 3. Segment Match (Last 2 segments, e.g. "blue/9")
            if (!targetVar) {
              const segments = aliasPath.split('/');
              if (segments.length >= 2) {
                const key = segments.slice(-2).join('/'); // "blue/9"
                targetVar = allVariables.find(v => v.name.toLowerCase().endsWith(key));
              }
            }
            
            if (targetVar) {
              try {
                variable.setValueForMode(modeId, figma.variables.createVariableAlias(targetVar));
              } catch (e) {
                console.warn(`[FigmaSync] Failed to set alias for ${token.name} -> ${targetVar.name}:`, e);
              }
              continue;
            } else {
              // Only warn if it's not a common seemingly-alias value
              console.warn(`[FigmaSync] Unresolved Alias: "${aliasPath}" for token "${token.name}"`);
              continue; 
            }
          }

          const value = this.parseValueForFigma(token.value, type);
          
          // Safety check for invalid values (e.g. NaN for FLOAT)
          if (type === 'FLOAT' && (typeof value !== 'number' || isNaN(value))) {
             // console.warn(`[FigmaSync] Invalid FLOAT value for ${token.name}: ${token.value}`);
             continue;
          }

          if (value !== undefined) {
            variable.setValueForMode(modeId, value);
          }
        }
      }

      return { message: `Successfully synced ${modes.length} modes to "${collectionName}".` };
    } catch (error: any) {
      console.error('[FigmaSync] Sync failed:', error);
      return { message: error.message || 'Unknown error during sync', error: true };
    }
  }

  /**
   * Export Figma Variables back to structured TokenMode data.
   */
  static async exportTokens(collectionName: string = 'Design Tokens'): Promise<TokenMode[]> {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collection = collections.find(c => c.name === collectionName);

    if (!collection) return [];

    const variables = await figma.variables.getLocalVariablesAsync();
    const collectionVariables = variables.filter(v => v.variableCollectionId === collection.id);

    return collection.modes.map(mode => ({
      name: mode.name,
      tokens: collectionVariables.map(v => {
        const val = v.valuesByMode[mode.modeId];
        return {
          name: v.name,
          value: this.formatFigmaValue(val, v.resolvedType, variables), // Pass all variables for alias resolution
          type: v.resolvedType,
          originalValue: ''
        };
      })
    }));
  }

  private static guessVariableType(value: string, name: string): VariableResolvedDataType | null {
    // 1. Context-Aware Naming Check (Priority to FLOAT to catch 'border-width' etc)
    const n = name.toLowerCase().replace(/\//g, '-'); // Normalize to hyphens for easier sub-string matching
    
    if (n.includes('radius') || 
        n.includes('space') || 
        n.includes('gap') || 
        n.includes('size') || 
        n.includes('width') || 
        n.includes('height') || 
        n.includes('opacity') || 
        n.includes('font-size') || 
        n.includes('line-height') || 
        n.includes('letter-spacing') ||
        n.includes('weight')
    ) return 'FLOAT';

    if (n.includes('color') || 
        n.includes('bg') || 
        n.includes('text') || 
        n.includes('border') || 
        n.includes('accent') || 
        n.includes('surface') || 
        n.includes('fill') || 
        n.includes('stroke') || 
        n.includes('gray') || 
        n.includes('blue') || 
        n.includes('red') || 
        n.includes('green') || 
        n.includes('amber')
    ) return 'COLOR';

    const v = value.toLowerCase();
    // Color pattern: #hex, rgb, rgba
    if (v.startsWith('#') || v.startsWith('rgba') || v.startsWith('rgb')) {
      return 'COLOR';
    }

    // Alias fallback - if name heuristics didn't catch it, 
    // we should still try to see if it's a number-like alias.
    if (v.startsWith('{') && v.endsWith('}')) {
       // Deep name check for common patterns in aliases
       if (v.includes('spacing') || v.includes('radius') || v.includes('size')) return 'FLOAT';
       // Default to STRING if we really don't know, since almost all colors are caught by name check above
       return 'COLOR'; 
    }

    const cleanValue = value.replace('px', '').trim();
    if (!isNaN(parseFloat(cleanValue)) && !v.includes(' ')) {
      return 'FLOAT';
    }
    if (v === 'true' || v === 'false') {
      return 'BOOLEAN';
    }
    return 'STRING';
  }

  private static parseValueForFigma(value: string, type: VariableResolvedDataType): any {
    if (type === 'COLOR') {
       return parseHexToRGBA(value);
    }
    if (type === 'FLOAT') {
      return parseFloat(value.replace('px', ''));
    }
    if (type === 'BOOLEAN') {
      return value.toLowerCase() === 'true';
    }
    return value;
  }

  private static formatFigmaValue(val: any, type: VariableResolvedDataType, allVariables?: Variable[]): string {
    // Handle Aliases
    if (val && typeof val === 'object' && val.type === 'VARIABLE_ALIAS' && allVariables) {
      const target = allVariables.find(v => v.id === val.id);
      return target ? `{${target.name}}` : '{unknown}';
    }

    if (type === 'COLOR') {
      const rgba = val as RGBA;
      if (!rgba) return '#000000';
      return rgbaToHex(rgba);
    }
    if (type === 'FLOAT') {
       return `${val}px`;
    }
    return String(val);
  }
}
