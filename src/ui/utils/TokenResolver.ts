import { tokens } from '../design-system/tokens';

/**
 * TokenResolver: Maps raw CSS values back to design system tokens.
 */
export class TokenResolver {
  private static colorMap: Map<string, string> = new Map();
  private static radiiMap: Map<string, string> = new Map();
  private static isInitialized = false;

  /**
   * Warms up the resolver by probing CSS variables in the current environment.
   */
  static init(doc: Document = document) {
    if (this.isInitialized) return;
    
    const ownerWindow = doc.defaultView || window;
    // Create a probe element to resolve CSS variables
    const probe = doc.createElement('div');
    probe.style.display = 'none';
    doc.body.appendChild(probe);

    // 1. Resolve Colors
    for (const [name, variable] of Object.entries(tokens.colors)) {
      if (typeof variable === 'string' && variable.startsWith('var(')) {
        probe.style.color = variable;
        const resolved = ownerWindow.getComputedStyle(probe).color;
        this.colorMap.set(resolved, name);
      }
    }

    // 2. Resolve Radii (Custom radius tokens if any)
    // Add logic here if needed

    document.body.removeChild(probe);
    this.isInitialized = true;
  }

  /**
   * Attempts to find a token name for a given color.
   */
  static resolveColor(rgba: string): string {
    this.init();
    return this.colorMap.get(rgba) || rgba;
  }
}
