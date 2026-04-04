/**
 * @file CanvasTextBlock.tsx
 * @description Canvas-based markdown text block for the chat stream.
 *
 * Replaces DOM-based react-markdown rendering with canvas fillText.
 * Supports: heading hierarchy, lists, code blocks, inline formatting,
 * clickable node links, streaming, and fold/expand.
 *
 * Key techniques (verified in tools/ui-preview/canvas-textblock.html):
 * - Double-buffer: offscreen canvas → drawImage (no flicker on theme toggle)
 * - destination-out fade: theme-independent, no bg color probe needed
 * - MutationObserver + rAF: re-render on theme change without debounce delay
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
const FADE_H = 28;

// ============================================
// Shared: theme observer hook
// ============================================

function useThemeKey() {
  const [key, setKey] = useState(0);
  useEffect(() => {
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setKey(k => k + 1));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'],
    });
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return key;
}

// ============================================
// Shared: double-buffer render
// ============================================

function doubleBufferRender(
  canvas: HTMLCanvasElement,
  width: number,
  container: HTMLElement,
  content: string,
  opts?: { fold?: boolean },
): LayoutResult | null {
  const dpr = window.devicePixelRatio || 1;
  const colors = resolveThemeColors(container);

  // Offscreen canvas for layout + render
  const off = document.createElement('canvas');
  off.width = width * dpr;
  off.height = 1;
  const octx = off.getContext('2d');
  if (!octx) return null;

  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const result = layout(octx, content, width, colors);

  const h = result.height;
  off.width = width * dpr;
  off.height = h * dpr;
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, width, h);
  render(octx, result, colors);

  // Fold fade via destination-out — theme-independent, no bg probe needed
  if (opts?.fold && h > FOLD_HEIGHT) {
    octx.globalCompositeOperation = 'destination-out';
    const grad = octx.createLinearGradient(0, FOLD_HEIGHT - FADE_H, 0, FOLD_HEIGHT);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    octx.fillStyle = grad;
    octx.fillRect(0, FOLD_HEIGHT - FADE_H, width, FADE_H);
    octx.globalCompositeOperation = 'source-over';
  }

  // Atomic swap — visible canvas is never blank
  canvas.width = width * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(off, 0, 0);

  return result;
}

// ============================================
// CanvasTextBlock
// ============================================

interface CanvasTextBlockProps {
  content: string;
  streaming?: boolean;
}

export function CanvasTextBlock({ content, streaming }: CanvasTextBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<LayoutResult | null>(null);

  const [folded, setFolded] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(0);
  const themeKey = useThemeKey();

  // Layout + render
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = container.clientWidth;
    if (width <= 0) return;

    const needsFold = !streaming;
    const result = doubleBufferRender(canvas, width, container, content, { fold: needsFold });
    if (!result) return;

    layoutRef.current = result;
    const shouldFold = !streaming && result.height > FOLD_HEIGHT;
    setFolded(shouldFold);
    setCanvasHeight(shouldFold ? FOLD_HEIGHT : result.height);
  }, [content, streaming, themeKey]);

  // Mouse move — cursor change on link hover
  const onMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(result, e.clientX - rect.left, e.clientY - rect.top);
    canvas.style.cursor = hit ? 'pointer' : folded ? 'pointer' : 'default';
  }, [folded]);

  // Click — link navigation or fold expand
  const onClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(result, e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      e.stopPropagation();
      if (hit.nodeId) emit('SELECT_NODE', { nodeId: hit.nodeId });
      else if (hit.href) window.open(hit.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (folded) setCardOpen(true);
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
        {/* Clipping wrapper for fold */}
        <div style={{
          overflow: 'hidden',
          height: folded ? FOLD_HEIGHT : undefined,
        }}>
          <canvas
            ref={canvasRef}
            onMouseMove={onMouseMove}
            onClick={onClick}
            style={{ display: 'block', width: '100%' }}
          />
        </div>
        {/* Expand hint below canvas — not overlapping content */}
        {folded && (
          <div style={{
            textAlign: 'center',
            fontSize: 10,
            color: tokens.colors.textSecondary,
            padding: '2px 0',
            pointerEvents: 'none',
          }}>
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
// FloatingCanvasCard
// ============================================

function FloatingCanvasCard({ content, onClose }: { content: string; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<LayoutResult | null>(null);
  const themeKey = useThemeKey();

  // Animate in on mount
  useEffect(() => {
    requestAnimationFrame(() => {
      if (containerRef.current) {
        containerRef.current.style.opacity = '1';
        containerRef.current.style.transform = 'translateY(0)';
      }
    });
  }, []);

  // Render — re-runs on content change AND theme change
  useEffect(() => {
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!scroll || !canvas || !container) return;

    // Subtract padding from clientWidth to get content box width
    const s = getComputedStyle(scroll);
    const width = scroll.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    if (width <= 0) return;

    const result = doubleBufferRender(canvas, width, container, content);
    layoutRef.current = result;
  }, [content, themeKey]);

  const onCanvasClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(result, e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      e.stopPropagation();
      if (hit.nodeId) emit('SELECT_NODE', { nodeId: hit.nodeId });
      else if (hit.href) window.open(hit.href, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const onCanvasMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const result = layoutRef.current;
    if (!canvas || !result) return;
    const rect = canvas.getBoundingClientRect();
    canvas.style.cursor = hitTest(result, e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : 'default';
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

  const pad = tokens.grid.scrollPad;

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
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: `${pad}px` }}>
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          onMouseMove={onCanvasMove}
          style={{ display: 'block' }}
        />
      </div>
      <div style={{
        flexShrink: 0, textAlign: 'center',
        fontSize: 10, color: tokens.colors.textSecondary,
        padding: '6px 10px', pointerEvents: 'none',
      }}>
        click to close
      </div>
    </div>
  );
}
