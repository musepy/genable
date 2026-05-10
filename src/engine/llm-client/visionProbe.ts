/**
 * @file visionProbe.ts
 * @description Empirical vision-capability probe for an LLM provider/model.
 *
 * Why this exists — the static MODEL_QUIRKS table catches models that 400 the
 * request outright (DeepSeek, Xiaomi mimo-v2.5-pro). It CANNOT catch models
 * that accept image_url at the wire layer but never actually process the
 * image (silent drop). glm-5/5.1 are the prime suspects: they returned 200 OK
 * with an image attached during the 2026-05-10 sweep, but with a 1×1 PNG no
 * meaningful conclusion was possible.
 *
 * The only way to settle silent-drop is to send a real image with a
 * discriminative prompt and grade the response. This module ships three 64×64
 * solid-color PNGs (red / green / blue, all under 200 bytes base64) and a
 * grading function. Recommended use: invoke from `/multi-provider-compat-test`
 * skill, dev-bridge debug endpoint, or developer tooling — NOT from the
 * regular validate-provider probe (it would burn tokens on every key save).
 *
 * Non-goals: this probe doesn't exercise text streaming, tool calls, or
 * multi-turn behaviors. It answers exactly one question: "does this model see
 * the image we sent it?"
 */

import type { LLMProvider, LLMGenerateOptions, LLMMessage } from './providers/types';

// ─────────────────────────────────────────────────────────────────────────────
// Probe images — 64×64 solid-color PNGs encoded inline. Generated 2026-05-10
// via a Python helper (struct + zlib). Re-generate via the /tools/visionProbe
// recipe in the skill SOP if you ever need different colors / sizes.
//
// Why 64×64: smaller (1×1, 8×8) is rejected by some vendors' image
// preprocessors (Kimi reported `prepare image failed`, mimo-v2-omni reported
// `Multimodal data is corrupted`). 64×64 is large enough to pass validation
// while keeping the base64 payload trivial (≈180 bytes each).
// ─────────────────────────────────────────────────────────────────────────────

const PROBE_IMAGES = {
  red:   'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsKZeS0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEDgsqnc8OJg6Ln3AAAAAElFTkSuQmCC',
  green: 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAATElEQVR42u3PQQkAAAgAseufzFhG8C0MVmA1/SYgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcFncr4C1OHup8AAAAABJRU5ErkJggg==',
  blue:  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAS0lEQVR42u3PQQkAAAgAsetfWiP4FgYrsGqeExAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA4LMf88OL0EKXAAAAAAElFTkSuQmCC',
} as const;

type ProbeColor = keyof typeof PROBE_IMAGES;

const PROBE_PROMPT =
  'You are looking at a single solid-color image. ' +
  'What primary color is it? Answer with exactly one word: red, green, blue, or other. No explanation.';

// ─────────────────────────────────────────────────────────────────────────────
// Grading
// ─────────────────────────────────────────────────────────────────────────────

export type ProbeVerdict =
  | { kind: 'sees-image'; observed: ProbeColor; expected: ProbeColor; rawResponse: string }
  | { kind: 'wrong-color'; observed: ProbeColor; expected: ProbeColor; rawResponse: string }
  | { kind: 'no-color-mention'; expected: ProbeColor; rawResponse: string }
  | { kind: 'silent-drop-suspected'; expected: ProbeColor; rawResponse: string }
  | { kind: 'request-failed'; expected: ProbeColor; error: string };

const COLOR_PATTERNS: Record<ProbeColor, RegExp> = {
  red:   /\bred\b|红|赤/i,
  green: /\bgreen\b|绿/i,
  blue:  /\bblue\b|蓝|青/i,
};

function gradeResponse(expected: ProbeColor, raw: string): ProbeVerdict {
  const text = (raw || '').trim();
  if (!text) {
    return { kind: 'silent-drop-suspected', expected, rawResponse: text };
  }
  const matches = (Object.keys(COLOR_PATTERNS) as ProbeColor[]).filter(c => COLOR_PATTERNS[c].test(text));

  if (matches.length === 1) {
    return matches[0] === expected
      ? { kind: 'sees-image', observed: matches[0], expected, rawResponse: text }
      : { kind: 'wrong-color', observed: matches[0], expected, rawResponse: text };
  }
  // Zero or multiple color words → model probably hedged ("I see a square")
  // or didn't actually look at the image. Treat as no signal.
  return { kind: 'no-color-mention', expected, rawResponse: text };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a single vision probe. Picks `red` by default (highest-contrast common
 * color); pass a different color to vary. Returns a structured verdict —
 * caller decides how to act on it.
 */
export async function probeVision(
  provider: LLMProvider,
  expected: ProbeColor = 'red',
  abortSignal?: AbortSignal,
): Promise<ProbeVerdict> {
  const message: LLMMessage = {
    id: `vision-probe-${expected}-${Date.now()}`,
    role: 'user',
    content: [
      { type: 'text', text: PROBE_PROMPT },
      { type: 'image', mimeType: 'image/png', data: PROBE_IMAGES[expected] },
    ],
  };

  const opts: LLMGenerateOptions = {
    messages: [message],
    temperature: 0,
    maxTokens: 32,
    abortSignal,
  };

  try {
    const response = await provider.generate(opts);
    return gradeResponse(expected, response.text || '');
  } catch (err: any) {
    return {
      kind: 'request-failed',
      expected,
      error: (err?.message || String(err)).slice(0, 300),
    };
  }
}

/**
 * Run probes for all three colors. A model that sees red but fails on blue is
 * suspicious — single-color confirmation could be lucky guess based on
 * context. Three-of-three matches gives high confidence in real vision.
 *
 * Returns an array of verdicts (one per color). Caller summarizes.
 */
export async function probeVisionAllColors(
  provider: LLMProvider,
  abortSignal?: AbortSignal,
): Promise<ProbeVerdict[]> {
  const colors: ProbeColor[] = ['red', 'green', 'blue'];
  const results: ProbeVerdict[] = [];
  for (const c of colors) {
    if (abortSignal?.aborted) break;
    results.push(await probeVision(provider, c, abortSignal));
  }
  return results;
}

/**
 * Reduce a 3-color sweep to a single boolean conclusion.
 * Conservative: requires ALL THREE to grade `sees-image` to declare vision-capable.
 */
export function summarizeVisionProbe(results: ProbeVerdict[]): {
  visionCapable: boolean;
  reason: string;
} {
  if (results.length === 0) return { visionCapable: false, reason: 'no probes ran' };
  const seesAll = results.every(r => r.kind === 'sees-image');
  if (seesAll) return { visionCapable: true, reason: `all ${results.length}/${results.length} colors recognized` };

  const breakdown = results
    .map(r => `${r.expected}=${r.kind}`)
    .join(', ');
  return { visionCapable: false, reason: breakdown };
}
