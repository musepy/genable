import { describe, it, expect } from 'vitest';
import {
  computeExitCode,
  formatTiming,
  formatMeta,
  extractStderr,
  truncateOverflow,
  isBinaryContent,
  guardBinary,
  EXIT_SUCCESS,
  EXIT_ERROR,
  EXIT_NOT_FOUND,
  MAX_OUTPUT_LINES,
} from '../../agent/tools/unified/exitCode';

// ── computeExitCode ──────────────────────────────────────────────

describe('computeExitCode', () => {
  it('returns 0 for success', () => {
    expect(computeExitCode({ data: {} })).toBe(EXIT_SUCCESS);
  });

  it('returns 0 when success is not explicitly false', () => {
    expect(computeExitCode({ data: 'hello' })).toBe(EXIT_SUCCESS);
  });

  it('returns 1 for generic errors', () => {
    expect(computeExitCode({ error: { code: 'EXEC_ERROR', message: 'fail' } })).toBe(EXIT_ERROR);
  });

  it('returns 127 for UNKNOWN_COMMAND', () => {
    expect(computeExitCode({ error: { code: 'UNKNOWN_COMMAND', message: 'not found' } })).toBe(EXIT_NOT_FOUND);
  });

  it('returns 127 for PATH_NOT_FOUND', () => {
    expect(computeExitCode({ error: { code: 'PATH_NOT_FOUND', message: 'no path' } })).toBe(EXIT_NOT_FOUND);
  });

  it('returns 127 for NODE_NOT_FOUND', () => {
    expect(computeExitCode({ error: { code: 'NODE_NOT_FOUND', message: 'no node' } })).toBe(EXIT_NOT_FOUND);
  });

  it('returns 127 for NO_TOOL_EXECUTOR', () => {
    expect(computeExitCode({ error: { code: 'NO_TOOL_EXECUTOR', message: 'no exec' } })).toBe(EXIT_NOT_FOUND);
  });

  it('returns 1 for null result', () => {
    expect(computeExitCode(null)).toBe(EXIT_ERROR);
  });

  it('returns 1 for error without code', () => {
    expect(computeExitCode({ error: { message: 'something broke' } })).toBe(EXIT_ERROR);
  });
});

// ── formatTiming ─────────────────────────────────────────────────

describe('formatTiming', () => {
  it('formats milliseconds for fast ops', () => {
    expect(formatTiming(12)).toBe('12ms');
    expect(formatTiming(0)).toBe('0ms');
    expect(formatTiming(999)).toBe('999ms');
  });

  it('formats seconds for slow ops', () => {
    expect(formatTiming(1000)).toBe('1.0s');
    expect(formatTiming(3200)).toBe('3.2s');
    expect(formatTiming(45000)).toBe('45.0s');
  });

  it('shows one decimal place for seconds', () => {
    expect(formatTiming(1234)).toBe('1.2s');
    expect(formatTiming(10567)).toBe('10.6s');
  });
});

// ── formatMeta ───────────────────────────────────────────────────

describe('formatMeta', () => {
  it('formats success with fast timing', () => {
    expect(formatMeta(0, 12)).toBe('[exit:0 | 12ms]');
  });

  it('formats error with slow timing', () => {
    expect(formatMeta(1, 3200)).toBe('[exit:1 | 3.2s]');
  });

  it('formats not-found', () => {
    expect(formatMeta(127, 0)).toBe('[exit:127 | 0ms]');
  });
});

// ── extractStderr ────────────────────────────────────────────────

describe('extractStderr', () => {
  it('returns null when no warnings or errors', () => {
    expect(extractStderr({ data: {} })).toBeNull();
  });

  it('extracts warnings', () => {
    const result = { data: { warnings: ['font not loaded', 'opacity clamped'] } };
    const stderr = extractStderr(result);
    expect(stderr).toContain('[warn] font not loaded');
    expect(stderr).toContain('[warn] opacity clamped');
  });

  it('extracts violations', () => {
    const result = { data: { violations: [{ message: 'layout conflict' }] } };
    expect(extractStderr(result)).toContain('[warn] layout conflict');
  });

  it('extracts error message from failed result', () => {
    const result = { error: { message: 'Node not found' } };
    expect(extractStderr(result)).toContain('[error] Node not found');
  });

  it('combines warnings and errors', () => {
    const result = {
      error: { message: 'Failed' },
      data: { warnings: ['partial save'] },
    };
    const stderr = extractStderr(result)!;
    expect(stderr).toContain('[warn] partial save');
    expect(stderr).toContain('[error] Failed');
  });
});

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
