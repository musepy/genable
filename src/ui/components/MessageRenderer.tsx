/**
 * @file MessageRenderer.tsx
 * @description Renders LLM text responses with Markdown support and streaming optimization.
 *
 * Uses react-markdown for rendering and marked.lexer() for streaming block-boundary detection.
 * Streaming mode splits content into stable (memoized) + unstable (re-parsed) portions
 * to avoid O(n) re-parsing of completed blocks on every text delta.
 */

import { h, Fragment, JSX } from 'preact';
import { memo } from 'preact/compat';
import { useRef, useMemo } from 'preact/hooks';
import { emit } from '@create-figma-plugin/utilities';
import ReactMarkdown from 'react-markdown';
import { marked } from 'marked';
import { tokens } from '../design-system/tokens';

// ============================================
// Types
// ============================================

interface MessageRendererProps {
  content: string;
  streaming?: boolean;
}

// ============================================
// Styles
// ============================================

const containerStyle: JSX.CSSProperties = {
  fontSize: 'var(--font-size-1)',
  lineHeight: tokens.lineHeight[2],
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
};

const paragraphStyle: JSX.CSSProperties = {
  marginTop: tokens.space[1],
  marginBottom: tokens.space[1],
  lineHeight: tokens.lineHeight[2],
};

const listItemStyle: JSX.CSSProperties = {
  marginBottom: tokens.space[1],
  lineHeight: tokens.lineHeight[2],
};

const inlineCodeStyle: JSX.CSSProperties = {
  background: 'var(--gray-a3)',
  padding: '1px 5px',
  borderRadius: '3px',
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.9em',
};

const codeBlockStyle: JSX.CSSProperties = {
  background: 'var(--gray-a2)',
  padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
  borderRadius: 'var(--radius-2)',
  fontFamily: 'var(--font-family-mono)',
  fontSize: '0.85em',
  overflowX: 'auto' as const,
  lineHeight: '1.5',
  margin: `${tokens.space[1]}px 0`,
};

const nodeLinkStyle: JSX.CSSProperties = {
  background: 'var(--accent-a3)',
  color: 'var(--accent-11)',
  borderRadius: '4px',
  padding: '2px 6px',
  fontSize: 'inherit',
  cursor: 'pointer',
  display: 'inline',
  lineHeight: 'inherit',
};

// ============================================
// Node Link Chip (preserved from original)
// ============================================

function NodeLinkChip({ id, label }: { id: string; label: string }) {
  return (
    <span
      style={nodeLinkStyle}
      onClick={() => emit('SELECT_NODE', { nodeId: id })}
      onMouseEnter={(e: MouseEvent) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent-a4)';
      }}
      onMouseLeave={(e: MouseEvent) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--accent-a3)';
      }}
      title={`Go to node ${id}`}
    >
      {label}
    </span>
  );
}

// ============================================
// Pre-processing: [node:ID|label] → markdown link
// ============================================

const NODE_LINK_RE = /\[node:([^\]|]+?)(?:\|([^\]]+?))?\]/g;

function preprocessNodeLinks(content: string): string {
  return content.replace(NODE_LINK_RE, (_, id, label) => {
    const safeLabel = (label || id).replace(/[[\]()]/g, '\\$&');
    return `[${safeLabel}](nodelink://${id})`;
  });
}

// ============================================
// Markdown component overrides
// ============================================

const markdownComponents: Record<string, any> = {
  p: ({ children }: any) => <p style={paragraphStyle}>{children}</p>,
  li: ({ children }: any) => <li style={listItemStyle}>{children}</li>,
  pre: ({ children }: any) => <pre style={codeBlockStyle}>{children}</pre>,
  code: ({ inline, children }: any) =>
    inline
      ? <code style={inlineCodeStyle}>{children}</code>
      : <code>{children}</code>,
  a: ({ href, children }: any) => {
    if (href?.startsWith('nodelink://')) {
      const id = decodeURIComponent(href.replace('nodelink://', ''));
      const label = Array.isArray(children) ? children.join('') : String(children ?? id);
      return <NodeLinkChip id={id} label={label} />;
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
};

// ============================================
// MarkdownBlock — memoized single-block renderer
// ============================================

const MarkdownBlock = memo(({ content }: { content: string }) => {
  const processed = useMemo(() => preprocessNodeLinks(content), [content]);
  return (
    <ReactMarkdown components={markdownComponents}>
      {processed}
    </ReactMarkdown>
  );
});

// ============================================
// StreamingMarkdown — stable/unstable split
//
// Strategy (from Claude Code):
// - Use marked.lexer() to find markdown block boundaries
// - Everything before the last block = "stable" (content won't change, memoized)
// - The last block = "unstable" (still growing, re-parsed each delta)
// - stablePrefixRef advances monotonically as blocks complete
// ============================================

function StreamingMarkdown({ content }: { content: string }) {
  const stablePrefixRef = useRef('');

  // Reset if text was replaced (e.g. turn_end summary overrides accumulated text)
  if (!content.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }

  // Lex only the tail (from current stable boundary onwards)
  const boundary = stablePrefixRef.current.length;
  const tail = content.substring(boundary);
  const lexTokens = marked.lexer(tail);

  // Find last content token (skip trailing whitespace-only tokens)
  let lastContentIdx = lexTokens.length - 1;
  while (lastContentIdx >= 0 && lexTokens[lastContentIdx]!.type === 'space') {
    lastContentIdx--;
  }

  // Advance stable boundary: all complete tokens except the last content token
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) {
    advance += lexTokens[i]!.raw.length;
  }
  if (advance > 0) {
    stablePrefixRef.current = content.substring(0, boundary + advance);
  }

  const stable = stablePrefixRef.current;
  const unstable = content.substring(stable.length);

  return (
    <Fragment>
      {stable && <MarkdownBlock content={stable} />}
      {unstable && <MarkdownBlock content={unstable} />}
    </Fragment>
  );
}

// ============================================
// Main Export
// ============================================

export function MessageRenderer({ content, streaming }: MessageRendererProps) {
  const safeContent = typeof content === 'string' ? content : String(content ?? '');
  if (!safeContent) return <div />;

  return (
    <div style={containerStyle}>
      {streaming
        ? <StreamingMarkdown content={safeContent} />
        : <MarkdownBlock content={safeContent} />
      }
    </div>
  );
}

export default MessageRenderer;
