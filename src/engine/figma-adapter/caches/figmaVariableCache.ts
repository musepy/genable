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
        // Skip warmup if already cached within this session.
        // Variables/styles don't change during a single agent run.
        // Use invalidate() if an explicit refresh is needed.
        if (this.isWarmedUp) { return; }

        console.log('[FigmaVariableCache] Warming up cache...');
        const start = Date.now();
        this.variableMap.clear();
        this.styleMap.clear();

        try {
            // 1. Cache Variables
            if (typeof figma !== 'undefined' && figma.variables) {
                const variables = await figma.variables.getLocalVariablesAsync();
                variables.forEach(v => {
                    const fullName = v.name.toLowerCase();
                    this.variableMap.set(fullName, v);
                    const shortName = fullName.split('/').pop();
                    if (shortName && !this.variableMap.has(shortName)) {
                        this.variableMap.set(shortName, v);
                    }
                });
            }

            // 2. Cache Paint Styles
            if (typeof figma !== 'undefined') {
                const paintStyles = await figma.getLocalPaintStylesAsync();
                paintStyles.forEach(s => {
                    const fullName = s.name.toLowerCase();
                    this.styleMap.set(fullName, s);
                    const shortName = fullName.split('/').pop();
                    if (shortName && !this.styleMap.has(shortName)) {
                        this.styleMap.set(shortName, s);
                    }
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

    /**
     * Invalidate the cache so the next warmup() call will refresh data.
     * Call this if variables or styles have been modified during the session.
     */
    public invalidate(): void {
        this.isWarmedUp = false;
    }
}

export const figmaVariableCache = FigmaVariableCache.getInstance();
