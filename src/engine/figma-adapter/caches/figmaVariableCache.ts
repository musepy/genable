export {}; // For isolated module

export class FigmaVariableCache {
    private static instance: FigmaVariableCache;
    private variableMap: Map<string, Variable> = new Map();
    private styleMap: Map<string, PaintStyle> = new Map();
    private isWarmedUp: boolean = false;

    private constructor() { }

    public static getInstance(): FigmaVariableCache {
        if (!FigmaVariableCache.instance) {
            FigmaVariableCache.instance = new FigmaVariableCache();
        }
        return FigmaVariableCache.instance;
    }

    /**
     * Warm up the cache by fetching all local variables and styles
     * This replaces the inline logic in main.ts
     */
    public async warmup(): Promise<void> {
    // [Fix]: Always refresh cache to ensure latest variables are picked up
    // if (this.isWarmedUp) { return; }
        
        console.log('[FigmaVariableCache] Warming up cache...');
        const start = Date.now();
        this.variableMap.clear();
        this.styleMap.clear();

        try {
            // 1. Cache Variables
            if (typeof figma !== 'undefined' && figma.variables) {
                const variables = await figma.variables.getLocalVariablesAsync();
                variables.forEach(v => {
                    this.variableMap.set(v.name.toLowerCase(), v);
                });
            }

            // 2. Cache Paint Styles
            if (typeof figma !== 'undefined') {
                const paintStyles = await figma.getLocalPaintStylesAsync();
                paintStyles.forEach(s => {
                    this.styleMap.set(s.name.toLowerCase(), s);
                });
            }

            this.isWarmedUp = true;
            console.log(`[FigmaVariableCache] Cache warmed in ${Date.now() - start}ms. Vars: ${this.variableMap.size}, Styles: ${this.styleMap.size}`);

        } catch (e) {
            console.error('[FigmaVariableCache] Warmup failed', e);
            // Non-fatal, we just won't have cache
        }
    }

    /**
     * Get a variable by name (case-insensitive)
     */
    public getVariable(name: string): Variable | null {
        if (!name || typeof name !== 'string') return null;
        return this.variableMap.get(name.toLowerCase()) || null;
    }

    /**
     * Get a paint style by name (case-insensitive)
     */
    public getStyle(name: string): PaintStyle | null {
        if (!name || typeof name !== 'string') return null;
        return this.styleMap.get(name.toLowerCase()) || null;
    }

    /**
     * Check if cache has any variables.
     * Useful for determining if bootstrap is needed.
     */
    public hasVariables(): boolean {
        return this.variableMap.size > 0;
    }
    
    /**
     * Explicitly check warmup status
     */
    public isReady(): boolean {
        return this.isWarmedUp;
    }
}

export const figmaVariableCache = FigmaVariableCache.getInstance();
