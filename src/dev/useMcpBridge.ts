/**
 * @file useMcpBridge.ts
 * @description Plugin-side WebSocket bridge for MCP server communication.
 * Connects to ws://localhost:3458 (the MCP server's wsRelay).
 * On incoming WS messages, emits IPC TOOL_CALL and relays TOOL_RESULT back.
 *
 * Runs in parallel with useDevBridge — independent channel, different port.
 * If MCP server isn't running, reconnects silently every 5s (no-op in production).
 *
 * MULTI-RELAY MODE (NEW):
 * Supports connecting to multiple MCP servers simultaneously via comma-separated
 * ports in MCP_WS_PORTS env variable (e.g., "3458,3459,3460").
 * This allows multiple AI clients (Claude Code, OpenCode, etc.) to control Figma
 * at the same time.
 */

import { useEffect, useRef, useState } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import type { ToolCallHandler, ToolResultHandler, SendFileInfoHandler } from '../types'

// Support multiple ports: "3458" (default) or "3458,3459,3460" (multi-client)
const WS_PORTS = (process.env.MCP_WS_PORTS || '3458')
  .split(',')
  .map(p => parseInt(p.trim(), 10))
  .filter(p => !isNaN(p) && p > 0)
const RECONNECT_INTERVAL_MS = 5_000
const REJECTED_RECONNECT_INTERVAL_MS = 30_000 // Back off when another client has priority

type McpBridgeStatus = 'disconnected' | 'connected' | 'partial' // partial = some connected, some not

interface RelayConnection {
  port: number
  ws: WebSocket | null
  status: 'connected' | 'disconnected' | 'rejected'
  name: string
}

/**
 * Detect if we're running inside a real Figma plugin iframe (not a Vite preview or standalone browser).
 * Figma plugin iframes have `parent !== window` and the Figma postMessage bridge available.
 */
function isInsideFigmaPlugin(): boolean {
  try {
    // In Figma plugin UI, the iframe is embedded and parent !== self.
    // In a Vite preview or standalone page, parent === self (top-level window).
    return typeof window !== 'undefined' && window.parent !== window
  } catch {
    return false
  }
}

