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

import { h, JSX } from 'preact';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { emit } from '@create-figma-plugin/utilities';
import { Button } from './Button';
import { ImportJsonHandler } from '../../types';
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

const codeBlockStyle: JSX.CSSProperties = {
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

const inlineCodeStyle: JSX.CSSProperties = {
  background: tokens.colors.surface,
  borderRadius: 'var(--radius-1)',
  padding: `2px ${tokens.space[1]}px`,
  fontFamily: tokens.font.mono,
  fontSize: 'var(--font-size-1)',
};

const listStyle: JSX.CSSProperties = {
  paddingLeft: tokens.space[5],
  marginTop: tokens.space[1],
  marginBottom: tokens.space[1],
};

const listItemStyle: JSX.CSSProperties = {
  marginBottom: tokens.space[1],
  lineHeight: tokens.lineHeight[3],
};

const headingStyle: JSX.CSSProperties = {
  fontWeight: tokens.fontWeight.semibold,
  marginTop: tokens.space[4],
  marginBottom: tokens.space[2],
};

const paragraphStyle: JSX.CSSProperties = {
  marginTop: tokens.space[1],
  marginBottom: tokens.space[1],
  lineHeight: tokens.lineHeight[3],
};

const linkStyle: JSX.CSSProperties = {
  color: tokens.colors.accent,
  textDecoration: 'underline',
};

const tableStyle: JSX.CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  margin: `${tokens.space[2]}px 0`,
  fontSize: 'var(--font-size-1)',
};

const thStyle: JSX.CSSProperties = {
  border: `1px solid ${tokens.colors.grayBorder}`,
  padding: tokens.space[2],
  background: tokens.colors.surface,
  textAlign: 'left',
  fontWeight: tokens.fontWeight.semibold,
};

const tdStyle: JSX.CSSProperties = {
  border: `1px solid ${tokens.colors.grayBorder}`,
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

          const codeContent = String(children).replace(/\n$/, '');
          const trimmed = codeContent.trim();
          const isJson = trimmed.startsWith('[') || trimmed.startsWith('{');
          const isSingleLine = !codeContent.includes('\n');
          const isShort = trimmed.length > 0 && trimmed.length <= 24;
          const compactBlock = isSingleLine && isShort;
          
          const handleImport = () => {
             emit<ImportJsonHandler>('IMPORT_JSON', { jsonString: codeContent });
          };

          return (
            <div style={{ position: 'relative', margin: `${compactBlock ? tokens.space[1] : tokens.space[2]}px 0` }}>
              {isJson && (
                <div style={{ 
                  position: 'absolute', 
                  top: tokens.space[2], 
                  right: tokens.space[2], 
                  zIndex: 10
                }}>
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleImport}
                    style={{ 
                      height: 24, 
                      padding: '0 8px', 
                      fontSize: '12px',
                      background: tokens.colors.surface,
                      borderColor: tokens.colors.grayBorder
                    }}
                    leftIcon={
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    }
                  >
                    导入 Figma
                  </Button>
                </div>
              )}
              <pre style={{ 
                ...codeBlockStyle, 
                margin: 0,
                display: compactBlock ? 'inline-block' : 'block',
                padding: compactBlock ? tokens.space[2] : tokens.space[4],
              }}>
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            </div>
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
  // Ensure content is always a string to prevent Preact diff errors
  const safeContent = typeof content === 'string' ? content : String(content ?? '');

  if (!safeContent) {
    // Return consistent element type to avoid vnode switching (insertBefore errors)
    return <div />;
  }

  switch (level) {
    case 'L1':
      return renderL1(safeContent);
    case 'L2':
      // L2 falls through to L3 for now (code highlighting requires same deps)
    case 'L3':
    default:
      return renderL3(safeContent);
  }
}

export default MessageRenderer;
