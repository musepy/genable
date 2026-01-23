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
            { name: 'gemini-2.5-flash-preview-05-20', displayName: 'Gemini 2.5 Flash Preview' },
            { name: 'gemini-2.5-pro-preview-05-06', displayName: 'Gemini 2.5 Pro Preview' },
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

console.log('[Preview] UI module imported')
