/**
 * @file MessageRenderer.tsx
 * @description Renders LLM responses with full Markdown support (L3)
 * 
 * [INPUT]:  markdown string content
 * [OUTPUT]: Rendered React elements with styling
 * [POS]:    UI component for rendering chat messages
 * 
 * Supports: headers, lists, code blocks, bold/italic, tables, links
 */

import { h } from 'preact';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { tokens } from '../design-system/tokens';

// ============================================
// Types
// ============================================

type RenderLevel = 'L1' | 'L2' | 'L3';

interface MessageRendererProps {
  /** The markdown content to render */
  content: string;
  /** Rendering level: L1 (simple), L2 (+ code), L3 (full MD) */
  level?: RenderLevel;
}

// ============================================
// Styles for Markdown elements
// ============================================

const codeBlockStyle: React.CSSProperties = {
  display: 'block',
  background: tokens.colors.surface,
  borderRadius: 'var(--radius-2)',
  padding: tokens.space[4],
  fontFamily: tokens.font.mono,
  fontSize: 'var(--font-size-1)',
  overflow: 'auto',
  margin: `${tokens.space[2]}px 0`,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const inlineCodeStyle: React.CSSProperties = {
  background: tokens.colors.surface,
  borderRadius: 'var(--radius-1)',
  padding: `2px ${tokens.space[1]}px`,
  fontFamily: tokens.font.mono,
  fontSize: 'var(--font-size-1)',
};

const listStyle: React.CSSProperties = {
  paddingLeft: tokens.space[5],
  marginTop: tokens.space[1],
  marginBottom: tokens.space[1],
};

const listItemStyle: React.CSSProperties = {
  marginBottom: tokens.space[1],
  lineHeight: tokens.lineHeight[3],
};

const headingStyle: React.CSSProperties = {
  fontWeight: tokens.fontWeight.semibold,
  marginTop: tokens.space[4],
  marginBottom: tokens.space[2],
};

const paragraphStyle: React.CSSProperties = {
  marginTop: tokens.space[1],
  marginBottom: tokens.space[1],
  lineHeight: tokens.lineHeight[3],
};

const linkStyle: React.CSSProperties = {
  color: tokens.colors.primary,
  textDecoration: 'underline',
};

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  margin: `${tokens.space[2]}px 0`,
  fontSize: 'var(--font-size-1)',
};

const thStyle: React.CSSProperties = {
  border: `1px solid ${tokens.colors.border}`,
  padding: tokens.space[2],
  background: tokens.colors.surface,
  textAlign: 'left',
  fontWeight: tokens.fontWeight.semibold,
};

const tdStyle: React.CSSProperties = {
  border: `1px solid ${tokens.colors.border}`,
  padding: tokens.space[2],
};

// ============================================
// L1: Simple parsing (no dependencies)
// ============================================

function renderL1(content: string) {
  const lines = content.split('\n');
  
  return (
    <div style={{ fontSize: 'var(--font-size-1)', lineHeight: tokens.lineHeight[3] }}>
      {lines.map((line, i) => {
        // List items
        if (line.match(/^[•\-\*]\s/)) {
          return <li key={i} style={listItemStyle}>{line.slice(2)}</li>;
        }
        // Numbered list
        if (line.match(/^\d+\.\s/)) {
          return <li key={i} style={listItemStyle}>{line.slice(line.indexOf('.') + 2)}</li>;
        }
        // Empty line
        if (line.trim() === '') {
          return <br key={i} />;
        }
        // Regular paragraph
        return <p key={i} style={paragraphStyle}>{line}</p>;
      })}
    </div>
  );
}

// ============================================
// L3: Full Markdown with react-markdown
// ============================================

function renderL3(content: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Code blocks and inline code
        code: ({ node, inline, className, children, ...props }: any) => {
          if (inline) {
            return (
              <code style={inlineCodeStyle} {...props}>
                {children}
              </code>
            );
          }
          return (
            <pre style={codeBlockStyle}>
              <code className={className} {...props}>
                {children}
              </code>
            </pre>
          );
        },
        
        // Lists
        ul: ({ children }: any) => (
          <ul style={listStyle}>{children}</ul>
        ),
        ol: ({ children }: any) => (
          <ol style={listStyle}>{children}</ol>
        ),
        li: ({ children }: any) => (
          <li style={listItemStyle}>{children}</li>
        ),
        
        // Headings
        h1: ({ children }: any) => (
          <h1 style={{ ...headingStyle, fontSize: 'var(--font-size-4)' }}>{children}</h1>
        ),
        h2: ({ children }: any) => (
          <h2 style={{ ...headingStyle, fontSize: 'var(--font-size-3)' }}>{children}</h2>
        ),
        h3: ({ children }: any) => (
          <h3 style={{ ...headingStyle, fontSize: 'var(--font-size-2)' }}>{children}</h3>
        ),
        
        // Paragraphs
        p: ({ children }: any) => (
          <p style={paragraphStyle}>{children}</p>
        ),
        
        // Links
        a: ({ href, children }: any) => (
          <a href={href} style={linkStyle} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        
        // Tables (GFM)
        table: ({ children }: any) => (
          <table style={tableStyle}>{children}</table>
        ),
        thead: ({ children }: any) => <thead>{children}</thead>,
        tbody: ({ children }: any) => <tbody>{children}</tbody>,
        tr: ({ children }: any) => <tr>{children}</tr>,
        th: ({ children }: any) => <th style={thStyle}>{children}</th>,
        td: ({ children }: any) => <td style={tdStyle}>{children}</td>,
        
        // Strong & Emphasis
        strong: ({ children }: any) => (
          <strong style={{ fontWeight: tokens.fontWeight.semibold }}>{children}</strong>
        ),
        em: ({ children }: any) => (
          <em style={{ fontStyle: 'italic' }}>{children}</em>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ============================================
// Main Component
// ============================================

export function MessageRenderer({ content, level = 'L3' }: MessageRendererProps) {
  if (!content) {
    return null;
  }
  
  switch (level) {
    case 'L1':
      return renderL1(content);
    case 'L2':
      // L2 falls through to L3 for now (code highlighting requires same deps)
    case 'L3':
    default:
      return renderL3(content);
  }
}

export default MessageRenderer;
