/**
 * Preview Entry Point
 * 
 * This file mocks Figma's plugin environment and renders the UI in a standalone browser.
 * Use with: npm run preview
 */

// ============================================
// FIGMA API MOCKS - Must be set up BEFORE importing UI
// ============================================

// Store for mock event handlers
const handlers: Record<string, Function[]> = {}

function triggerHandler(eventName: string, data: any) {
  console.log(`[Mock] triggerHandler: ${eventName}`, data)
  if (handlers[eventName]) {
    handlers[eventName].forEach(h => h(data))
  }
}

// Preview feature flag used by UI hooks to inject simulation harness
;(window as any).__GENABLE_PREVIEW__ = true

// Mock @create-figma-plugin/utilities - set up on window FIRST
;(window as any).__FIGMA_MOCK__ = {
  emit: (eventName: string, ...args: any[]) => {
    console.log(`[Figma Mock] emit: ${eventName}`, args)
    
    // Simulate responses for common events
    if (eventName === 'LOAD_SETTINGS') {
      setTimeout(() => {
        // Try to get key from localStorage first (for real testing)
        const storedKey = localStorage.getItem('PREVIEW_GEMINI_API_KEY')
        const apiKey = storedKey || 'mock-api-key-12345'
        
        triggerHandler('SETTINGS_LOADED', { 
          apiKey,
          modelName: 'gemini-2.5-flash',
          availableModels: [
            { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
            { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
            { name: 'gemini-2.5-flash-preview-05-20', displayName: '2.5 Flash' },
            { name: 'gemini-2.5-pro-preview-05-06', displayName: '2.5 Pro' },
          ]
        })
      }, 100)
    }
    
    if (eventName === 'GET_VARIABLES') {
      setTimeout(() => {
        triggerHandler('SEND_VARIABLES', { 
          names: ['primary', 'secondary', 'background', 'foreground', 'muted']
        })
      }, 50)
    }
    
    if (eventName === 'GET_SELECTION_STYLES') {
      setTimeout(() => {
        triggerHandler('SEND_SELECTION_STYLES', { 
          selectionNodes: [],
          referenceLayout: { width: 390, height: 844 }
        })
      }, 50)
    }
    
    if (eventName === 'GET_LOCAL_COMPONENTS') {
      setTimeout(() => {
        triggerHandler('SEND_LOCAL_COMPONENTS', { components: [] })
      }, 50)
    }
    
    if (eventName === 'LOAD_STYLE_MEMORY') {
      setTimeout(() => {
        triggerHandler('SEND_STYLE_MEMORY', { memory: null })
      }, 50)
    }
    
    if (eventName === 'GET_LIBRARY_RESOURCES') {
      setTimeout(() => {
        triggerHandler('SEND_LIBRARY_RESOURCES', { resources: [] })
      }, 50)
    }

    if (eventName === 'SAVE_SETTINGS') {
      const settings = args[0]
      if (settings?.apiKey) {
        localStorage.setItem('PREVIEW_GEMINI_API_KEY', settings.apiKey)
        console.log('[Preview] Saved API Key to localStorage')
      }
    }
  },
  
  on: (eventName: string, handler: Function) => {
    if (!handlers[eventName]) handlers[eventName] = []
    handlers[eventName].push(handler)
    console.log(`[Figma Mock] Registered handler for: ${eventName}`)
    return () => {
      handlers[eventName] = handlers[eventName].filter(h => h !== handler)
    }
  }
}

// Expose control functions for manual testing
;(window as any).simulateSelection = () => {
  triggerHandler('SEND_SELECTION_STYLES', {
    selectionNodes: [
      { 
        type: 'FRAME',
        props: { width: 200, height: 100, layout: 'VERTICAL' },
        name: 'MockFrame' 
      }
    ],
    referenceLayout: { width: 390, height: 844 }
  })
  console.log('[Preview] Simulated selection event')
}

;(window as any).toggleTheme = () => {
  const root = document.documentElement
  const current = root.getAttribute('data-theme')
  root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark')
  console.log('[Preview] Toggled theme to:', current === 'dark' ? 'light' : 'dark')
}

console.log('[Preview] Figma mocks initialized, now loading UI...')

// ============================================
// NOW IMPORT UI (after mocks are set up)
// ============================================

// The ui.tsx will call render() which finds #app container
import '../src/ui.tsx'

function withPreviewHarness(action: (harness: any) => void) {
  const harness = (window as any).__GENABLE_PREVIEW_HARNESS__
  if (harness) {
    action(harness)
    return
  }

  setTimeout(() => {
    const retryHarness = (window as any).__GENABLE_PREVIEW_HARNESS__
    if (retryHarness) action(retryHarness)
  }, 300)
}

;(window as any).runFlowSimulation = () => withPreviewHarness((h) => h.runFlowSimulation())
;(window as any).runErrorSimulation = () => withPreviewHarness((h) => h.runErrorSimulation())
;(window as any).resetFlowSimulation = () => withPreviewHarness((h) => h.resetPreview())

// --- Recording replay ---

const BRIDGE_URL = 'http://localhost:3456'

async function fetchRecordings(): Promise<{ id: string; mtime: number; hasEvents: boolean }[]> {
  try {
    const res = await fetch(`${BRIDGE_URL}/recordings`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

async function fetchRecordingEvents(id: string): Promise<any[] | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/recordings/${id}/events`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function populateRecordingDropdown(recordings: { id: string; mtime: number; hasEvents: boolean }[]) {
  const select = document.getElementById('recording-select') as HTMLSelectElement | null
  if (!select) return

  // Clear existing options except the placeholder
  select.innerHTML = '<option value="">-- select recording --</option>'

  const withEvents = recordings.filter(r => r.hasEvents)
  for (const rec of withEvents) {
    const opt = document.createElement('option')
    opt.value = rec.id
    const date = new Date(rec.mtime)
    opt.textContent = `${rec.id} (${date.toLocaleTimeString()})`
    select.appendChild(opt)
  }

  const status = document.getElementById('recording-status')
  if (status) {
    status.textContent = withEvents.length > 0 ? `${withEvents.length} recording(s)` : 'No recordings'
  }
}

;(window as any).refreshRecordings = async () => {
  const recordings = await fetchRecordings()
  populateRecordingDropdown(recordings)
}

;(window as any).replayRecording = async () => {
  const select = document.getElementById('recording-select') as HTMLSelectElement | null
  const speedInput = document.getElementById('replay-speed') as HTMLSelectElement | null
  if (!select?.value) return

  const events = await fetchRecordingEvents(select.value)
  if (!events || events.length === 0) {
    console.warn('[Preview] No events found for recording:', select.value)
    return
  }

  const speed = Number(speedInput?.value ?? '5')
  console.log(`[Preview] Replaying ${events.length} events at ${speed}x speed`)

  withPreviewHarness((h) => {
    h.runEventReplay(events, { speed, prompt: `Replay: ${select.value}` })
  })
}

;(window as any).loadRecordingFile = (input: HTMLInputElement) => {
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    try {
      const events = JSON.parse(reader.result as string)
      if (!Array.isArray(events) || events.length === 0) {
        console.warn('[Preview] Invalid or empty events file')
        return
      }

      const speedInput = document.getElementById('replay-speed') as HTMLSelectElement | null
      const speed = Number(speedInput?.value ?? '5')
      console.log(`[Preview] Replaying ${events.length} events from file at ${speed}x speed`)

      withPreviewHarness((h) => {
        h.runEventReplay(events, { speed, prompt: `File: ${file.name}` })
      })
    } catch (err) {
      console.error('[Preview] Failed to parse events file:', err)
    }
  }
  reader.readAsText(file)
}

// Auto-fetch recordings on load
setTimeout(() => (window as any).refreshRecordings(), 1000)

console.log('[Preview] UI module imported')
