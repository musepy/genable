/**
 * @file types.ts
 * @description Core types for the Component Knowledge Base
 */

export interface ComponentStructure {
    type: 'FRAME' | 'TEXT' | 'INSTANCE' | 'GROUP';
    layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
    children?: string[]; // Simplified representation of children, e.g., ["icon?", "label"]
}

export interface ComponentSchema {
    name: string;      // e.g., "Button"
    category: string;  // e.g., "Inputs", "Display"
    description?: string; // Brief description for LLM

    // Anatomy: The high-level node structure
    structure: ComponentStructure;

    // Variants: Map user words (keys) to technical props (values)
    // e.g., "solid": { fills: ["$primary"], color: "white" }
    variants: Record<string, Record<string, any>>;

    // Defaults: Base properties applied to the component
    defaultProps: {
        cornerRadius?: number;
        padding?: number | [number, number] | [number, number, number, number]; // [vertical, horizontal] or [top, right, bottom, left]
        gap?: number;
        fills?: string[];
        stroke?: string;
        strokeWeight?: number;
        layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
        layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
        primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
        counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
        [key: string]: any;
    };
}

export type LibraryPreset = Record<string, ComponentSchema>;
