import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('FontBus cooldown and diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).figma;
  });

  async function loadFontBus(loadImpl: (font: { family: string; style: string }) => Promise<void>) {
    const loadFontAsync = vi.fn(loadImpl);
    (globalThis as any).figma = { loadFontAsync };
    const mod = await import('../FontBus');
    return { fontBus: mod.fontBus, loadFontAsync };
  }

  it('skips repeated load attempts during cooldown after failure', async () => {
    const { fontBus, loadFontAsync } = await loadFontBus(async () => {
      throw new Error('connection refused');
    });

    expect(await fontBus.getOrLoad('Inter', 'Regular')).toEqual({ success: false, loadedStyle: 'Regular' });
    expect(loadFontAsync).toHaveBeenCalledTimes(1);

    // Cooldown should prevent immediate retry.
    expect(await fontBus.getOrLoad('Inter', 'Regular')).toEqual({ success: false, loadedStyle: 'Regular' });
    expect(loadFontAsync).toHaveBeenCalledTimes(1);

    // After cooldown expires, retry is allowed.
    vi.setSystemTime(new Date('2026-01-01T00:00:31.000Z'));
    expect(await fontBus.getOrLoad('Inter', 'Regular')).toEqual({ success: false, loadedStyle: 'Regular' });
    expect(loadFontAsync).toHaveBeenCalledTimes(2);
  });

  it('deduplicates warning logs during cooldown window', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fontBus } = await loadFontBus(async () => {
      throw new Error('connection refused');
    });

    await fontBus.getOrLoad('Inter', 'Regular');
    await fontBus.getOrLoad('Inter', 'Regular');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('reports degraded health when failures exist', async () => {
    const { fontBus } = await loadFontBus(async (font) => {
      if (font.family === 'Arial') throw new Error('not available');
    });

    expect(await fontBus.getOrLoad('Inter', 'Regular')).toEqual({ success: true, loadedStyle: 'Regular' });
    expect(await fontBus.getOrLoad('Arial', 'Regular')).toEqual({ success: false, loadedStyle: 'Regular' });

    const health = fontBus.getHealth();
    expect(health.loadedCount).toBeGreaterThanOrEqual(1);
    expect(health.failedCount).toBeGreaterThanOrEqual(1);
    expect(health.degraded).toBe(true);
  });
});
