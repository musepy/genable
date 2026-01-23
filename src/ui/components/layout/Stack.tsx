/**
 * @file Stack.tsx
 * @description Vertical layout primitive - pure "glue" component with NO contain isolation.
 * Following 隔离式UI开发工作流: Layout components control spacing, content components control content.
 */

import { h, ComponentChildren } from 'preact';
import { tokens } from '../../design-system/tokens';

export type StackGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'stack';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

interface StackProps {
  gap?: StackGap;
  align?: StackAlign;
  children: ComponentChildren;
  style?: Record<string, string | number>;
  className?: string;
}

const gapToValue: Record<StackGap, number> = {
  none: tokens.space.none,
  xs: tokens.space.xs,
  sm: tokens.space.sm,
  md: tokens.space.md,
  lg: tokens.space.lg,
  xl: tokens.space.xl,
  '2xl': tokens.space['2xl'],
  stack: tokens.space.stack,
};

const alignToValue: Record<StackAlign, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

/**
 * Stack - Vertical flex layout with token-based gap control.
 * 
 * **Key constraint**: NO `contain: layout` - this is a pure layout primitive
 * that allows sticky positioning and z-index to work correctly.
 * 
 * @example
 * <Stack gap="md">
 *   <Header />
 *   <Content />
 *   <Footer />
 * </Stack>
 */
export function Stack({
  gap = 'none',
  align = 'stretch',
  children,
  style,
  className,
}: StackProps) {
  const stackStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: gapToValue[gap],
    alignItems: alignToValue[align],
    // NO contain property - intentionally omitted for layout hierarchy
    ...style,
  };

  return (
    <div className={className} style={stackStyle}>
      {children}
    </div>
  );
}
