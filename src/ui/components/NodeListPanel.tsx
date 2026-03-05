/**
 * @file NodeListPanel.tsx
 * @description Clickable node list derived from create tool results.
 *
 * Shows nodes created by the agent (from idMap in tool results).
 * Click a node → emit SELECT_NODE → Figma canvas jumps & selects it.
 * No separate selection state — Figma's native selection is the single source of truth.
 */

import { h } from 'preact'
import { useState, useMemo } from 'preact/hooks'
import { emit } from '@create-figma-plugin/utilities'
import { tokens } from '../design-system/tokens'
import { ToolCallRecord } from '../../types/chat'
import { SelectNodeHandler } from '../../types'

interface NodeListPanelProps {
  toolCalls: ToolCallRecord[]
}

/** Extract merged idMap from all successful create tool calls */
function extractCreatedNodes(toolCalls: ToolCallRecord[]): Array<{ symbol: string; nodeId: string }> {
  const nodes: Array<{ symbol: string; nodeId: string }> = []
  const seen = new Set<string>()

  for (const tc of toolCalls) {
    if (tc.name !== 'create' || tc.status !== 'success') continue
    const idMap = tc.result?.data?.idMap
    if (!idMap || typeof idMap !== 'object') continue

    for (const [symbol, nodeId] of Object.entries(idMap)) {
      if (typeof nodeId === 'string' && !seen.has(nodeId)) {
        seen.add(nodeId)
        nodes.push({ symbol, nodeId })
      }
    }
  }

  return nodes
}

export function NodeListPanel({ toolCalls }: NodeListPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const nodes = useMemo(() => extractCreatedNodes(toolCalls), [toolCalls])

  if (nodes.length === 0) return null

  const dim = tokens.colors.textSecondary
  const faint = tokens.colors.alpha[4]
  const sz = tokens.fontSize[1]
  const MARKER_W = 14

  const handleNodeClick = (nodeId: string) => {
    emit<SelectNodeHandler>('SELECT_NODE', { nodeId, smooth: true })
  }

  return (
    <div style={{ marginTop: tokens.space[1] }}>
      {/* Header — matches ToolExecutionPanel hanging indent */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          fontSize: sz,
          color: dim,
          lineHeight: '20px',
          cursor: 'pointer',
          marginLeft: -MARKER_W,
        }}
      >
        <span style={{
          width: MARKER_W,
          flexShrink: 0,
          textAlign: 'center',
          color: faint,
        }}>◇</span>

        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nodes.length} node{nodes.length > 1 ? 's' : ''} created
        </span>

        <span style={{
          flexShrink: 0,
          marginLeft: tokens.space[1],
          color: faint,
          fontSize: '10px',
          display: 'inline-block',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 150ms ease',
        }}>▾</span>
      </div>

      {/* Expanded node list */}
      {expanded && (
        <div style={{
          marginTop: tokens.space[1],
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}>
          {nodes.map(({ symbol, nodeId }) => (
            <div
              key={nodeId}
              onClick={() => handleNodeClick(nodeId)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = tokens.colors.alpha[2]
                e.currentTarget.style.color = tokens.colors.textPrimary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = dim
              }}
              style={{
                fontSize: sz,
                lineHeight: '22px',
                color: dim,
                cursor: 'pointer',
                padding: `1px ${tokens.space[2]}px`,
                borderRadius: 'var(--radius-2)',
                transition: 'background 120ms ease, color 120ms ease',
                display: 'flex',
                alignItems: 'center',
                gap: tokens.space[2],
              }}
            >
              <span style={{ flexShrink: 0, fontSize: '10px', color: faint }}>↗</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {symbol}
              </span>
              <span style={{ flexShrink: 0, fontSize: '10px', color: faint, fontFamily: 'monospace' }}>
                {nodeId}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
