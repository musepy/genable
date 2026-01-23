import { ComponentSchema, LibraryPreset } from '../types';

/**
 * @deprecated SHADCN_PRESET has been unified into ANATOMY_REGISTRY.
 * Use ANATOMY_REGISTRY['button'] and ANATOMY_REGISTRY['badge'] instead.
 * This file is retained for backward compatibility but should not be used for new code.
 * See: knowledge_unification_plan.md
 */
export const SHADCN_PRESET: LibraryPreset = {
    Badge: {
        name: 'Badge',
        category: 'Data Display',
        description: 'A small tag for status, labels, or counts',
        structure: {
            type: 'FRAME',
            layoutMode: 'HORIZONTAL',
            children: ['label']
        },
        defaultProps: {
            layoutSizingHorizontal: 'HUG',
            layoutSizingVertical: 'HUG',
            primaryAxisAlignItems: 'CENTER',
            counterAxisAlignItems: 'CENTER',
            padding: [2, 10], // py-0.5 px-2.5 -> ~2px 10px
            gap: 4,
            cornerRadius: 99, // Pill shape
            strokeWeight: 0,

            // Text defaults
            fontSize: 12,
            fontWeight: 'SemiBold'
        },
        variants: {
            default: { // Primary
                fills: ['solid'], 
                color: 'solid-foreground', 
                stroke: null
            },
            secondary: {
                fills: ['muted'], 
                color: 'foreground', 
                stroke: null
            },
            outline: {
                fills: ['background'],
                color: 'foreground',
                stroke: 'border', 
                strokeWeight: 1
            },
            destructive: {
                fills: ['destructive'], 
                color: 'solid-foreground',
                stroke: null
            }
        }
    },

    Button: {
        name: 'Button',
        category: 'Inputs',
        description: 'Interactive element for actions',
        structure: {
            type: 'FRAME',
            layoutMode: 'HORIZONTAL',
            children: ['icon?', 'label', 'icon?']
        },
        defaultProps: {
            layoutSizingHorizontal: 'HUG',
            layoutSizingVertical: 'HUG',
            primaryAxisAlignItems: 'CENTER',
            counterAxisAlignItems: 'CENTER',
            gap: 8,
            cornerRadius: 6, // radius-md
            strokeWeight: 0,

            // Text defaults
            fontSize: 14,
            fontWeight: 'Medium'
        },
        variants: {
            default: {
                fills: ['solid'], 
                color: 'solid-foreground',
                padding: [8, 16],   
                height: 40
            },
            secondary: {
                fills: ['muted'], 
                color: 'foreground',
                padding: [8, 16],
                height: 40
            },
            ghost: {
                fills: ['transparent'],
                color: 'foreground',
                padding: [8, 16],
                height: 40
            },
            link: {
                fills: ['transparent'],
                color: 'primary', 
                padding: [0, 0],
                height: 'auto',
                textDecoration: 'UNDERLINE'
            },
            destructive: {
                fills: ['destructive'],
                color: 'solid-foreground',
                padding: [8, 16],
                height: 40
            },
            outline: {
                fills: ['background'],
                color: 'foreground',
                stroke: 'border', 
                strokeWeight: 1,
                padding: [8, 16],
                height: 40
            },
            // Sizes
            sm: {
                height: 36,
                padding: [0, 12], // h-9 px-3
                fontSize: 12
            },
            lg: {
                height: 44,
                padding: [0, 32], // h-11 px-8
                fontSize: 16
            },
            icon: {
                height: 40,
                width: 40,
                padding: 0
            }
        }
    }
};
