/**
 * @file useMcpBridge.ts
 * @description Plugin-side WebSocket bridge for MCP server communication.
 * Connects to ws://localhost:3458 (the MCP server's wsRelay).
 * On incoming WS messages, emits IPC TOOL_CALL and relays TOOL_RESULT back.
 *
 * Runs in parallel with useDevBridge — independent channel, different port.
 * If MCP server isn't running, reconnects silently every 5s (no-op in production).
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import type { ToolCallHandler, ToolResultHandler } from '../types'

const WS_URL = 'ws://localhost:3458'
const RECONNECT_INTERVAL_MS = 5_000

type McpBridgeStatus = 'disconnected' | 'connected'

export function useMcpBridge(): { mcpBridgeStatus: McpBridgeStatus } {
  const [status, setStatus] = useState<McpBridgeStatus>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    // Track IPC listeners so we can clean them up
    const ipcCleanups: Array<() => void> = []

    function connect() {
      if (disposed) return

      try {
        const ws = new WebSocket(WS_URL)
        wsRef.current = ws

        ws.onopen = () => {
          if (disposed) { ws.close(); return }
          console.log('[McpBridge] Connected to MCP relay')
          setStatus('connected')
        }

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string)
            const { requestId, toolName, parameters } = msg as {
              requestId: string
              toolName: string
              parameters: Record<string, any>
            }

            if (!requestId || !toolName) return

            // Listen for the matching TOOL_RESULT from main thread
            const cleanup = on<ToolResultHandler>('TOOL_RESULT', (data) => {
              if (data.requestId !== requestId) return
              cleanup() // one-shot listener
              // Remove from tracking array
              const idx = ipcCleanups.indexOf(cleanup)
              if (idx !== -1) ipcCleanups.splice(idx, 1)

              // Send result back to MCP server over WebSocket
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ requestId, response: data.response }))
              }
            })
            ipcCleanups.push(cleanup)

            // Forward to Figma main thread via IPC
            emit<ToolCallHandler>('TOOL_CALL', {
              requestId,
              toolName,
              parameters,
            })
          } catch (e) {
            console.error('[McpBridge] Failed to process WS message:', e)
          }
        }

        ws.onclose = () => {
          if (wsRef.current === ws) {
            wsRef.current = null
            setStatus('disconnected')
          }
          if (!disposed) {
            reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL_MS)
          }
        }

        ws.onerror = () => {
          // onclose will fire after onerror, which handles reconnect
        }
      } catch {
        // WebSocket constructor can throw if URL is invalid (shouldn't happen)
        if (!disposed) {
          reconnectTimer = setTimeout(connect, RECONNECT_INTERVAL_MS)
        }
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      // Clean up all pending IPC listeners
      for (const cleanup of ipcCleanups) {
        cleanup()
      }
      ipcCleanups.length = 0
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  return { mcpBridgeStatus: status }
}
