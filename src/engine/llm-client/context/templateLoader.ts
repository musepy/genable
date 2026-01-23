/**
 * @file templateLoader.ts
 * @description Handlebars template loader for prompt assets
 */

import Handlebars from 'handlebars';
import { NODE_TYPES, PROPS } from '../../../constants/figma-api';

// Pre-register common helpers and partials
const hbs = Handlebars.create();

// Register constants as helpers for easy access in templates
hbs.registerHelper('NODE_TYPES', () => NODE_TYPES);
hbs.registerHelper('PROPS', () => PROPS);

// Register individual prop helpers for inline use
Object.entries(PROPS).forEach(([key, value]) => {
    hbs.registerHelper(`PROPS_${key}`, () => value);
});

Object.entries(NODE_TYPES).forEach(([key, value]) => {
    hbs.registerHelper(`NODE_${key}`, () => value);
});

/**
 * Compile and render a Handlebars template string
 */
export function renderTemplate(templateSource: string, context: Record<string, any> = {}): string {
    const template = hbs.compile(templateSource);
    return template(context);
}

/**
 * Get the Handlebars instance for advanced usage
 */
export function getHandlebars(): typeof Handlebars {
    return hbs;
}
