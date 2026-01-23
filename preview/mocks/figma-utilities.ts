/**
 * Mock for @create-figma-plugin/utilities
 * 
 * Provides the same API as the real module but stores handlers locally
 * and uses window.__FIGMA_MOCK__ for the actual implementation.
 */

export function emit<T extends readonly any[]>(
  eventName: string,
  ...args: T
): void {
  const mock = (window as any).__FIGMA_MOCK__
  if (mock?.emit) {
    mock.emit(eventName, ...args)
  } else {
    console.warn('[Mock] No mock available for emit:', eventName)
  }
}

export function on<T>(
  eventName: string,
  handler: (data: T) => void
): () => void {
  const mock = (window as any).__FIGMA_MOCK__
  if (mock?.on) {
    return mock.on(eventName, handler)
  } else {
    console.warn('[Mock] No mock available for on:', eventName)
    return () => {}
  }
}

// Other utilities that might be used
export function once<T>(
  eventName: string,
  handler: (data: T) => void
): () => void {
  const unsubscribe = on(eventName, (data: T) => {
    unsubscribe()
    handler(data)
  })
  return unsubscribe
}

export function formatSuccessMessage(message: string): string {
  return message
}

export function formatErrorMessage(message: string): string {
  return message
}

export function showUI(options?: { width?: number; height?: number }): void {
  console.log('[Mock] showUI called', options)
}
