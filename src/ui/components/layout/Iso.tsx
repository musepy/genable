/**
 * @file Iso.tsx
 * @description Isolation wrapper - creates CSS containment boundary to prevent style leakage.
 * Following 隔离式UI开发工作流: The "bathroom stall" that isolates complex features.
 * 
 * Use this to wrap:
 * - Complex feature components (ThinkingCard, MessageBubble)
 * - Components with internal animations
 * - Components that should not affect siblings' layout
 */

import { h, ComponentChildren } from 'preact';

interface IsoProps {
  children: ComponentChildren;
  style?: Record<string, string | number>;
  className?: string;
  /** Enable size containment - requires explicit width/height */
  size?: boolean;
  /** Enable paint containment - prevents cross-repaint */
  paint?: boolean;
  /** Create stacking context for z-index isolation */
  isolate?: boolean;
}

/**
 * Iso - Isolation wrapper for style containment.
 * 
 * Uses CSS `contain` property to create layout boundaries:
 * - `layout`: Internal layout changes don't affect external elements
 * - `style`: Counter resets and other style effects are scoped
 * - `paint` (optional): Internal repaints don't trigger external repaints
 * - `size` (optional): Size doesn't depend on children (needs explicit dimensions)
 * 
 * Also supports `isolation: isolate` to create a stacking context for z-index scoping.
 * 
 * @example
 * // Basic isolation - prevent layout leakage
 * <Iso>
 *   <ThinkingCard />
 * </Iso>
 * 
 * @example
 * // Full isolation with z-index scoping
 * <Iso isolate paint>
 *   <MessageBubble />
 * </Iso>
 */
export function Iso({
  children,
  style,
  className,
  size = false,
  paint = false,
  isolate = false,
}: IsoProps) {
  // Build contain value dynamically
  const containParts: string[] = ['layout', 'style'];
  if (paint) containParts.push('paint');
  if (size) containParts.push('size');

  const isoStyle = {
    contain: containParts.join(' '),
    ...(isolate && { isolation: 'isolate' as const }),
    ...style,
  };

  return (
    <div className={className} style={isoStyle}>
      {children}
    </div>
  );
}
