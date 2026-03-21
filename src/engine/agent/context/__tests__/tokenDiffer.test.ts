import { describe, it, expect } from 'vitest';
import { diffTokenSnapshots, TokenSnapshot } from '../tokenDiffer';

const baseSnapshot: TokenSnapshot = {
  colors: {
    'Blue/9': '#3E63DD',
    'Gray/12': '#1C2024',
    'Red/9': '#EF4444',
  },
  fonts: {
    headline: 'Space Grotesk/32/Medium',
    body: 'Inter/16/Regular',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
  },
  timestamp: '2026-03-20T10:00:00Z',
};

describe('diffTokenSnapshots', () => {
  it('returns null when prev is null (first run)', () => {
    const current: TokenSnapshot = { ...baseSnapshot, timestamp: '2026-03-21T10:00:00Z' };
    expect(diffTokenSnapshots(null, current)).toBeNull();
  });

  it('returns null when prev is undefined', () => {
    const current: TokenSnapshot = { ...baseSnapshot, timestamp: '2026-03-21T10:00:00Z' };
    expect(diffTokenSnapshots(undefined, current)).toBeNull();
  });

  it('detects no changes when snapshots are identical', () => {
    const result = diffTokenSnapshots(baseSnapshot, { ...baseSnapshot, timestamp: '2026-03-21T10:00:00Z' });
    expect(result).not.toBeNull();
    expect(result!.hasChanges).toBe(false);
    expect(result!.summary).toBe('No design system changes since last session.');
    expect(result!.added).toEqual([]);
    expect(result!.removed).toEqual([]);
    expect(result!.changed).toEqual([]);
  });

  it('detects color changes', () => {
    const current: TokenSnapshot = {
      ...baseSnapshot,
      colors: { ...baseSnapshot.colors, 'Blue/9': '#2563EB' },
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.hasChanges).toBe(true);
    expect(result.changed).toContain('color: Blue/9 changed from #3E63DD to #2563EB');
  });

  it('detects new colors added', () => {
    const current: TokenSnapshot = {
      ...baseSnapshot,
      colors: { ...baseSnapshot.colors, 'Green/9': '#10B981' },
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.hasChanges).toBe(true);
    expect(result.added).toContain('color: Green/9 (#10B981)');
  });

  it('detects colors removed', () => {
    const { 'Red/9': _, ...remainingColors } = baseSnapshot.colors;
    const current: TokenSnapshot = {
      ...baseSnapshot,
      colors: remainingColors,
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.hasChanges).toBe(true);
    expect(result.removed).toContain('color: Red/9');
  });

  it('detects font changes', () => {
    const current: TokenSnapshot = {
      ...baseSnapshot,
      fonts: { ...baseSnapshot.fonts, headline: 'Poppins/36/Bold' },
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.hasChanges).toBe(true);
    expect(result.changed).toContain('font: headline changed from Space Grotesk/32/Medium to Poppins/36/Bold');
  });

  it('detects spacing changes', () => {
    const current: TokenSnapshot = {
      ...baseSnapshot,
      spacing: { ...baseSnapshot.spacing, md: 24 },
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.hasChanges).toBe(true);
    expect(result.changed).toContain('spacing: md changed from 16px to 24px');
  });

  it('detects multiple changes across categories', () => {
    const current: TokenSnapshot = {
      colors: { 'Blue/9': '#2563EB', 'Gray/12': '#1C2024', 'Green/9': '#10B981' },
      fonts: { headline: 'Poppins/36/Bold', body: 'Inter/16/Regular' },
      spacing: { xs: 4, sm: 8, md: 16, lg: 32 },
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.hasChanges).toBe(true);
    expect(result.added.length).toBeGreaterThanOrEqual(2); // Green/9 + lg
    expect(result.removed.length).toBe(1); // Red/9
    expect(result.changed.length).toBeGreaterThanOrEqual(2); // Blue/9 + headline
  });

  it('builds readable summary', () => {
    const current: TokenSnapshot = {
      ...baseSnapshot,
      colors: { ...baseSnapshot.colors, 'Green/9': '#10B981' },
      timestamp: '2026-03-21T10:00:00Z',
    };
    const result = diffTokenSnapshots(baseSnapshot, current)!;
    expect(result.summary).toContain('Design system changes since last session');
    expect(result.summary).toContain('Added');
  });

  it('handles empty snapshots', () => {
    const empty: TokenSnapshot = { colors: {}, fonts: {}, spacing: {}, timestamp: '2026-03-20T10:00:00Z' };
    const result = diffTokenSnapshots(empty, baseSnapshot)!;
    expect(result.hasChanges).toBe(true);
    expect(result.added.length).toBe(8); // 3 colors + 2 fonts + 3 spacing
  });
});
