/**
 * @file ToolBlock.tsx
 * @description Renders a group of consecutive tool calls as a single collapsible block.
 *
 * Collapsed: "N tools" (one line, clickable)
 * Running: "ToolName..." (current tool, one line)
 * Expanded: In-place drawer showing each tool with name + truncated args
 */

import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { tokens, motion } from '../design-system/tokens';
import type { ToolCallRecord } from '../../types/chat';

const BRAILLE_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const BRAILLE_INTERVAL = 80;

function useBrailleSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame(f => (f + 1) % BRAILLE_FRAMES.length), BRAILLE_INTERVAL);
    return () => clearInterval(id);
  }, [active]);
  return active ? BRAILLE_FRAMES[frame] : '';
}

interface ToolBlockProps {
  tools: ToolCallRecord[];
}

const INITIAL_SHOW = 5;

/** Format tool args as a short string for display */
function formatArgs(params: any): string {
  if (!params) return '';
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { return params.slice(0, 60); }
  }
  if (typeof params !== 'object') return String(params).slice(0, 60);
  // Pick the most informative fields
  const entries = Object.entries(params);
  if (entries.length === 0) return '';
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(', ')
    .slice(0, 80);
}

export function ToolBlock({ tools }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const isRunning = tools.some(t => t.status === 'running' || t.status === 'pending');
  const spinner = useBrailleSpinner(isRunning);
  const lastTool = tools[tools.length - 1];
  const count = tools.length;

  // Header text
  const headerText = isRunning
    ? `${spinner} ${lastTool?.name}...`
    : `${count} tool${count !== 1 ? 's' : ''}`;

  // Visible tools when expanded
  const visibleTools = showAll ? tools : tools.slice(0, INITIAL_SHOW);
  const remaining = tools.length - visibleTools.length;

  return (
    <div style={{ fontSize: tokens.fontSize[1], lineHeight: tokens.lineHeight[2], color: tokens.colors.textSecondary, padding: 0 }}>
      {/* Header — click to toggle expand */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          cursor: 'pointer',
          borderRadius: 'var(--radius-3)',
          padding: `${tokens.space[1]}px ${tokens.grid.blockPad}px`,
          transition: 'background 120ms',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
      >
        {headerText}
      </div>

      {/* Drawer — in-place expand */}
      <div style={motion.disclosure(expanded)}>
        <div style={motion.disclosureContent}>
          {visibleTools.map((tool, i) => {
            const args = formatArgs(tool.parameters);
            return (
              <div
                key={tool.id || i}
                style={{
                  fontSize: tokens.fontSize[1],
                  lineHeight: tokens.lineHeight[2],
                  color: tokens.colors.textSecondary,
                  padding: `0 ${tokens.grid.blockPad}px 0 ${tokens.space[5]}px`,
                  borderRadius: 'var(--radius-3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'background 120ms',
                  cursor: 'default',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-a3)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
              >
                {tool.name}
                {args && <span style={{ color: 'var(--gray-9)', marginLeft: tokens.space[1] }}>{args}</span>}
              </div>
            );
          })}

          {/* +N more row */}
          {remaining > 0 && (
            <div
              onClick={e => { e.stopPropagation(); setShowAll(true); }}
              style={{
                fontSize: tokens.fontSize[1],
                lineHeight: tokens.lineHeight[2],
                color: 'var(--accent-11)',
                padding: `0 ${tokens.grid.blockPad}px 0 ${tokens.space[5]}px`,
                borderRadius: 'var(--radius-3)',
                cursor: 'pointer',
                transition: 'background 120ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-a3)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
            >
              +{remaining} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
