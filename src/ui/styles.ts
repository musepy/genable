/**
 * @file styles.ts
 * @description Shared style objects for UI components
 * 
 * MIGRATION NOTE: This file has been cleaned up.
 * - Dead code removed (27 unused exports)
 * - All values now use Design Tokens
 * - Follow /quality/migration-strategy for future changes
 */

import { tokens } from './design-system/tokens';

/**
 * Base container style - fill parent height
 * Used in: ui.tsx, SettingsPanel.tsx, ExperimentTab.tsx
 */
export const containerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  background: tokens.colors.background, // Migrated from colors.background
  color: tokens.colors.textPrimary,
  fontFamily: tokens.font.sans,
  fontSize: tokens.fontSize[1], // 12px - Token compliant
  height: '100%',
  boxSizing: 'border-box' as const,
};

/**
 * Header styles
 * Used in: Header.tsx, SettingsPanel.tsx
 */
export const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: tokens.space[2],     // Migrated from space.sm
  padding: tokens.space[4],  // Migrated from space.md
};

/**
 * Card container style
 * Used in: various card components
 */
export const cardStyle = {
  background: tokens.colors.surface, // Migrated from colors.card
  border: `1px solid ${tokens.colors.grayBorder}`,
  borderRadius: 'var(--radius-5)',
  padding: tokens.space[4], // Migrated from space.md
};

/**
 * Primary button style
 * Used in: action buttons
 */
export const btnPrimaryStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: tokens.space[1],  // Migrated from space.xs
  padding: `${tokens.space[2]}px ${tokens.space[4]}px`, // Migrated from sm, md
  fontSize: tokens.fontSize[1], // 12px - Token compliant
  fontWeight: tokens.fontWeight.medium,
  background: tokens.colors.accent,
  color: tokens.colors.accentContrast,
  border: 'none',
  borderRadius: 'var(--radius-4)',
  cursor: 'pointer',
  transition: 'var(--transition-crisp)',
};
