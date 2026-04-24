/**
 * @file ContextTag.tsx
 * @description Context tag pill for skill/selection/page attachments in the prompt input.
 *
 * v5 design (see tools/ui-preview/selection-chip-ab.html):
 * - Unified 14px icons from @create-figma-plugin/ui (Figma-native, via NodeTypeIcon)
 * - X button absolute-positioned at right (chip width fixed, no hover expand)
 * - Concentric radius: chip 6px outer, X 3px inner
 * - Two variants: 'default' (gray) and 'component' (purple) — used for COMPONENT/INSTANCE
 * - Optional onClick for canvas jump (scrollAndZoomIntoView on main thread)
 */

import { h, ComponentChildren } from 'preact';
import { useState, useRef, useCallback } from 'preact/hooks';
import { tokens } from '../design-system/tokens';
import { CloseIcon, ICON_SIZE } from './NodeTypeIcon';

export type ContextTagVariant = 'default' | 'component';

export interface ContextTagProps {
  /** Left-side icon (14px) — typically a NodeTypeIcon / SkillIcon */
  icon?: ComponentChildren;
  /** Label text; truncates with ellipsis past ~80px */
  label: string;
  /** Full name shown on hover when label is truncated; defaults to label.
   *  If explicitly provided and differs from label, always shows on hover (e.g. +N aggregated chips). */
  title?: string;
  /** Variant affects color system (component = purple) */
  variant?: ContextTagVariant;
  /** Click handler for the chip body (e.g. canvas jump for node chips) */
  onClick?: () => void;
  /** Remove handler — always renders an X button when provided */
  onRemove?: () => void;
}

const X_SLOT = ICON_SIZE; // 14
const X_OFFSET = 3;       // distance from chip right edge → concentric radius = 6 - 3 = 3
const PAD_Y = 3;
const PAD_L = 8;
const PAD_R = X_SLOT + X_OFFSET + 4; // icon + offset + 4px gutter from label

const TOOLTIP_DELAY_MS = 200;
const TOOLTIP_BG = '#1a1a1a';

export function ContextTag({
  icon,
  label,
  title,
  variant = 'default',
  onClick,
  onRemove,
}: ContextTagProps) {
  const isComponent = variant === 'component';

  const color = isComponent ? 'var(--component-fg, #7c3aed)' : 'var(--gray-a11)';
  const bg = isComponent ? 'var(--component-bg, rgba(151,71,255,0.08))' : 'var(--panel-translucent)';
  const border = isComponent ? 'var(--component-border, rgba(151,71,255,0.22))' : 'var(--gray-a4)';
  const borderHover = isComponent ? 'var(--component-hover, rgba(151,71,255,0.40))' : 'var(--gray-a7)';
  const removeBgHover = isComponent ? 'var(--component-border, rgba(151,71,255,0.22))' : 'var(--gray-a6, rgba(0,0,0,0.14))';

  // --- Tooltip state ---
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The text to show in the tooltip.
  // If caller passed a title that differs from label, always use it (e.g. "+3" chip).
  // Otherwise fall back to label (shown only when truncated).
  const tooltipText = title ?? label;
  const alwaysShow = title !== undefined && title !== label;

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(() => {
      // Check if label is truncated (scrollWidth > clientWidth).
      const span = labelRef.current;
      const isTruncated = span ? span.scrollWidth > span.clientWidth : false;

      if (alwaysShow || isTruncated) {
        setTooltipVisible(true);
      }
    }, TOOLTIP_DELAY_MS);
  }, [alwaysShow]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setTooltipVisible(false);
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: `${PAD_Y}px ${PAD_R}px ${PAD_Y}px ${PAD_L}px`,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radius-3)', // 6px — chip outer
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 120ms, background 120ms',
        color,
        // Entrance — plays once on first mount (chips are keyed by node.id)
        animation: 'chip-enter 180ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = borderHover;
        handleMouseEnter();
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = border;
        handleMouseLeave();
      }}
    >
      {icon && (
        <span
          style={{
            display: 'flex',
            flexShrink: 0,
            width: ICON_SIZE,
            height: ICON_SIZE,
            alignItems: 'center',
            justifyContent: 'center',
            color,
          }}
        >
          {icon}
        </span>
      )}
      <span
        ref={labelRef}
        style={{
          fontSize: tokens.fontSize[1],
          fontWeight: tokens.fontWeight.medium,
          lineHeight: '16px',
          color,
          maxWidth: 80,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // don't trigger chip's onClick
            onRemove();
          }}
          style={{
            position: 'absolute',
            top: '50%',
            right: X_OFFSET,
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: X_SLOT,
            height: X_SLOT,
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color,
            borderRadius: 3, // concentric with chip 6px
            transition: 'background 120ms',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = removeBgHover)}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          aria-label={`Remove ${label}`}
        >
          <CloseIcon />
        </button>
      )}

      {/* Custom tooltip bubble — replaces native title attribute */}
      {tooltipVisible && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: tooltipVisible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(2px)',
            background: TOOLTIP_BG,
            color: '#fff',
            padding: '5px 9px',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
            zIndex: 20,
            pointerEvents: 'none',
            opacity: 1,
            transition: 'opacity 120ms ease, transform 120ms ease',
            // Ensure the tooltip text uses the default chip body font (not inherited color from chip)
            lineHeight: '1.4',
          }}
        >
          {tooltipText}
          {/* Downward-pointing triangle arrow */}
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              border: '4px solid transparent',
              borderTopColor: TOOLTIP_BG,
              display: 'block',
            }}
          />
        </div>
      )}
    </div>
  );
}
