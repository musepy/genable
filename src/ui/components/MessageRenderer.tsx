/**
 * @file MessageRenderer.tsx
 * @description Renders LLM text responses as plain text with line breaks
 */

import { h, JSX } from 'preact';
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

export function MessageRenderer({ content }: MessageRendererProps) {
  const safeContent = typeof content === 'string' ? content : String(content ?? '');
  if (!safeContent) return <div />;

  const lines = safeContent.split('\n');

  return (
    <div style={containerStyle}>
      {lines.map((line, i) => {
        if (line.match(/^[•\-*]\s/)) {
          return <li key={i} style={listItemStyle}>{line.slice(2)}</li>;
        }
        if (line.match(/^\d+\.\s/)) {
          return <li key={i} style={listItemStyle}>{line.slice(line.indexOf('.') + 2)}</li>;
        }
        if (line.trim() === '') {
          return <br key={i} />;
        }
        return <p key={i} style={paragraphStyle}>{line}</p>;
      })}
    </div>
  );
}

export default MessageRenderer;
