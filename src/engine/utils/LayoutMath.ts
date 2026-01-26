/**
 * @file LayoutMath.ts
 * @description Pure functions for layout and positioning calculations.
 * Ensures that decision making is decoupled from the Figma imperative shell.
 */

export interface Point {
    x: number;
    y: number;
}

export interface Dimensions {
    width: number;
    height: number;
}

export interface Bounds extends Point, Dimensions {}

export class LayoutMath {
    /**
     * Pure function: Calculate centered position within a parent
     */
    public static centerInParent(parent: Dimensions, child: Dimensions): Point {
        return {
            x: (parent.width - child.width) / 2,
            y: (parent.height - child.height) / 2
        };
    }

    /**
     * Pure function: Calculate centered position in a coordinate system
     */
    public static centerAtTarget(target: Point, child: Dimensions): Point {
        return {
            x: target.x - (child.width / 2),
            y: target.y - (child.height / 2)
        };
    }

    /**
     * Pure function: Determine the absolute position for a new node
     */
    public static resolveRootPosition(
        strategy: 'VIEWPORT' | 'PARENT_CENTER' | 'MANUAL',
        context: {
            viewportCenter?: Point;
            parentBounds?: Dimensions;
            manualPosition?: Point;
            nodeDimensions: Dimensions;
        }
    ): Point {
        const { viewportCenter, parentBounds, manualPosition, nodeDimensions } = context;

        switch (strategy) {
            case 'PARENT_CENTER':
                if (parentBounds) {
                    return this.centerInParent(parentBounds, nodeDimensions);
                }
                // Fallback to manual or viewport if parent missing
                return manualPosition || viewportCenter || { x: 0, y: 0 };
            
            case 'MANUAL':
                return manualPosition || viewportCenter || { x: 0, y: 0 };

            case 'VIEWPORT':
            default:
                if (viewportCenter) {
                    return this.centerAtTarget(viewportCenter, nodeDimensions);
                }
                return { x: 0, y: 0 };
        }
    }
}
