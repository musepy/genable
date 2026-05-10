import { describe, it, expect } from 'vitest';
import { probeVision, probeVisionAllColors, summarizeVisionProbe, type ProbeVerdict } from '../visionProbe';
import type { LLMProvider, LLMResponse, LLMGenerateOptions } from '../providers/types';

// Minimal provider stub — visionProbe only calls .generate; ignore the rest.
function makeProvider(canned: string | Error): LLMProvider {
  return {
    name: 'stub',
    async generate(_opts: LLMGenerateOptions): Promise<LLMResponse> {
      if (canned instanceof Error) throw canned;
      return { text: canned } as LLMResponse;
    },
    formatResponse: () => ({ id: 'x', role: 'model', content: [] }),
    formatToolResults: () => ({ id: 'y', role: 'tool', content: [] }),
    getToolSystemInstruction: () => '',
  };
}

describe('visionProbe', () => {
  describe('probeVision (single color)', () => {
    it('grades exact-color match as sees-image', async () => {
      const v = await probeVision(makeProvider('red'), 'red');
      expect(v.kind).toBe('sees-image');
      if (v.kind === 'sees-image') expect(v.observed).toBe('red');
    });

    it('grades wrong-color answer as wrong-color', async () => {
      const v = await probeVision(makeProvider('blue'), 'red');
      expect(v.kind).toBe('wrong-color');
      if (v.kind === 'wrong-color') {
        expect(v.observed).toBe('blue');
        expect(v.expected).toBe('red');
      }
    });

    it('grades hedged answer with no color word as no-color-mention', async () => {
      const v = await probeVision(makeProvider('I see a square shape on a plain background.'), 'red');
      expect(v.kind).toBe('no-color-mention');
    });

    it('grades empty response as silent-drop-suspected', async () => {
      const v = await probeVision(makeProvider(''), 'red');
      expect(v.kind).toBe('silent-drop-suspected');
    });

    it('grades multi-color hedge as no-color-mention (cant pick a winner)', async () => {
      const v = await probeVision(makeProvider('It looks like red or blue, hard to tell.'), 'red');
      expect(v.kind).toBe('no-color-mention');
    });

    it('captures errors as request-failed', async () => {
      const v = await probeVision(makeProvider(new Error('network down')), 'red');
      expect(v.kind).toBe('request-failed');
      if (v.kind === 'request-failed') expect(v.error).toContain('network down');
    });

    it('matches Chinese color words (红/绿/蓝) too', async () => {
      const v1 = await probeVision(makeProvider('红色'), 'red');
      expect(v1.kind).toBe('sees-image');
      const v2 = await probeVision(makeProvider('蓝'), 'blue');
      expect(v2.kind).toBe('sees-image');
    });
  });

  describe('summarizeVisionProbe', () => {
    it('declares vision-capable only when ALL three colors match', () => {
      const allGood: ProbeVerdict[] = [
        { kind: 'sees-image', observed: 'red',   expected: 'red',   rawResponse: 'red'   },
        { kind: 'sees-image', observed: 'green', expected: 'green', rawResponse: 'green' },
        { kind: 'sees-image', observed: 'blue',  expected: 'blue',  rawResponse: 'blue'  },
      ];
      expect(summarizeVisionProbe(allGood)).toEqual({
        visionCapable: true,
        reason: 'all 3/3 colors recognized',
      });
    });

    it('rejects mixed pass/fail as not vision-capable', () => {
      const mixed: ProbeVerdict[] = [
        { kind: 'sees-image',         observed: 'red', expected: 'red',   rawResponse: 'red' },
        { kind: 'wrong-color',        observed: 'red', expected: 'green', rawResponse: 'red' }, // model said "red" for green
        { kind: 'no-color-mention',   expected: 'blue', rawResponse: 'I see a shape' },
      ];
      const out = summarizeVisionProbe(mixed);
      expect(out.visionCapable).toBe(false);
      expect(out.reason).toContain('green=wrong-color');
      expect(out.reason).toContain('blue=no-color-mention');
    });

    it('handles empty results (all probes aborted)', () => {
      expect(summarizeVisionProbe([])).toEqual({ visionCapable: false, reason: 'no probes ran' });
    });
  });

  describe('probeVisionAllColors', () => {
    it('runs three probes sequentially', async () => {
      const calls: string[] = [];
      const provider: LLMProvider = {
        ...makeProvider('red'),
        async generate(opts: LLMGenerateOptions): Promise<LLMResponse> {
          // Inspect the bundled image color marker to know which probe is firing
          const msg = opts.messages[0];
          const img = Array.isArray(msg.content) ? msg.content.find((p: any) => p.type === 'image') : null;
          // We can't tell color from base64 directly in test; use a counter.
          calls.push('probe');
          // Echo expected color so each probe grades sees-image
          const colors = ['red', 'green', 'blue'];
          return { text: colors[calls.length - 1] } as LLMResponse;
        },
      };
      const out = await probeVisionAllColors(provider);
      expect(out.length).toBe(3);
      expect(calls.length).toBe(3);
      expect(summarizeVisionProbe(out).visionCapable).toBe(true);
    });

    it('respects abortSignal between probes', async () => {
      const ctrl = new AbortController();
      let i = 0;
      const provider: LLMProvider = {
        ...makeProvider('red'),
        async generate(_opts: LLMGenerateOptions): Promise<LLMResponse> {
          i++;
          if (i === 1) ctrl.abort(); // cancel after first probe
          return { text: 'red' } as LLMResponse;
        },
      };
      const out = await probeVisionAllColors(provider, ctrl.signal);
      expect(out.length).toBe(1); // stopped early
    });
  });
});
