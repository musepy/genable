/**
 * @file TextBlock.tsx
 * @description Single text block in the chat stream.
 *
 * Renders markdown inline (react-markdown), applies line-clamp for long content,
 * and opens a floating card on click. No wrapper divs — this IS the block element.
 */

import { h, Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useRef, useState, useEffect, useMemo } from 'preact/hooks';
import { emit } from '@create-figma-plugin/utilities';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { marked } from 'marked';
import { tokens } from '../design-system/tokens';

// ============================================
// Constants
// ============================================

const CLAMP_LINES = 6;
const LINE_HEIGHT = 20; // matches tokens.lineHeight[2]

// ============================================
// Shared markdown pieces (node links, component overrides)
// ============================================

const NODE_LINK_RE = /\[node:([^\]|]+?)(?:\|([^\]]+?))?\]/g;

function preprocessNodeLinks(content: string): string {
  return content.replace(NODE_LINK_RE, (_, id, label) => {
    const safeLabel = (label || id).replace(/[[\]()]/g, '\\$&');
    return `[${safeLabel}](nodelink://${id})`;
  });
}

const mdComponents: Record<string, any> = {
  // Zero-margin block elements — height is fully controlled by line-height for accurate fold
  p: ({ children }: any) => <p style={{ margin: 0 }}>{children}</p>,
  ul: ({ children }: any) => <ul style={{ margin: 0, paddingLeft: 16 }}>{children}</ul>,
  ol: ({ children }: any) => <ol style={{ margin: 0, paddingLeft: 16 }}>{children}</ol>,
  li: ({ children }: any) => <li style={{ margin: 0 }}>{children}</li>,
  pre: ({ children }: any) => <pre style={{
    background: 'var(--gray-a2)', padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
    borderRadius: 'var(--radius-2)', fontFamily: 'var(--font-family-mono)',
    fontSize: '0.85em', overflowX: 'auto' as const, lineHeight: '1.5',
    margin: `${tokens.space[1]}px 0`,
  }}>{children}</pre>,
  code: ({ inline, children }: any) =>
    inline
      ? <code style={{ background: 'var(--gray-a3)', padding: '1px 5px', borderRadius: '3px', fontFamily: 'var(--font-family-mono)', fontSize: '0.9em' }}>{children}</code>
      : <code>{children}</code>,
  a: ({ href, children }: any) => {
    if (href?.startsWith('nodelink://')) {
      const id = decodeURIComponent(href.replace('nodelink://', ''));
      const label = Array.isArray(children) ? children.join('') : String(children ?? id);
      return (
        <span
          style={{ background: 'var(--accent-a3)', color: 'var(--accent-11)', borderRadius: '4px', padding: '2px 6px', fontSize: 'inherit', cursor: 'pointer', display: 'inline', lineHeight: 'inherit' }}
          onClick={() => emit('SELECT_NODE', { nodeId: id })}
          onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-a4)' }}
          onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-a3)' }}
          title={`Go to node ${id}`}
        >{label}</span>
      );
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  // GFM tables
  table: ({ children }: any) => (
    <div style={{ overflowX: 'auto', margin: `${tokens.space[1]}px 0` }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'inherit' }}>{children}</table>
    </div>
  ),
  th: ({ children }: any) => (
    <th style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--gray-6)', fontWeight: 600 }}>{children}</th>
  ),
  td: ({ children }: any) => (
    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--gray-a3)' }}>{children}</td>
  ),
};

// ============================================
// Memoized markdown renderer
// ============================================

const remarkPlugins = [remarkGfm];

const Md = memo(({ content }: { content: string }) => {
  const processed = useMemo(() => preprocessNodeLinks(content), [content]);
  return <ReactMarkdown remarkPlugins={remarkPlugins} components={mdComponents}>{processed}</ReactMarkdown>;
});

// ============================================
// Streaming split — stable/unstable boundary
// ============================================

