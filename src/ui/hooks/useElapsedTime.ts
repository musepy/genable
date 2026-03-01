import { useState, useEffect } from 'preact/hooks'

export function useElapsedTime(startTime?: number, isRunning: boolean = true, endTime?: number) {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    if (!startTime) {
      setElapsedMs(0)
      return
    }

    if (!isRunning) {
      // Keep displaying the final elapsed time when not running
      if (endTime) {
        setElapsedMs(Math.max(0, endTime - startTime))
      } else {
        setElapsedMs(Math.max(0, Date.now() - startTime))
      }
      return
    }

    // Initial calculation
    setElapsedMs(Math.max(0, Date.now() - startTime))

    // Update every second
    const timer = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startTime))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [startTime, endTime, isRunning])

  if (!startTime) return ''

  const seconds = Math.floor(elapsedMs / 1000)
  
  if (seconds < 60) {
    return `${seconds}s`
  }
  
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}
