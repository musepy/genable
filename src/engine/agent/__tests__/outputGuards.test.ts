import { describe, it, expect } from 'vitest';
import {
  truncateOverflow,
  isBinaryContent,
  guardBinary,
  MAX_OUTPUT_LINES,
} from '../../agent/tools/unified/outputGuards';

// ── truncateOverflow ─────────────────────────────────────────────

describe('truncateOverflow', () => {
  it('passes through short content unchanged', () => {
    const text = 'line1\nline2\nline3';
    expect(truncateOverflow(text)).toBe(text);
  });

  it('truncates at MAX_OUTPUT_LINES', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const result = truncateOverflow(text);
    const resultLines = result.split('\n');
    // Should have MAX_OUTPUT_LINES + 1 (truncation notice)
    expect(resultLines.length).toBe(MAX_OUTPUT_LINES + 1);
    expect(resultLines[MAX_OUTPUT_LINES]).toContain('+100 lines truncated');
  });

  it('includes hint in truncation message', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `item ${i}`);
    const result = truncateOverflow(lines.join('\n'), 'Use cat -d 2 for overview.');
    expect(result).toContain('Use cat -d 2 for overview.');
  });

  it('does not truncate at exactly MAX_OUTPUT_LINES', () => {
    const lines = Array.from({ length: MAX_OUTPUT_LINES }, (_, i) => `line ${i}`);
    const text = lines.join('\n');
    expect(truncateOverflow(text)).toBe(text);
  });
});

// ── isBinaryContent ──────────────────────────────────────────────

describe('isBinaryContent', () => {
  it('returns false for normal text', () => {
    expect(isBinaryContent('Hello, world!\nThis is normal text.')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBinaryContent('')).toBe(false);
  });

  it('returns true for binary-like content', () => {
    // Create content with many null bytes
    const binary = '\x00\x01\x02\x03\x04\x05\x06\x07\x08' + 'a'.repeat(50);
    expect(isBinaryContent(binary)).toBe(true);
  });

  it('allows tab and newline characters', () => {
    expect(isBinaryContent('col1\tcol2\nval1\tval2\n')).toBe(false);
  });
});

// ── guardBinary ──────────────────────────────────────────────────

describe('guardBinary', () => {
  it('passes through normal text', () => {
    const text = 'Normal text content';
    expect(guardBinary(text)).toBe(text);
  });

  it('replaces binary content with descriptive message', () => {
    const binary = '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x00\x01\x02' + 'a'.repeat(50);
    const result = guardBinary(binary, 182000);
    expect(result).toContain('binary data');
    expect(result).toContain('178KB');
    expect(result).toContain('Use cat -s for screenshot');
  });
});