function StreamingMd({ content }: { content: string }) {
  const ref = useRef('');
  if (!content.startsWith(ref.current)) ref.current = '';

  const boundary = ref.current.length;
  const toks = marked.lexer(content.substring(boundary));
  let lastIdx = toks.length - 1;
  while (lastIdx >= 0 && toks[lastIdx]!.type === 'space') lastIdx--;
  let advance = 0;
  for (let i = 0; i < lastIdx; i++) advance += toks[i]!.raw.length;
  if (advance > 0) ref.current = content.substring(0, boundary + advance);

  const stable = ref.current;
  const unstable = content.substring(stable.length);
  return (
    <Fragment>
      {stable && <Md content={stable} />}
      {unstable && <Md content={unstable} />}
    </Fragment>
  );
}

// ============================================
// TextBlock — the block element itself
// ============================================

interface TextBlockProps {
  content: string;
  streaming?: boolean;
}

export function TextBlock({ content, streaming }: TextBlockProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  // Check fold after content settles (not during streaming)
  useEffect(() => {
    if (streaming || !elRef.current) return;
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (!el) return;
      // Temporarily remove maxHeight to measure true scrollHeight
      const prevMaxH = el.style.maxHeight;
      const prevOverflow = el.style.overflow;
      el.style.maxHeight = 'none';
      el.style.overflow = '';
      const needsFold = el.scrollHeight > CLAMP_LINES * LINE_HEIGHT + 8;
      el.style.maxHeight = prevMaxH;
      el.style.overflow = prevOverflow;
      setFolded(needsFold);
    });
  }, [content, streaming]);

  const style: Record<string, any> = {
    fontSize: tokens.fontSize[1],
    lineHeight: tokens.lineHeight[2],
    color: tokens.colors.textPrimary,
    padding: '4px 10px',
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  };

  // Fold: maxHeight clips at line boundary.
  // NOT -webkit-line-clamp — that forces -webkit-box display which collapses
  // all block-level children (tables, paragraphs) into a single inline text flow.
  if (streaming || folded) {
    style.maxHeight = CLAMP_LINES * LINE_HEIGHT + 8; // +8 for padding
    style.overflow = 'hidden';
  }

  if (folded) {
    style.cursor = 'pointer';
    style.borderRadius = 'var(--radius-3)';
    style.transition = 'background 120ms';
    style.marginBottom = tokens.space[1];
  }

  return (
    <Fragment>
      <div
        ref={elRef}
        style={style}
        onClick={folded ? () => setCardOpen(true) : undefined}
        onMouseEnter={folded ? (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' } : undefined}
        onMouseLeave={folded ? (e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = '' } : undefined}
      >
        {streaming ? <StreamingMd content={content} /> : <Md content={content} />}
      </div>

      {cardOpen && <FloatingCard content={content} onClose={() => setCardOpen(false)} />}
    </Fragment>
  );
}

// ============================================
// FloatingCard — full content overlay
// ============================================

function FloatingCard({ content, onClose }: { content: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.style.opacity = '1';
        ref.current.style.transform = 'scale(1)';
      }
    });
  }, []);

  const close = () => {
    const el = ref.current;
    if (el) {
      el.style.opacity = '0';
      el.style.transform = 'scale(.97)';
      setTimeout(onClose, 120);
    } else {
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      onClick={close}
      style={{
        position: 'fixed', inset: '10px', zIndex: 100,
        background: 'var(--color-background)', border: `1px solid ${tokens.colors.surfaceHover}`,
        borderRadius: 'var(--radius-3)',
        boxShadow: '0 4px 20px rgba(0,0,0,.2), 0 1px 4px rgba(0,0,0,.1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        cursor: 'pointer',
        opacity: 0, transform: 'scale(.97)',
        transition: 'opacity 100ms ease, transform 100ms ease',
      }}
    >
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 10px',
        fontSize: tokens.fontSize[1], lineHeight: tokens.lineHeight[2],
        color: tokens.colors.textPrimary,
        userSelect: 'text', WebkitUserSelect: 'text',
      }}>
        <Md content={content} />
      </div>
      <div style={{
        flexShrink: 0, padding: '24px 10px 8px', textAlign: 'center',
        fontSize: 11, color: tokens.colors.textSecondary,
        background: 'linear-gradient(transparent, var(--color-background) 50%)',
        marginTop: -24, position: 'relative', pointerEvents: 'none',
      }}>
        click to close
      </div>
    </div>
  );
}
