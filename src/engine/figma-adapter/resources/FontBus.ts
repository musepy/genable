/**
 * @file FontBus.ts
 * @description Centralized font resource management for the Figma plugin.
 * 
 * [RESPONSIBILITIES]:
 * 1. Maintain a registry of mandatory (Static) and optional (Dynamic) fonts.
 * 2. Provide a "Loading Barrier" to ensure core fonts are ready before rendering.
 * 3. Handle asynchronous on-demand font loading without blocking the main pipeline.
 * 4. Transparently manage fallbacks when fonts are unavailable.
 */

export interface FontRecord {
    family: string;
    style: string;
}

export class FontBus {
    private static instance: FontBus;
    private loadedFonts: Set<string> = new Set();
    private loadingQueues: Map<string, Promise<void>> = new Map();

    private readonly STATIC_FONTS: FontRecord[] = [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Medium' },
        { family: 'Inter', style: 'Semi Bold' },
        { family: 'Inter', style: 'Bold' }
    ];

    private constructor() {}

    public static getInstance(): FontBus {
        if (!FontBus.instance) {
            FontBus.instance = new FontBus();
        }
        return FontBus.instance;
    }

    /**
     * Warmup: Load mandatory fonts (Static Set)
     * This acts as the "Loading Barrier" for the Orchestrator.
     */
    public async warmup(): Promise<void> {
        console.log('[FontBus] Starting static set warmup...');
        await Promise.all(this.STATIC_FONTS.map(f => this.loadFontAsync(f)));
        console.log('[FontBus] Warmup complete.');
    }

    /**
     * Get or Load: High-level entry for Renderers
     * If the font is not ready, it kicks off loading and returns immediate status.
     */
    public async getOrLoad(family: string, style: string): Promise<boolean> {
        const normalizedStyle = this.normalizeStyle(style);
        const key = this.getFontKey(family, normalizedStyle);
        
        if (this.loadedFonts.has(key)) return true;

        // If currently loading, wait for it
        if (this.loadingQueues.has(key)) {
            await this.loadingQueues.get(key);
            return this.loadedFonts.has(key);
        }

        // Trigger dynamic on-demand load
        try {
            await this.loadFontAsync({ family, style: normalizedStyle });
            return true;
        } catch (e) {
            console.warn(`[FontBus] Dynamic load failed for ${key}, falling back to Inter Regular`);
            return false;
        }
    }

    /**
     * Normalize font style names for common Figma variations
     */
    private normalizeStyle(style: any): string {
        if (style === null || style === undefined) return 'Regular';
        
        // Handle numeric weights (e.g. 400 -> Regular, 700 -> Bold)
        if (typeof style === 'number') {
            if (style <= 400) return 'Regular';
            if (style <= 500) return 'Medium';
            if (style <= 600) return 'Semi Bold';
            return 'Bold';
        }

        // Safe casting to string before manipulation
        const styleStr = String(style);
        const s = styleStr.toLowerCase().replace(/[^a-z]/g, '');
        
        // Figma standard for Inter and most common fonts
        if (s === 'semibold' || s === 'demibold') return 'Semi Bold';
        if (s === 'bold') return 'Bold';
        if (s === 'medium') return 'Medium';
        if (s === 'regular' || s === 'normal') return 'Regular';
        if (s === 'italic') return 'Italic';
        if (s === 'bolditalic') return 'Bold Italic';
        
        return styleStr; 
    }

    /**
     * Check if a font is currently available
     */
    public isLoaded(family: string, style: string): boolean {
        return this.loadedFonts.has(this.getFontKey(family, style));
    }

    /**
     * Private: Actual Figma API call with queue management
     */
    private async loadFontAsync(font: FontRecord): Promise<void> {
        const key = this.getFontKey(font.family, font.style);
        if (this.loadedFonts.has(key)) return;

        const loadPromise = (async () => {
            try {
                await figma.loadFontAsync(font);
                this.loadedFonts.add(key);
            } catch (e) {
                console.warn(`[FontBus] Failed to load font: ${key}`, e);
                // Attempt fallback to Regular if specific style fails
                if (font.style !== 'Regular') {
                    await this.loadFontAsync({ family: font.family, style: 'Regular' });
                }
            } finally {
                this.loadingQueues.delete(key);
            }
        })();

        this.loadingQueues.set(key, loadPromise);
        return loadPromise;
    }

    private getFontKey(family: string, style: string): string {
        return `${family}:${style}`;
    }
}

export const fontBus = FontBus.getInstance();
