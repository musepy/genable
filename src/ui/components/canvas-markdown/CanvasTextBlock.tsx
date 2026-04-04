/**
 * @file CanvasTextBlock.tsx
 * @description Canvas-based markdown text block for the chat stream.
 *
 * Replaces DOM-based react-markdown rendering with canvas fillText.
 * Supports: heading hierarchy, lists, code blocks, inline formatting,
 * clickable node links, streaming, and fold/expand.
 */

import { h, Fragment, createRef } from 'preact';
import { createPortal } from 'preact/compat';
import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import { emit } from '@create-figma-plugin/utilities';
import { tokens } from '../../design-system/tokens';
import {
  layout,
  render,
  hitTest,
  resolveThemeColors,
  type LayoutResult,
  type LinkRegion,
} from './engine';

// ============================================
// Constants
// ============================================

const CLAMP_LINES = 6;
const LINE_HEIGHT = 18;
const FOLD_HEIGHT = CLAMP_LINES * LINE_HEIGHT + 8;

// ============================================
// Component
// ============================================

interface CanvasTextBlockProps {
  content: string;
  streaming?: boolean;
}

export function CanvasTextBlock({ content, streaming }: CanvasTextBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<LayoutResult | null>(null);
  const colorsRef = useRef<ReturnType<typeof resolveThemeColors> | null>(null);

  const [folded, setFolded] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const [themeKey, setThemeKey] = useState(0); // bumped on theme change to trigger re-render

  // Watch for theme changes (Figma toggles class/attributes on root element)
  useEffect(() => {
    const target = document.documentElement;
    const observer = new MutationObserver(() => {
      colorsRef.current = null; // invalidate cached colors
      setThemeKey(k => k + 1);  // force re-render
    });
    observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
    return () => observer.disconnect();
  }, []);

  // Layout + render
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    if (width <= 0) return;

    // Resolve colors
    const colors = resolveThemeColors(container);
    colorsRef.current = colors;

    // Get a context for measurement + rendering
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Layout
    const result = layout(ctx, content, width, colors);
    layoutRef.current = result;

    // Determine if fold is needed (only after streaming finishes)
    const needsFold = !streaming && result.height > FOLD_HEIGHT;
    setFolded(needsFold);

    // Streaming: render at full height (grows as tokens arrive)
    // Folded: cap at FOLD_HEIGHT
    const displayHeight = needsFold ? FOLD_HEIGHT : result.height;
    setCanvasHeight(displayHeight);

    // Size canvas (DPR-aware)
    canvas.width = width * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${displayHeight}px`;

    // Render
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, displayHeight);
    render(ctx, result, colors);

    // Fade out at bottom when folded only — not during streaming
    if (needsFold) {
      const fadeH = 32;
      const fadeY = displayHeight - fadeH;
      // Resolve background color via temp element — standard property resolution
      // works reliably even in Figma iframe where getPropertyValue for custom
      // properties returns empty strings.
      const bgRgb = (() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--gray-1)';
        container.appendChild(probe);
        const resolved = getComputedStyle(probe).backgroundColor;
        container.removeChild(probe);
        const m = resolved.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
        return { r: 252, g: 252, b: 252 };
      })();
      const grad = ctx.createLinearGradient(0, fadeY, 0, displayHeight);
      grad.addColorStop(0, `rgba(${bgRgb.r},${bgRgb.g},${bgRgb.b},0)`);
      grad.addColorStop(0.6, `rgba(${bgRgb.r},${bgRgb.g},${bgRgb.b},0.85)`);
      grad.addColorStop(1, `rgba(${bgRgb.r},${bgRgb.g},${bgRgb.b},1)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, fadeY, width, fadeH);
    }
  }, [content, streaming, themeKey]);

  // Mouse move — cursor change on link hover
  const onMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTest(result, x, y);
    canvas.style.cursor = hit ? 'pointer' : folded ? 'pointer' : 'default';
  }, [folded]);

  // Click — link navigation or fold expand
  const onClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTest(result, x, y);
    if (hit) {
      e.stopPropagation();
      if (hit.nodeId) {
        emit('SELECT_NODE', { nodeId: hit.nodeId });
      } else if (hit.href) {
        window.open(hit.href, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    // If folded and no link hit, open full card
    if (folded) {
      setCardOpen(true);
    }
  }, [folded]);

  return (
    <Fragment>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          padding: '0',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: folded ? 'pointer' : 'default',
          borderRadius: folded ? 'var(--radius-3)' : undefined,
          transition: 'background 120ms',
          marginBottom: folded ? tokens.space[1] : undefined,
        }}
        onMouseEnter={folded ? (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' } : undefined}
        onMouseLeave={folded ? (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = '' } : undefined}
        onClick={folded ? () => setCardOpen(true) : undefined}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={onMouseMove}
          onClick={onClick}
          style={{
            display: 'block',
            width: '100%',
          }}
        />
        {folded && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 20,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              fontSize: 10,
              color: tokens.colors.textSecondary,
              paddingBottom: 2,
              pointerEvents: 'none',
            }}
          >
            click to expand
          </div>
        )}
      </div>

      {cardOpen && createPortal(
        <FloatingCanvasCard content={content} onClose={() => setCardOpen(false)} />,
        document.body,
      )}
    </Fragment>
  );
}

// ============================================
// FloatingCanvasCard — full content overlay (also canvas)
// ============================================

function FloatingCanvasCard({ content, onClose }: { content: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<LayoutResult | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Animate in
    requestAnimationFrame(() => {
      container.style.opacity = '1';
      container.style.transform = 'translateY(0)';
    });

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const colors = resolveThemeColors(container);
    const ctx = canvas.getContext('2d');
    if (!ctx || width <= 0) return;

    const result = layout(ctx, content, width, colors);
    layoutRef.current = result;

    canvas.width = width * dpr;
    canvas.height = result.height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${result.height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, result.height);
    render(ctx, result, colors);
  }, [content]);

  const onCanvasClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTest(result, x, y);
    if (hit) {
      e.stopPropagation();
      if (hit.nodeId) {
        emit('SELECT_NODE', { nodeId: hit.nodeId });
      } else if (hit.href) {
        window.open(hit.href, '_blank', 'noopener,noreferrer');
      }
    }
  }, []);

  const onCanvasMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(result, e.clientX - rect.left, e.clientY - rect.top);
    canvas.style.cursor = hit ? 'pointer' : 'default';
  }, []);

  const close = () => {
    const el = containerRef.current;
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(onClose, 120);
    } else {
      onClose();
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={close}
      style={{
        position: 'fixed',
        top: 'var(--header-height)', left: 0, right: 0, bottom: 0,
        zIndex: 100,
        background: 'var(--color-background)',
        borderTop: `1px solid ${tokens.colors.surfaceHover}`,
        boxShadow: '0 -1px 8px rgba(0,0,0,.08)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        cursor: 'pointer',
        opacity: 0, transform: 'translateY(8px)',
        transition: 'opacity 120ms ease, transform 120ms ease',
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          onMouseMove={onCanvasMove}
          style={{ display: 'block' }}
        />
      </div>
      <div style={{
        flexShrink: 0, padding: '6px 10px', textAlign: 'center',
        fontSize: 10, color: tokens.colors.textSecondary,
        pointerEvents: 'none',
      }}>
        click to close
      </div>
    </div>
  );
}
