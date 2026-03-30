/**
 * @file DesignSystemManager.ts
 * @description Coordinates standard collections (Primitives & Semantic) following Radix UI patterns.
 */

import { RADIX_SCALES } from '../../constants/radixColors';
import { parseHexToRGBA } from '../../utils/colorUtils';
import { TokenMode, TokenParser } from './tokenParser';
import { FigmaSync } from './figmaSync';


interface SnapshotMetadata {
  version: string;
  timestamp: number;
  message: string;
  hash: string;
}

export class DesignSystemManager {
  private static PRIMITIVE_COLLECTION_NAME = 'Color scheme';
  private static THEME_COLLECTION_NAME = 'Theme ✦';
  private static RADIUS_COLLECTION_NAME = 'Radius';
  private static SCALING_COLLECTION_NAME = 'Scaling';

  /**
   * Orchestrate the entire sync process.
   */
  static async sync(semanticModes: TokenMode[]): Promise<{ message: string; error?: boolean }> {
    try {
      console.log('[DesignSystemManager] Starting Sync with modes:', semanticModes.length);

      // 0. Resolve CSS Variables
      semanticModes = TokenParser.resolveLinks(semanticModes, true);

      // 1. Prepare Radius & Scaling Tokens
      // REMOVED: Automatic injection of default tokens
      // REMOVED: Strict segregation of collections

      // 2. Clear & Prepare Local Variable Collections
      await this.ensureCollectionsExist();

      // 3. Sync Collections (Primitives)
      await this.ensurePrimitiveScales();
      
      // 4. Sync All User Tokens to Theme Collection
      const themeModes = semanticModes.map(m => {
          // Only filter out Primitives
          const themeTokens = m.tokens.filter(t => !this.isPrimitiveToken(t.name));

          console.log(`[DesignSystemManager] Mode "${m.name}":`);
          console.log(`  - Total Tokens: ${m.tokens.length}`);
          console.log(`  - Theme/User Tokens: ${themeTokens.length}`);

          return {
              ...m,
              tokens: themeTokens
          };
      });

      // Execute Sync
      console.log(`[DesignSystemManager] Syncing "${this.THEME_COLLECTION_NAME}" with ${themeModes[0]?.tokens.length || 0} tokens`);
      const result = await FigmaSync.syncTokens(themeModes, this.THEME_COLLECTION_NAME);

      // 5. Commit Snapshot
      if (!result.error) {
          const hash = this.calculateHash(semanticModes);
          await this.commitSnapshot('theme', `Full Coverage Sync: ${new Date().toLocaleString()}`, hash);
      }

      return {
        message: `Design System Synced with 100% coverage: ${result.message}`,
        error: result.error,
      };
    } catch (e: any) {
      console.error('[DesignSystemManager] Sync failed:', e);
      return { message: e.message || 'Design System sync failed', error: true };
    }
  }

  private static async ensureCollectionsExist() {
      const names = [
          this.PRIMITIVE_COLLECTION_NAME,
          this.THEME_COLLECTION_NAME,
          this.RADIUS_COLLECTION_NAME,
          this.SCALING_COLLECTION_NAME
      ];
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      for (const name of names) {
          if (!collections.find(c => c.name === name)) {
              console.log(`[DesignSystemManager] Creating Collection: ${name}`);
              figma.variables.createVariableCollection(name);
          }
      }
  }

  /**
   * Ensure standard Radix Scales exist in a dedicated Primitives collection.
   * Supports Light and Dark modes for each primitive variable.
   */
  private static async ensurePrimitiveScales() {
    let collection = (await figma.variables.getLocalVariableCollectionsAsync())
      .find(c => c.name === this.PRIMITIVE_COLLECTION_NAME);

    if (!collection) {
      console.log('[DesignSystemManager] Creating Primitives Collection');
      collection = figma.variables.createVariableCollection(this.PRIMITIVE_COLLECTION_NAME);
    }
    console.log('[DesignSystemManager] Radix Scales keys:', Object.keys(RADIX_SCALES).length);

    // Ensure we have Light and Dark modes in Primitives
    const existingModes = collection.modes;
    let lightModeId = existingModes.find(m => m.name === 'Light')?.modeId;
    let darkModeId = existingModes.find(m => m.name === 'Dark')?.modeId;

    if (!lightModeId) {
      if (existingModes.length === 1 && existingModes[0].name.startsWith('Mode')) {
        collection.renameMode(existingModes[0].modeId, 'Light');
        lightModeId = existingModes[0].modeId;
      } else {
        lightModeId = collection.addMode('Light');
      }
    }

    if (!darkModeId) {
      try {
        darkModeId = collection.addMode('Dark');
      } catch (e) {
        // Figma free plan limit might hit here, but for our plugin it's usually fine
        console.warn('[DesignSystemManager] Could not add Dark mode to Primitives (limit?)');
      }
    }

    const existingVars = (await figma.variables.getLocalVariablesAsync())
        .filter(v => v.variableCollectionId === collection!.id);

    // Sync Helper
    const syncScale = (namePrefix: string, scale: string[], modeId: string | undefined, isAlpha: boolean = false) => {
      if (!modeId) return;
      scale.forEach((hex, i) => {
        const step = i + 1;
        const varName = isAlpha ? `${namePrefix.replace('/a', '')}/a${step}` : `${namePrefix}/${step}`;
        let variable = existingVars.find(v => v.name === varName);
        if (!variable) {
          variable = figma.variables.createVariable(varName, collection!, 'COLOR');
          existingVars.push(variable);
        }
        const color = parseHexToRGBA(hex);
        if (color) variable.setValueForMode(modeId, color);
      });
    };

    // Create Radix Color Scales
    for (const [colorName, modes] of Object.entries(RADIX_SCALES)) {
      // Solid Scales
      syncScale(colorName, modes.light, lightModeId);
      if (modes.dark) syncScale(colorName, modes.dark, darkModeId);

      // Alpha Scales
      if ((modes as any).alphaLight) {
        syncScale(`${colorName}/a`, (modes as any).alphaLight, lightModeId, true);
      }
      if ((modes as any).alphaDark) {
        syncScale(`${colorName}/a`, (modes as any).alphaDark, darkModeId, true);
      }
    }
    console.log(`[DesignSystemManager] Primitives confirmed with dual-mode support in ${this.PRIMITIVE_COLLECTION_NAME}`);
  }

