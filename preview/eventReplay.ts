/**
 * Event Replay Engine
 *
 * Replays recorded AgentRuntimeEvent[] streams with timing control.
 * Used by the preview harness to visually replay real agent runs.
 */

export interface ReplayOptions {
  /** Speed multiplier: 0 = instant, 1 = realtime, 2-10 = fast forward */
  speed: number
  /** Called for each event during replay */
  onEvent: (event: any) => void
  /** Called when replay finishes */
  onComplete?: () => void
}

export interface ReplayControl {
  pause: () => void
  resume: () => void
  abort: () => void
  readonly state: 'playing' | 'paused' | 'done' | 'aborted'
}

export function replayEvents(events: any[], options: ReplayOptions): ReplayControl {
  const { speed, onEvent, onComplete } = options

  let index = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let controlState: ReplayControl['state'] = 'playing'

  const control: ReplayControl = {
    pause() {
      if (controlState !== 'playing') return
      controlState = 'paused'
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    resume() {
      if (controlState !== 'paused') return
      controlState = 'playing'
      scheduleNext()
    },
    abort() {
      if (controlState === 'done' || controlState === 'aborted') return
      controlState = 'aborted'
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
    get state() {
      return controlState
    },
  }

  function emitEvent() {
    if (controlState !== 'playing' || index >= events.length) return

    onEvent(events[index])
    index++

    if (index >= events.length) {
      controlState = 'done'
      onComplete?.()
      return
    }

    scheduleNext()
  }

  function scheduleNext() {
    if (controlState !== 'playing' || index >= events.length) return

    if (speed === 0) {
      // Instant mode: emit all remaining events synchronously in batches
      while (index < events.length && controlState === 'playing') {
        onEvent(events[index])
        index++
      }
      if (index >= events.length) {
        controlState = 'done'
        onComplete?.()
      }
      return
    }

    // Calculate delay from timestamp delta
    const prevTimestamp = events[index - 1]?.timestamp ?? events[index].timestamp
    const nextTimestamp = events[index].timestamp
    const delta = Math.max(0, nextTimestamp - prevTimestamp)
    const delay = delta / speed

    // Cap individual delays to avoid long waits (e.g., between LLM calls)
    const cappedDelay = Math.min(delay, 2000 / speed)

    timer = setTimeout(emitEvent, cappedDelay)
  }

  // Start immediately with first event
  emitEvent()

  return control
}