export function useMcpBridge(): { mcpBridgeStatus: McpBridgeStatus; connectedCount: number; totalCount: number } {
  const [status, setStatus] = useState<McpBridgeStatus>('disconnected')
  const [connectedCount, setConnectedCount] = useState(0)
  const relaysRef = useRef<RelayConnection[]>([])
  const fileInfoRef = useRef<{ fileKey: string; fileName: string } | null>(null)

  useEffect(() => {
    // Only connect in real Figma plugin context — not in Vite preview or standalone browser
    if (!isInsideFigmaPlugin()) {
      console.log('[McpBridge] Skipping — not inside Figma plugin iframe')
      return
    }

    // Listen for file info from main thread, then re-identify all relays
    const cleanupFileInfo = on<SendFileInfoHandler>('SEND_FILE_INFO', (data) => {
      fileInfoRef.current = data
      console.log(`[McpBridge] File info: ${data.fileName} (${data.fileKey})`)
      for (const relay of relaysRef.current) {
        if (relay.ws && relay.ws.readyState === WebSocket.OPEN) {
          relay.ws.send(JSON.stringify({ type: 'identify', name: 'figma-plugin', ...data }))
        }
      }
    })
    // Request file info from main thread (avoids race condition)
    emit('REQUEST_FILE_INFO' as any)

    // Initialize relay connections
    relaysRef.current = WS_PORTS.map(port => ({
      port,
      ws: null,
      status: 'disconnected',
      name: `mcp-relay-${port}`
    }))

    let disposed = false
    const reconnectTimers: Map<number, ReturnType<typeof setTimeout>> = new Map()
    // Track IPC listeners per relay so we can clean them up
    const ipcCleanupsPerRelay: Map<number, Array<() => void>> = new Map()

    function updateOverallStatus() {
      const connected = relaysRef.current.filter(r => r.status === 'connected').length
      const rejected = relaysRef.current.filter(r => r.status === 'rejected').length
      const total = relaysRef.current.length
      
      setConnectedCount(connected)
      
      if (connected === total) {
        setStatus('connected')
      } else if (connected > 0) {
        setStatus('partial')
      } else {
        setStatus('disconnected')
      }
      
      if (total > 1) {
        console.log(`[McpBridge] Status: ${connected}/${total} relays connected`)
      }
    }

    function connectRelay(relay: RelayConnection) {
      if (disposed) return

      // Clear any existing reconnect timer for this relay
      if (reconnectTimers.has(relay.port)) {
        clearTimeout(reconnectTimers.get(relay.port)!)
        reconnectTimers.delete(relay.port)
      }

      try {
        const wsUrl = `ws://localhost:${relay.port}`
        const ws = new WebSocket(wsUrl)
        relay.ws = ws

        ws.onopen = () => {
          if (disposed) { ws.close(); return }
          // Send identify handshake — relay requires this before accepting tool calls
          const identifyMsg: any = { type: 'identify', name: 'figma-plugin' }
          if (fileInfoRef.current) {
            identifyMsg.fileKey = fileInfoRef.current.fileKey
            identifyMsg.fileName = fileInfoRef.current.fileName
          }
          ws.send(JSON.stringify(identifyMsg))
          console.log(`[McpBridge] Connected to MCP relay on port ${relay.port}`)
          relay.status = 'connected'
          updateOverallStatus()
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

            console.log(`[McpBridge] ← WS[${relay.port}] received: ${toolName} (${requestId})`)

            // Listen for the matching TOOL_RESULT from main thread
            const cleanup = on<ToolResultHandler>('TOOL_RESULT', (data) => {
              if (data.requestId !== requestId) return
              cleanup() // one-shot listener
              
              // Remove from tracking
              const cleanups = ipcCleanupsPerRelay.get(relay.port) || []
              const idx = cleanups.indexOf(cleanup)
              if (idx !== -1) {
                cleanups.splice(idx, 1)
                ipcCleanupsPerRelay.set(relay.port, cleanups)
              }

              console.log(`[McpBridge] ← IPC result: ${toolName} (${requestId}), success=${data.response?.error == null}`)

              // Send result back to MCP server over WebSocket
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ requestId, response: data.response }))
                console.log(`[McpBridge] → WS[${relay.port}] sent result: ${toolName} (${requestId})`)
              } else {
                console.warn(`[McpBridge] WS[${relay.port}] not open when trying to send result for ${requestId}`)
              }
            })
            
            if (!ipcCleanupsPerRelay.has(relay.port)) {
              ipcCleanupsPerRelay.set(relay.port, [])
            }
            ipcCleanupsPerRelay.get(relay.port)!.push(cleanup)

            // Forward to Figma main thread via IPC
            console.log(`[McpBridge] → IPC emit TOOL_CALL: ${toolName} (${requestId})`)
            emit<ToolCallHandler>('TOOL_CALL', {
              requestId,
              toolName,
              parameters,
            })
          } catch (e) {
            console.error(`[McpBridge] Failed to process WS[${relay.port}] message:`, e)
          }
        }

        ws.onclose = (event) => {
          // Update relay status
          if (relay.ws === ws) {
            relay.ws = null
            relay.status = event.code === 4001 ? 'rejected' : 'disconnected'
            updateOverallStatus()
          }
          
          if (!disposed) {
            // If rejected because another client has priority (code 4001), back off longer
            // Note: In multi-client mode, this shouldn't happen anymore
            const interval = event.code === 4001
              ? REJECTED_RECONNECT_INTERVAL_MS
              : RECONNECT_INTERVAL_MS
            if (event.code === 4001) {
              console.log(`[McpBridge] Port ${relay.port}: Another client has priority — backing off to 30s reconnect`)
            }
            reconnectTimers.set(relay.port, setTimeout(() => connectRelay(relay), interval))
          }
        }

        ws.onerror = () => {
          // onclose will fire after onerror, which handles reconnect
        }
      } catch {
        // WebSocket constructor can throw if URL is invalid (shouldn't happen)
        relay.status = 'disconnected'
        updateOverallStatus()
        if (!disposed) {
          reconnectTimers.set(relay.port, setTimeout(() => connectRelay(relay), RECONNECT_INTERVAL_MS))
        }
      }
    }

    // Connect to all relays
    for (const relay of relaysRef.current) {
      connectRelay(relay)
    }

    return () => {
      disposed = true
      cleanupFileInfo()

      // Clear all reconnect timers
      for (const timer of reconnectTimers.values()) {
        clearTimeout(timer)
      }
      reconnectTimers.clear()
      
      // Clean up all IPC listeners
      for (const cleanups of ipcCleanupsPerRelay.values()) {
        for (const cleanup of cleanups) {
          cleanup()
        }
      }
      ipcCleanupsPerRelay.clear()
      
      // Close all WebSocket connections
      for (const relay of relaysRef.current) {
        if (relay.ws) {
          relay.ws.close()
          relay.ws = null
        }
      }
    }
  }, [])

  return { 
    mcpBridgeStatus: status, 
    connectedCount, 
    totalCount: WS_PORTS.length 
  }
}
