/**
 * Lightweight pipeline stage tracer.
 * Each handler records stages as it executes. The collected stages are
 * attached to the tool result as `_stages`, which survives in
 * runtimeEvents[].toolResult.raw (pre-presentForLLM) and can be read
 * by the dev-bridge dashboard for auto-derived pipeline visualization.
 */

export interface PipelineStage {
  /** Stage label shown in dashboard (e.g. "parseJsx()") */
  label: string
  /** Source file (e.g. "jsxParser.ts") */
  file: string
  /** Wall-clock duration in ms */
  durationMs?: number
  /** Extra metadata (e.g. { opsCount: 12 }) */
  meta?: Record<string, unknown>
}

export class PipelineTracer {
  private stages: PipelineStage[] = []
  private current: { label: string; file: string; start: number } | null = null

  /** Begin timing a stage. Closes any open stage first. */
  enter(label: string, file: string): void {
    this.exit() // auto-close previous
    this.current = { label, file, start: Date.now() }
  }

  /** Close the current stage, recording its duration. */
  exit(meta?: Record<string, unknown>): void {
    if (!this.current) return
    this.stages.push({
      label: this.current.label,
      file: this.current.file,
      durationMs: Date.now() - this.current.start,
      ...(meta ? { meta } : {}),
    })
    this.current = null
  }

  /** Record an instant stage (no timing). */
  mark(label: string, file: string, meta?: Record<string, unknown>): void {
    this.stages.push({ label, file, durationMs: 0, ...(meta ? { meta } : {}) })
  }

  /** Return collected stages. Call after all stages complete. */
  collect(): PipelineStage[] {
    this.exit() // close any dangling stage
    return this.stages
  }
}
