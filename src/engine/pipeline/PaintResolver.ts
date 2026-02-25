import { figmaVariableCache } from '../figma-adapter/caches/figmaVariableCache';
import { parseColor } from '../../utils/colorUtils';
import { emit } from '@create-figma-plugin/utilities';
import { SendLogHandler } from '../../types';

/**
 * Strategy-based Paint Resolver
 * Follows the "Stable Physics Engine" philosophy from Apple Animation.
 * Ensures predictable resolution of Variables, Styles, and Literal Colors.
 */
export class PaintResolver {
    /**
     * Resolve a string or gradient object into a Figma Paint object.
     * Supports:
     * 1. Gradient objects ({type: "GRADIENT_LINEAR", stops: [...], angle?: number})
     * 2. Explicit Variables (variable:NAME)
     * 3. Implicit Variable/Style lookup (TOKEN_NAME)
     * 4. Literal Color Fallback (Hex, RGBA)
     */
    public static async resolve(input: any): Promise<Paint | null> {
        if (!input) return null;

        // Handle gradient objects
        if (typeof input === 'object' && input !== null && typeof input.type === 'string' && input.type.startsWith('GRADIENT_')) {
            return this.resolveGradient(input);
        }

        if (typeof input === 'string') {
            const normalized = input.trim().toLowerCase();
            
            // 1. Explicit Variable Binding (variable:mode:name)
            if (normalized.startsWith('variable:')) {
                const varName = input.split(':').slice(1).join(':').trim();
                const foundVar = figmaVariableCache.getVariable(varName);
                if (foundVar && foundVar.resolvedType === 'COLOR') {
                    const paint: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
                    return figma.variables.setBoundVariableForPaint(paint, 'color', foundVar);
                }
                this.logFallback(input, `Variable "${varName}" not found in cache.`);
            }

            // 2. Token/Style Resolution (Implicit)
            const isLiteral = normalized.startsWith('#') || normalized.startsWith('rgba') || normalized.startsWith('rgb');
            if (!isLiteral) {
                // Determine search terms (original, lowercase, and relative paths)
                const searchTerms = [normalized];
                if (input.includes('/')) {
                    searchTerms.push(input.split('/').pop()!.toLowerCase());
                }

                for (const term of searchTerms) {
                    // Check Variables Map
                    const foundVar = figmaVariableCache.getVariable(term);
                    if (foundVar && foundVar.resolvedType === 'COLOR') {
                        const paint: SolidPaint = { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
                        return figma.variables.setBoundVariableForPaint(paint, 'color', foundVar);
                    }

                    // Check Paint Styles
                    const style = figmaVariableCache.getStyle(term);
                    if (style && style.paints.length > 0) return style.paints[0];
                }
                
                if (!normalized.includes(' ')) { 
                     // Only log if it's a single word/path (potential token)
                     this.logFallback(input, `Token/Style "${normalized}" not found.`);
                }
            }
        }

        // 3. Literal Color Fallback
        try {
            const c = parseColor(input);
            return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b }, opacity: c.a };
        } catch (e) {
            return null;
        }
    }

    /**
     * Resolve a gradient object into a Figma GradientPaint.
     * Accepts: { type: "GRADIENT_LINEAR"|"GRADIENT_RADIAL"|..., stops: [{position, color}], angle?: number }
     * Converts angle (degrees) to Figma's gradientTransform matrix.
     */
    private static resolveGradient(input: { type: string; stops?: Array<{ position: number; color: string }>; angle?: number }): Paint | null {
        if (!input.stops || input.stops.length < 2) {
            console.warn(`[PaintResolver] Gradient rejected: need at least 2 stops, got ${input.stops?.length ?? 0}`);
            return null;
        }

        try {
            const gradientStops: ColorStop[] = input.stops.map(stop => {
                const c = parseColor(stop.color);
                return {
                    position: Math.max(0, Math.min(1, stop.position)),
                    color: { r: c.r, g: c.g, b: c.b, a: c.a }
                };
            });

            // Convert angle (degrees) to gradientTransform matrix
            // Figma gradientTransform maps from gradient space [0,1]x[0,1] to node space
            // Default angle 180 = top-to-bottom (common CSS default)
            const angleDeg = input.angle ?? 180;
            const angleRad = angleDeg * (Math.PI / 180);
            const cos = Math.cos(angleRad);
            const sin = Math.sin(angleRad);
            const gradientTransform: Transform = [
                [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
                [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
            ];

            return {
                type: input.type,
                gradientTransform,
                gradientStops
            } as GradientPaint;
        } catch (e) {
            console.warn(`[PaintResolver] Gradient resolution failed:`, e);
            return null;
        }
    }

    /**
     * Log a fallback event to ensure "Perceivable Correction" (Gemini Workflow)
     */
    private static logFallback(input: string, reason: string): void {
        console.warn(`[PaintResolver] Fallback for "${input}": ${reason}`);
        emit<SendLogHandler>('SEND_LOG', { 
            message: `Paint Fallback: "${input}" resolved as literal color. (${reason})`, 
            type: 'info' 
        });
    }
}
