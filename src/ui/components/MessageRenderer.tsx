/**
 * @file MessageRenderer.tsx
 * @description Renders LLM text responses as plain text with line breaks
 */

import { h, JSX } from 'preact';
import { emit } from '@create-figma-plugin/utilities';
import { tokens } from '../design-system/tokens';

interface MessageRendererProps {
  content: string;
}

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

// Matches [node:ID] or [node:ID|label] where ID can contain colons (e.g. 1234:5678)
const NODE_LINK_RE = /\[node:([^\]|]+?)(?:\|([^\]]+?))?\]/g;

type Segment = { type: 'text'; value: string } | { type: 'nodeLink'; id: string; label: string };

function parseNodeLinks(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  NODE_LINK_RE.lastIndex = 0;
  while ((match = NODE_LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    const id = match[1];
    const label = match[2] || id;
    segments.push({ type: 'nodeLink', id, label });
    lastIndex = NODE_LINK_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

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

function renderLineContent(text: string): (string | JSX.Element)[] {
  const segments = parseNodeLinks(text);
  if (segments.length === 1 && segments[0].type === 'text') {
    return [text];
  }
  return segments.map((seg, i) =>
    seg.type === 'text'
      ? seg.value
      : <NodeLinkChip key={i} id={seg.id} label={seg.label} />
  );
}

export function MessageRenderer({ content }: MessageRendererProps) {
  const safeContent = typeof content === 'string' ? content : String(content ?? '');
  if (!safeContent) return <div />;

  const lines = safeContent.split('\n');

  return (
    <div style={containerStyle}>
      {lines.map((line, i) => {
        if (line.match(/^[•\-*]\s/)) {
          return <li key={i} style={listItemStyle}>{renderLineContent(line.slice(2))}</li>;
        }
        if (line.match(/^\d+\.\s/)) {
          return <li key={i} style={listItemStyle}>{renderLineContent(line.slice(line.indexOf('.') + 2))}</li>;
        }
        if (line.trim() === '') {
          return <br key={i} />;
        }
        return <p key={i} style={paragraphStyle}>{renderLineContent(line)}</p>;
      })}
    </div>
  );
}

export default MessageRenderer;
