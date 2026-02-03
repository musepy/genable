/**
 * @file design-mapper.ts
 * @description Bridge between Figma Design (Variants/Nodes) and UI Code (Props/Styles)
 */

export interface FigmaVariant {
  [key: string]: string;
}

export interface ComponentMapping {
  props: Record<string, any>;
  classNames: string[];
}

/**
 * Maps Figma variants to component props and semantic class names
 * @param componentName The name of the component (e.g., 'Header', 'Button')
 * @param variants Map of variant properties from Figma
 */
export function mapFigmaToUI(componentName: string, variants: FigmaVariant): ComponentMapping {
  const result: ComponentMapping = {
    props: {},
    classNames: [],
  };

  // 1. Generic Theme Mapping (day -> theme)
  if (variants['day']) {
    result.props['theme'] = variants['day'] === 'true' ? 'light' : 'dark';
  }

  // 2. Component Specific Logic
  switch (componentName) {
    case 'Header':
      processHeader(variants, result);
      break;
    case 'Button':
      processButton(variants, result);
      break;
  }

  return result;
}

function processHeader(variants: FigmaVariant, result: ComponentMapping) {
  // Figma 'day=true' -> HeaderProps.theme='light'
  if (variants['day']) {
    result.classNames.push(`theme-${variants['day'] === 'true' ? 'light' : 'dark'}`);
  }
}

function processButton(variants: FigmaVariant, result: ComponentMapping) {
  // Mapping type: primary, outline, ghost
  if (variants['type']) {
    result.classNames.push(`header-btn-${variants['type']}`);
  }

  // Mapping state: hover, pressed, loading, disable
  if (variants['state']) {
    const state = variants['state'].toLowerCase();
    if (state.includes('hover')) result.classNames.push('is-hover');
    if (state.includes('pressed')) result.classNames.push('is-pressed');
    if (state.includes('disable')) result.classNames.push('is-disabled');
    if (state.includes('loading')) result.classNames.push('is-loading');
  }
}
