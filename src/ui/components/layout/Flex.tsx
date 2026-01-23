/**
 * @file Flex.tsx
 * @description Horizontal layout primitive - pure "glue" component with NO contain isolation.
 * Following 隔离式UI开发工作流: Layout components control spacing, content components control content.
 */

import { h, ComponentChildren, JSX } from 'preact';
import { tokens } from '../../design-system/tokens';

export type FlexGap = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type FlexJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

interface FlexProps {
  gap?: FlexGap;
  align?: FlexAlign;
  justify?: FlexJustify;
  wrap?: boolean;
  inline?: boolean;
  children: ComponentChildren;
  style?: JSX.CSSProperties;
  className?: string;
  onClick?: JSX.MouseEventHandler<HTMLDivElement>;
  onKeyDown?: JSX.KeyboardEventHandler<HTMLDivElement>;
  onMouseEnter?: JSX.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: JSX.MouseEventHandler<HTMLDivElement>;
  role?: JSX.AriaRole;
  tabIndex?: number;
  'aria-expanded'?: boolean;
}

const gapToValue: Record<FlexGap, number> = {
  none: tokens.space.none,
  xs: tokens.space.xs,
  sm: tokens.space.sm,
  md: tokens.space.md,
  lg: tokens.space.lg,
  xl: tokens.space.xl,
  '2xl': tokens.space['2xl'],
};

const alignToValue: Record<FlexAlign, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const justifyToValue: Record<FlexJustify, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

/**
 * Flex - Horizontal flex layout with token-based gap control.
 * 
 * **Key constraint**: NO `contain: layout` - this is a pure layout primitive
 * that allows sticky positioning and z-index to work correctly.
 * 
 * @example
 * <Flex gap="sm" align="center" justify="between">
 *   <Logo />
 *   <Nav />
 *   <Actions />
 * </Flex>
 */
export function Flex({
  gap = 'none',
  align = 'stretch',
  justify = 'start',
  wrap = false,
  inline = false,
  children,
  style,
  className,
  onClick,
  onKeyDown,
  onMouseEnter,
  onMouseLeave,
  role,
  tabIndex,
  'aria-expanded': ariaExpanded,
}: FlexProps) {
  const flexStyle = {
    display: inline ? 'inline-flex' : 'flex',
    flexDirection: 'row' as const,
    gap: gapToValue[gap],
    alignItems: alignToValue[align],
    justifyContent: justifyToValue[justify],
    flexWrap: wrap ? 'wrap' : 'nowrap',
    // NO contain property - intentionally omitted for layout hierarchy
    ...style,
  };

  return (
    <div 
      className={className} 
      style={flexStyle}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role={role}
      tabIndex={tabIndex}
      aria-expanded={ariaExpanded}
    >
      {children}
    </div>
  );
}
