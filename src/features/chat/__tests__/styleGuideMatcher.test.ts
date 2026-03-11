import { describe, expect, it } from 'vitest';
import { matchStyleGuide, normalizeStyleTags } from '../styleGuideMatcher';

const guides = {
  'corporate-blue-light': {
    tags: ['light-mode', 'corporate', 'clean', 'blue-accent', 'webapp', 'shadows', 'rounded'],
    content: 'corporate',
  },
  'fintech-dark': {
    tags: ['dark-mode', 'fintech', 'dashboard', 'crisp', 'blue-accent', 'monochrome', 'webapp'],
    content: 'fintech',
  },
  'terminal-dark': {
    tags: ['dark-mode', 'developer', 'monospace', 'sharp-corners', 'green-accent', 'minimal', 'dashboard'],
    content: 'terminal',
  },
  'warm-organic': {
    tags: ['light-mode', 'warm', 'organic', 'earth-tones', 'rounded', 'soft', 'wellness'],
    content: 'warm',
  },
};

describe('styleGuideMatcher', () => {
  it('normalizes and deduplicates query tags', () => {
    expect(normalizeStyleTags(' clean, Dashboard, clean ,dark-mode ')).toEqual([
      'clean',
      'dashboard',
      'dark-mode',
    ]);
  });

  it('prioritizes high-signal use-case tags over generic overlap', () => {
    const match = matchStyleGuide('minimal, dashboard, dark-mode', guides);
    expect(match?.name).toBe('terminal-dark');
  });

  it('matches the most relevant light webapp style for generic enterprise tags', () => {
    const match = matchStyleGuide('clean, minimal, rounded, light-mode', guides);
    expect(match?.name).toBe('corporate-blue-light');
  });

  it('uses a deterministic alphabetical tie-break when scores are equal', () => {
    const match = matchStyleGuide('light-mode', {
      alpha: { tags: ['light-mode'], content: 'a' },
      beta: { tags: ['light-mode'], content: 'b' },
    });
    expect(match?.name).toBe('alpha');
  });

  it('returns null when no guide matches any requested tag', () => {
    expect(matchStyleGuide('neon, brutalist', guides)).toBeNull();
  });
});