  /**
   * Commit a version snapshot to the collection.
   */
  static async commitSnapshot(collectionType: 'primitive' | 'theme' | 'radius' | 'scaling', message: string, hash: string) {
    let name = '';
    switch (collectionType) {
      case 'primitive': name = this.PRIMITIVE_COLLECTION_NAME; break;
      case 'theme': name = this.THEME_COLLECTION_NAME; break;
      case 'radius': name = this.RADIUS_COLLECTION_NAME; break;
      case 'scaling': name = this.SCALING_COLLECTION_NAME; break;
    }

    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collection = collections.find(c => c.name === name);

    if (!collection) return;

    // Read history
    const historyJson = collection.getPluginData('snapshot_history') || '[]';
    const history: SnapshotMetadata[] = JSON.parse(historyJson);

    // Add new snapshot
    const newSnapshot: SnapshotMetadata = {
      version: `1.0.${history.length + 1}`,
      timestamp: Date.now(),
      message,
      hash
    };

    history.push(newSnapshot);
    
    // Limits history to last 50 entries
    if (history.length > 50) history.shift();

    collection.setPluginData('snapshot_history', JSON.stringify(history));
    collection.setPluginData('current_version', newSnapshot.version);

    console.log(`[DesignSystemManager] Committed version ${newSnapshot.version} to ${name}`);
  }

  /**
   * Simple hash for token values to detect changes.
   */
  private static calculateHash(modes: TokenMode[]): string {
    const str = JSON.stringify(modes.map(m => ({ 
      n: m.name, 
      t: m.tokens.map(t => ({ n: t.name, v: t.value })) 
    })));
    
    // Simple numeric hash for demonstration
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
  }

  /**
   * Export ALL design system collections into a single structured DTCG JSON.
   */
  static async exportAll(): Promise<any> {
    const collections = [
        this.PRIMITIVE_COLLECTION_NAME,
        this.THEME_COLLECTION_NAME,
        this.RADIUS_COLLECTION_NAME,
        this.SCALING_COLLECTION_NAME
    ];

    const allModes: TokenMode[] = [];

    for (const collectionName of collections) {
        const modes = await FigmaSync.exportTokens(collectionName);
        for (const mode of modes) {
            let existingMode = allModes.find(m => m.name === mode.name);
            if (!existingMode) {
                existingMode = { name: mode.name, tokens: [] };
                allModes.push(existingMode);
            }
            existingMode.tokens.push(...mode.tokens);
        }
    }

    // Convert flat list to nested DTCG structure per mode
    const result: any = { modes: {} };
    for (const mode of allModes) {
        result.modes[mode.name] = TokenParser.unflattenJSON(mode.tokens);
    }

    // If only one mode (e.g. "Light"), we can simplify the output
    if (Object.keys(result.modes).length === 1) {
        const singleMode = Object.values(result.modes)[0] as any;
        return {
            ...singleMode,
            $extensions: {
                'com.figma.modeName': Object.keys(result.modes)[0]
            }
        };
    }

    return result;
  }

  /**
   * Identifies if a token name follows the primitive scale naming pattern (e.g., "gray/1").
   * NOW USES WHITELIST: Only keys in RADIX_SCALES are considered primitives.
   */
  private static isPrimitiveToken(name: string): boolean {
    const primitivePrefixes = Object.keys(RADIX_SCALES);
    const parts = name.toLowerCase().split('/');
    const prefix = parts[0];
    
    // Check if it matches radix scale pattern: palette/step or palette/alpha/step
    const isBase = primitivePrefixes.includes(prefix) && /^[a-z]+\/[a-z]?\d+$/.test(name.toLowerCase());
    const isAlpha = primitivePrefixes.includes(prefix) && name.toLowerCase().includes('/a') && /\/a\d+$/.test(name.toLowerCase());

    return isBase || isAlpha;
  }

  private static isRadiusToken(name: string): boolean {
      return name.toLowerCase().startsWith('radius/');
  }

  private static isScalingToken(name: string): boolean {
      const n = name.toLowerCase();
      return n.startsWith('space/') || n.startsWith('size/') || n.startsWith('gap/') || n.startsWith('spacing/');
  }
}
