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
    private failureCooldownUntil: Map<string, number> = new Map();
    private failureLogCooldownUntil: Map<string, number> = new Map();
    private readonly FAILURE_COOLDOWN_MS = 30_000;

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

    public async getOrLoad(family: string, style: string): Promise<{ success: boolean; loadedStyle: string }> {
        const normalizedStyle = this.normalizeStyle(style);
        const key = this.getFontKey(family, normalizedStyle);
        
        if (this.loadedFonts.has(key)) return { success: true, loadedStyle: normalizedStyle };
        
        if (this.isInFailureCooldown(key)) {
            const regularKey = this.getFontKey(family, 'Regular');
            if (this.loadedFonts.has(regularKey)) {
                return { success: true, loadedStyle: 'Regular' };
            }
            return { success: false, loadedStyle: normalizedStyle };
        }

        // If currently loading, wait for it
        if (this.loadingQueues.has(key)) {
            await this.loadingQueues.get(key);
            if (this.loadedFonts.has(key)) {
                return { success: true, loadedStyle: normalizedStyle };
            }
            const regularKey = this.getFontKey(family, 'Regular');
            if (this.loadedFonts.has(regularKey)) {
                return { success: true, loadedStyle: 'Regular' };
            }
            return { success: false, loadedStyle: normalizedStyle };
        }

        // Trigger dynamic on-demand load
        await this.loadFontAsync({ family, style: normalizedStyle });
        
        if (this.loadedFonts.has(key)) {
            return { success: true, loadedStyle: normalizedStyle };
        }
        
        const regularKey = this.getFontKey(family, 'Regular');
        if (this.loadedFonts.has(regularKey)) {
            return { success: true, loadedStyle: 'Regular' };
        }
        
        return { success: false, loadedStyle: normalizedStyle };
    }

    /**
     * Normalize font weight to a Figma style name.
     * Handles: numeric (400→Regular), string aliases (semibold→Semi Bold).
     */
    public normalizeWeight(weight: any): string {
        if (weight === null || weight === undefined) return 'Regular';

        // Handle numeric weights (e.g. 400 -> Regular, 700 -> Bold)
        if (typeof weight === 'number') {
            if (weight <= 100) return 'Thin';
            if (weight <= 200) return 'Extra Light';
            if (weight <= 300) return 'Light';
            if (weight <= 400) return 'Regular';
            if (weight <= 500) return 'Medium';
            if (weight <= 600) return 'Semi Bold';
            if (weight <= 700) return 'Bold';
            if (weight <= 800) return 'Extra Bold';
            return 'Black';
        }

        // Safe casting to string before manipulation
        const styleStr = String(weight);
        const s = styleStr.toLowerCase().replace(/[^a-z]/g, '');

        const WEIGHT_MAP: Record<string, string> = {
            thin: 'Thin', extralight: 'Extra Light', light: 'Light',
            regular: 'Regular', normal: 'Regular', medium: 'Medium',
            semibold: 'Semi Bold', demibold: 'Semi Bold',
            bold: 'Bold', extrabold: 'Extra Bold', black: 'Black',
        };

        return WEIGHT_MAP[s] ?? styleStr;
    }

    /**
     * Build the full Figma style string from weight + italic flag.
     * e.g., ('Bold', true) → 'Bold Italic', ('Regular', true) → 'Italic'
     */
    public buildStyleString(weight: string, italic: boolean): string {
        if (!italic) return weight;
        if (weight === 'Regular') return 'Italic';
        return `${weight} Italic`;
    }

    /**
     * Normalize font style names for common Figma variations
     * @deprecated Use normalizeWeight + buildStyleString for new code
     */
    private normalizeStyle(style: any): string {
        if (style === null || style === undefined) return 'Regular';

        // Handle numeric weights (e.g. 400 -> Regular, 700 -> Bold)
        if (typeof style === 'number') {
            return this.normalizeWeight(style);
        }

        // Safe casting to string before manipulation
        const styleStr = String(style);
        const s = styleStr.toLowerCase().replace(/[^a-z]/g, '');

        // Check if it contains "italic" — split into weight + italic
        if (s.includes('italic')) {
            const weightPart = s.replace('italic', '').trim();
            const weight = weightPart ? this.normalizeWeight(weightPart) : 'Regular';
            return this.buildStyleString(weight, true);
        }

        return this.normalizeWeight(style);
    }

    /**
     * Check if a font is currently available
     */
    public isLoaded(family: string, style: string): boolean {
        return this.loadedFonts.has(this.getFontKey(family, style));
    }

    /**
     * Basic health summary for diagnostics.
     */
    public getHealth(): { degraded: boolean; loadedCount: number; failedCount: number } {
        return {
            degraded: this.failureCooldownUntil.size > 0,
            loadedCount: this.loadedFonts.size,
            failedCount: this.failureCooldownUntil.size,
        };
    }

    /**
     * Private: Actual Figma API call with queue management
     */
    private async loadFontAsync(font: FontRecord): Promise<void> {
        const key = this.getFontKey(font.family, font.style);
        if (this.loadedFonts.has(key)) return;
        if (this.isInFailureCooldown(key)) return;

        const loadPromise = (async () => {
            try {
                await figma.loadFontAsync(font);
                this.loadedFonts.add(key);
                this.failureCooldownUntil.delete(key);
            } catch (e) {
                this.markFailure(key, e);
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

    private isInFailureCooldown(key: string): boolean {
        const until = this.failureCooldownUntil.get(key);
        if (!until) return false;
        if (Date.now() < until) return true;
        this.failureCooldownUntil.delete(key);
        return false;
    }

    private markFailure(key: string, error: unknown): void {
        const now = Date.now();
        this.failureCooldownUntil.set(key, now + this.FAILURE_COOLDOWN_MS);
        const logCooldown = this.failureLogCooldownUntil.get(key) ?? 0;
        if (now >= logCooldown) {
            this.failureLogCooldownUntil.set(key, now + this.FAILURE_COOLDOWN_MS);
            console.warn(`[FontBus] Failed to load font: ${key}`, error);
        }
    }
}

export const fontBus = FontBus.getInstance();
