/**
 * @file bootstrapper.ts
 * @description Design System Bootstrapper - Automatically creates Figma variables 
 * aligned with Radix UI and Tailwind CSS standards.
 */

import { parseHexColor } from '../../utils/colorUtils';

/**
 * Standard Semantic Tokens for the [Theme] Semantic collection
 */
export const SEMANTIC_TOKENS = {
  background: { light: '#fcfcfc', dark: '#111111', description: 'Main page background' },
  foreground: { light: '#202020', dark: '#eeeeee', description: 'Primary text color' },
  card: { light: '#ffffff', dark: '#191919', description: 'Card and panel background' },
  muted: { light: '#f0f0f0', dark: '#222222', description: 'Secondary/muted background' },
  'muted-foreground': { light: '#646464', dark: '#b4b4b4', description: 'Secondary/muted text' },
  border: { light: '#d9d9d9', dark: '#3a3a3a', description: 'Standard borders' },
  'border-subtle': { light: '#e8e8e8', dark: '#2a2a2a', description: 'Subtle borders' },
  'border-strong': { light: '#bbbbbb', dark: '#606060', description: 'Strong/active borders' },
  primary: { light: '#0091ff', dark: '#0091ff', description: 'Accent/Primary color' },
  'primary-foreground': { light: '#ffffff', dark: '#111111', description: 'Text on primary' },
  success: { light: '#30a46c', dark: '#30a46c', description: 'Success/Positive states' },
  warning: { light: '#ffb224', dark: '#ffb224', description: 'Warning/Alert states' },
  destructive: { light: '#e5484d', dark: '#e5484d', description: 'Critical/Error states' },
  solid: { light: '#202020', dark: '#eeeeee', description: 'Solid surface backgrounds' },
  'solid-foreground': { light: '#fcfcfc', dark: '#111111', description: 'Text on solid surfaces' }
};

/**
 * Initialize a basic design system variable collection if none exists.
 * This bridges the gap between "Raw Drawing" and "Architectural Design".
 */
export async function initializeDesignSystem(): Promise<VariableCollection | null> {
  try {
    // 1. Check for existing "Semantic" or "Theme" collections
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    let semanticCollection = collections.find(c => 
      c.name.includes('Semantic') || c.name.includes('Theme')
    );

    if (semanticCollection) {
      console.log('[Bootstrapper] Semantic collection already exists:', semanticCollection.name);
      return semanticCollection;
    }

    // 2. Create new collection
    console.log('[Bootstrapper] No semantic collection found. Initializing Radix-aligned architecture...');
    semanticCollection = figma.variables.createVariableCollection('[Theme] Semantic');
    
    // Rename default mode to "Light" and add "Dark"
    const lightModeId = semanticCollection.modes[0].modeId;
    semanticCollection.renameMode(lightModeId, 'Light');
    const darkModeId = semanticCollection.addMode('Dark');

    // 3. Populate tokens
    for (const [name, values] of Object.entries(SEMANTIC_TOKENS)) {
      const variable = figma.variables.createVariable(name, semanticCollection, 'COLOR');
      variable.description = values.description;

      // Set values for both modes
      const lightRgba = parseHexColor(values.light);
      const darkRgba = parseHexColor(values.dark);
      
      variable.setValueForMode(lightModeId, {
        r: lightRgba.r, g: lightRgba.g, b: lightRgba.b, a: lightRgba.a
      });
      variable.setValueForMode(darkModeId, {
        r: darkRgba.r, g: darkRgba.g, b: darkRgba.b, a: darkRgba.a
      });
    }

    figma.notify('Design System initialized with Radix Semantic tokens.');
    return semanticCollection;
  } catch (e) {
    console.error('[Bootstrapper] Failed to initialize design system:', e);
    return null;
  }
}
