/**
 * @file cssCompiler.ts
 * @description Thin compatibility wrapper — delegates to normalizeProps().
 *
 * The canonical implementation is in src/domain/node-normalizers.ts.
 * This file exists only for backward compatibility with existing imports.
 *
 * @deprecated Import { normalizeProps } from '../../domain/node-normalizers' instead.
 */

import { normalizeProps } from '../../domain/node-normalizers';

/**
 * Compile CSS-semantic properties to Figma-native properties.
 * @deprecated Use normalizeProps() from '../../domain/node-normalizers'.
 */
export const compileCssProps = normalizeProps;
