
import { ComponentSchema } from './types';

/**
 * Structural Anatomy Registry
 * Maps Knowledge Hub pattern names/types to structural JSON blueprints.
 * 
 * Note: defaultProps use hardcoded values (not token references) for stability.
 * Runtime values are applied during rendering in the respective renderers.
 */
export const ANATOMY_REGISTRY: Record<string, Partial<ComponentSchema>> = {
    // --- Charts ---
    'line chart': {
        name: 'Line Chart',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['chart-header', 'chart-canvas', 'chart-legend'] },
        defaultProps: { padding: 16, gap: 12 }
    },
    'bar chart': {
        name: 'Bar Chart',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['chart-header', 'chart-canvas', 'chart-legend'] },
        defaultProps: { padding: 16, gap: 12 }
    },
    'pie chart': {
        name: 'Pie Chart',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['chart-canvas-round', 'chart-legend-vertical'] },
        defaultProps: { padding: 24, gap: 20 }
    },

    // --- Landing Page Sections ---
    'hero section': {
        name: 'Hero Section',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['hero-content', 'hero-visual'] },
        defaultProps: { padding: [80, 40], primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', gap: 40 }
    },
    'feature grid': {
        name: 'Feature Grid',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['section-header', 'features-container'] },
        defaultProps: { padding: [60, 40], gap: 32 }
    },
    'pricing table': {
        name: 'Pricing Table',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['pricing-card-basic', 'pricing-card-pro', 'pricing-card-enterprise'] },
        defaultProps: { padding: [60, 40], gap: 24, primaryAxisAlignItems: 'CENTER' }
    },

    // --- Core UI Components ---
    'button': {
        name: 'Button',
        category: 'Inputs',
        description: 'Interactive element for actions',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['icon?', 'label', 'icon?'] },
        defaultProps: {
            layoutSizingHorizontal: 'HUG',
            layoutSizingVertical: 'HUG',
            primaryAxisAlignItems: 'CENTER',
            counterAxisAlignItems: 'CENTER',
            gap: 8,
            semantic: 'BUTTON'
        },
        variants: {
            default: { padding: [8, 16] },
            icon: { padding: 0 }
        }
    },
    'input': {
        name: 'Input Field',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['input-label', 'input-container'] },
        defaultProps: { gap: 4, layoutSizingHorizontal: 'FILL', semantic: 'TEXT_FIELD' }
    },
    'card': {
        name: 'Card',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['card-header', 'card-content', 'card-footer'] },
        defaultProps: { padding: 16, gap: 16, semantic: 'CARD' }
    },

    // --- Forms & Containers (P1 新增) ---
    'form': {
        name: 'Form',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['form-fields', 'form-actions'] },
        defaultProps: { gap: 16, layoutSizingHorizontal: 'FILL', semantic: 'FORM' }
    },
    'form-field': {
        name: 'Form Field',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['field-label', 'field-input', 'field-helper'] },
        defaultProps: { gap: 4, layoutSizingHorizontal: 'FILL' }
    },

    // --- Navigation (P1 新增) ---
    'nav_bar': {
        name: 'Navigation Bar',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['nav-logo', 'nav-links', 'nav-actions'] },
        defaultProps: { padding: [12, 24], gap: 16, primaryAxisAlignItems: 'SPACE_BETWEEN', counterAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL', semantic: 'NAV_BAR' }
    },
    'sidebar': {
        name: 'Sidebar',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['sidebar-header', 'sidebar-nav', 'sidebar-footer'] },
        defaultProps: { padding: 16, gap: 8, width: 256, layoutSizingVertical: 'FILL', semantic: 'SIDEBAR' }
    },
    'tabs': {
        name: 'Tabs',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['tab-list', 'tab-content'] },
        defaultProps: { gap: 0, layoutSizingHorizontal: 'FILL', semantic: 'TABS' }
    },
    'tab-list': {
        name: 'Tab List',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: [] },
        defaultProps: { gap: 0, layoutSizingHorizontal: 'FILL', strokeWeight: 1 }
    },

    // --- Overlays (P1 新增) ---
    'modal': {
        name: 'Modal',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['modal-header', 'modal-content', 'modal-footer'] },
        defaultProps: { padding: 24, gap: 16, width: 480, semantic: 'MODAL' }
    },
    'dialog': {
        name: 'Dialog',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['dialog-icon', 'dialog-title', 'dialog-message', 'dialog-actions'] },
        defaultProps: { padding: 24, gap: 16, width: 320, primaryAxisAlignItems: 'CENTER', semantic: 'DIALOG' }
    },
    'toast': {
        name: 'Toast',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['toast-icon', 'toast-content', 'toast-close'] },
        defaultProps: { padding: 16, gap: 12, strokeWeight: 1, counterAxisAlignItems: 'CENTER', semantic: 'TOAST' }
    },
    'dropdown': {
        name: 'Dropdown Menu',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['dropdown-items'] },
        defaultProps: { padding: 4, gap: 2, strokeWeight: 1, width: 200, semantic: 'DROPDOWN' }
    },

    // --- Atomic Components (P1 新增) ---
    'avatar': {
        name: 'Avatar',
        structure: { type: 'FRAME', layoutMode: 'NONE', children: ['avatar-image'] },
        defaultProps: { width: 40, height: 40, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', semantic: 'AVATAR' }
    },
    'badge': {
        name: 'Badge',
        category: 'Data Display',
        description: 'A small tag for status, labels, or counts',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['badge-label'] },
        defaultProps: {
            layoutSizingHorizontal: 'HUG',
            layoutSizingVertical: 'HUG',
            primaryAxisAlignItems: 'CENTER',
            counterAxisAlignItems: 'CENTER',
            padding: [2, 10],
            gap: 4,
            fontSize: 12,
            fontWeight: 'SemiBold',
            semantic: 'BADGE'
        },
        variants: {
            default: { stroke: null },
            secondary: { stroke: null },
            outline: { strokeWeight: 1 },
            destructive: { stroke: null }
        }
    },
    'divider': {
        name: 'Divider',
        structure: { type: 'FRAME', layoutMode: 'NONE', children: [] },
        defaultProps: { height: 1, layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', semantic: 'DIVIDER' }
    },
    'switch': {
        name: 'Switch',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['switch-thumb'] },
        defaultProps: { width: 36, height: 20, padding: 2, layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', semantic: 'SWITCH' }
    },
    'checkbox': {
        name: 'Checkbox',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['checkbox-box', 'checkbox-label'] },
        defaultProps: { gap: 8, counterAxisAlignItems: 'CENTER', semantic: 'CHECKBOX' }
    },
    'radio': {
        name: 'Radio',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['radio-circle', 'radio-label'] },
        defaultProps: { gap: 8, counterAxisAlignItems: 'CENTER', semantic: 'RADIO' }
    },

    // --- List & Table (P1 新增) ---
    'list': {
        name: 'List',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: [] },
        defaultProps: { gap: 0, layoutSizingHorizontal: 'FILL', semantic: 'LIST' }
    },
    'list-item': {
        name: 'List Item',
        structure: { type: 'FRAME', layoutMode: 'HORIZONTAL', children: ['item-icon', 'item-content', 'item-action'] },
        defaultProps: { padding: [12, 16], gap: 12, counterAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL', semantic: 'LIST_ITEM' }
    },
    'table': {
        name: 'Table',
        structure: { type: 'FRAME', layoutMode: 'VERTICAL', children: ['table-header', 'table-body'] },
        defaultProps: { gap: 0, layoutSizingHorizontal: 'FILL', semantic: 'TABLE' }
    }
};

