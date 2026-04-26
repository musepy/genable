/**
 * @file setterAdapter.test.ts
 * @description Tests that setter adapters correctly translate typed params
 * into edit-compatible params and validate required fields.
 *
 * These tests mock handleEdit to verify parameter translation only —
 * actual Figma API calls are NOT tested here (see TESTING.md).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock editHandler before importing setterAdapter
vi.mock('../editHandler', () => ({
  handleEdit: vi.fn(async (params: any) => ({
    data: { updated: 1, _passedParams: params },
  })),
}));

import { handleSetText, handleSetFill, handleSetStroke, handleSetLayout } from '../index';
import { handleEdit } from '../editHandler';

const mockHandleEdit = vi.mocked(handleEdit);

beforeEach(() => {
  mockHandleEdit.mockClear();
});

// ── set_text ────────────────────────────────────────────────────────────────

describe('handleSetText', () => {
  it('single node → delegates as edit({node, content})', async () => {
    await handleSetText({ node: '1:2', text: 'Hello' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      content: 'Hello',
    });
  });

  it('batch nodes → delegates as edit({nodes: [{node, content}]})', async () => {
    await handleSetText({
      nodes: [
        { node: '1:2', text: 'Title' },
        { node: '1:3', text: 'Subtitle' },
      ],
    });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      nodes: [
        { node: '1:2', content: 'Title' },
        { node: '1:3', content: 'Subtitle' },
      ],
    });
  });

  it('missing node → returns error, does not call handleEdit', async () => {
    const result = await handleSetText({ text: 'Hello' });

    expect(result.error).toContain('node');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('missing text → returns error', async () => {
    const result = await handleSetText({ node: '1:2' });

    expect(result.error).toContain('text');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('coerces text to string', async () => {
    await handleSetText({ node: '1:2', text: 42 });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      content: '42',
    });
  });
});

// ── set_fill ────────────────────────────────────────────────────────────────

describe('handleSetFill', () => {
  it('bg only → delegates as edit({node, props: {bg}})', async () => {
    await handleSetFill({ node: '1:2', bg: '#F5F5F5' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { bg: '#F5F5F5' },
    });
  });

  it('fill only → delegates with fill prop', async () => {
    await handleSetFill({ node: '1:2', fill: '#333' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { fill: '#333' },
    });
  });

  it('fill + bg together', async () => {
    await handleSetFill({ node: '1:2', fill: '#FFF', bg: '#1A1A1A' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { fill: '#FFF', bg: '#1A1A1A' },
    });
  });

  it('missing node → error', async () => {
    const result = await handleSetFill({ bg: '#FFF' });

    expect(result.error).toContain('node');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });

  it('no color params → error', async () => {
    const result = await handleSetFill({ node: '1:2' });

    expect(result.error).toContain('fill');
    expect(mockHandleEdit).not.toHaveBeenCalled();
  });
});

// ── set_stroke ──────────────────────────────────────────────────────────────

describe('handleSetStroke', () => {
  it('shorthand string → delegates as edit({node, props: {stroke}})', async () => {
    await handleSetStroke({ node: '1:2', stroke: '1 #E0E0E0' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 #E0E0E0' },
    });
  });

  it('explicit fields → composes shorthand string', async () => {
    await handleSetStroke({ node: '1:2', color: '#E0E0E0', weight: 1, align: 'inside' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '1 #E0E0E0 inside' },
    });
  });

  it('color only → composes shorthand with just color', async () => {
    await handleSetStroke({ node: '1:2', color: '#333' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { stroke: '#333' },
    });
  });

  it('missing node → error', async () => {
    const result = await handleSetStroke({ stroke: '1 #E0E0E0' });

    expect(result.error).toContain('node');
  });

  it('no stroke params → error', async () => {
    const result = await handleSetStroke({ node: '1:2' });

    expect(result.error).toContain('stroke');
  });
});

// ── set_layout ──────────────────────────────────────────────────────────────

describe('handleSetLayout', () => {
  it('gap + padding → delegates as edit({node, props})', async () => {
    await handleSetLayout({ node: '1:2', gap: 16, p: 24 });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { gap: 16, p: 24 },
    });
  });

  it('full layout config', async () => {
    await handleSetLayout({
      node: '1:2',
      layout: 'row',
      justify: 'space-between',
      align: 'center',
      gap: 8,
    });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { layout: 'row', justify: 'space-between', align: 'center', gap: 8 },
    });
  });

  it('wrap only', async () => {
    await handleSetLayout({ node: '1:2', wrap: 'wrap' });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { wrap: 'wrap' },
    });
  });

  it('missing node → error', async () => {
    const result = await handleSetLayout({ gap: 16 });

    expect(result.error).toContain('node');
  });

  it('no layout params → error', async () => {
    const result = await handleSetLayout({ node: '1:2' });

    expect(result.error).toContain('layout');
  });

  it('ignores undefined params — only passes what was provided', async () => {
    await handleSetLayout({ node: '1:2', gap: 0 });

    expect(mockHandleEdit).toHaveBeenCalledWith({
      node: '1:2',
      props: { gap: 0 },
    });
  });
});
