/**
 * @file editHandler.ts
 * @description Handler for the `edit` tool — update properties on existing nodes.
 *
 * Supports single node: edit({node: "1:2", props: {bg: "#FFF"}})
 * Supports batch:       edit({nodes: [{node: "1:1", props: {w: "fill"}}, {node: "1:2", props: {w: "fill"}}]})
 *
 * Calls nodeFactory directly — no IR, no executor.
 */

import type { ToolResponse } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { normalizeProps } from '../../domain/node-normalizers';
import { coerceValue } from '../../engine/utils/prop-dsl';
import { updateNode, normalizeSizingInProps } from '../../engine/actions/nodeFactory';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { PipelineTracer } from './pipelineTracer';

interface EditEntry {
  node: string;
  props?: Record<string, any>;
  content?: string;
}

/** Build normalized props from raw input. */
function buildNormalizedProps(props?: Record<string, any>, content?: string): Record<string, any> | null {
  const rawProps: Record<string, any> = {};
  if (props && typeof props === 'object') {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      rawProps[key] = typeof value === 'string' ? coerceValue(key, value) : value;
    }
  }

  if (content !== undefined && content !== null) {
    rawProps.characters = String(content);
  }

  if (Object.keys(rawProps).length === 0) return null;

  return normalizeProps(rawProps, {}, () => {});
}

/**
 * On an instance, resolve display-name props (e.g. "Label") to Figma's
 * internal property keys (e.g. "Label#1386:100"), then separate them
 * from regular Figma props (e.g. "bg", "w").
 */
function resolveInstanceProps(
  node: SceneNode,
  props: Record<string, any>,
): { regularProps: Record<string, any>; componentProps: Record<string, string> } {
  const regularProps: Record<string, any> = {};
  const componentProps: Record<string, string> = {};

  if (node.type !== 'INSTANCE') {
    return { regularProps: props, componentProps };
  }

  // Build display-name → internal-key lookup from the instance's property definitions
  const instProps = (node as InstanceNode).componentProperties;
  const keyMap = new Map<string, string>(); // displayName → internalKey
  if (instProps) {
    for (const internalKey of Object.keys(instProps)) {
      const idx = internalKey.indexOf('#');
      const name = idx >= 0 ? internalKey.slice(0, idx) : internalKey;
      keyMap.set(name.toLowerCase(), internalKey);
    }
  }

  for (const [key, value] of Object.entries(props)) {
    // Try matching as component property (by display name)
    const internalKey = keyMap.get(key.toLowerCase());
    if (internalKey) {
      componentProps[internalKey] = String(value);
    } else {
      regularProps[key] = value;
    }
  }

  return { regularProps, componentProps };
}

/** Apply component property overrides on an instance node. */
function applyComponentProps(
  node: InstanceNode,
  componentProps: Record<string, string>,
): string[] {
  const warnings: string[] = [];
  try {
    node.setProperties(componentProps);
  } catch (e: any) {
    warnings.push(`Failed to set component properties: ${e?.message ?? e}`);
  }
  return warnings;
}

/** Apply an edit to a single resolved node. */
async function applyEdit(
  node: SceneNode,
  props: Record<string, any>,
): Promise<{ warnings: string[] }> {
  const { regularProps, componentProps } = resolveInstanceProps(node, props);
  const allWarnings: string[] = [];

  // Apply component property overrides first (instance only)
  if (Object.keys(componentProps).length > 0) {
    allWarnings.push(...applyComponentProps(node as InstanceNode, componentProps));
  }

  // Apply regular Figma properties
  if (Object.keys(regularProps).length > 0) {
    const parentNode = node.parent as SceneNode | null;
    const isText = node.type === 'TEXT';
    normalizeSizingInProps(regularProps, node, parentNode, isText);
    const result = await updateNode(node, regularProps);
    allWarnings.push(...result.warnings.map(w => w.message || String(w)));
  }

  return { warnings: allWarnings };
}

export async function handleEdit(parameters: any): Promise<ToolResponse> {
  const tracer = new PipelineTracer();
  tracer.enter('handleEdit()', 'editHandler.ts');

  // ── Batch mode: nodes array ──
  if (Array.isArray(parameters.nodes)) {
    const entries = parameters.nodes as EditEntry[];
    if (entries.length === 0) {
      return { error: 'Empty nodes array.' };
    }

    const results: Array<{ nodeId: string; name: string; updated: boolean }> = [];
    const errors: string[] = [];
    const allWarnings: string[] = [];

    for (const entry of entries) {
      const ref = entry.node;
      if (!ref) { errors.push('Missing node ref in batch entry'); continue; }

      const resolved = await resolvePathToNode(ref);
      if (!resolved.ok) {
        errors.push(resolved.response.error || `Cannot resolve "${ref}"`);
        continue;
      }
      if (resolved.isPage) { errors.push(`Cannot edit page root (ref: "${ref}")`); continue; }

      const normalized = buildNormalizedProps(entry.props, entry.content);
      if (!normalized) { errors.push(`No props or content for "${ref}"`); continue; }

      const { warnings } = await applyEdit(resolved.node, normalized);
      allWarnings.push(...warnings);
      const minimal = NodeSerializer.serializeMinimal(resolved.node, false);
      const minJson = JsonNodeSerializer.serialize(minimal, { minimal: true });
      results.push({ ...minJson, updated: true });
    }

    tracer.exit({ count: results.length });

    if (results.length === 0) {
      return { error: errors.join('; ') };
    }

    const stderrLines = [
      ...errors.map(e => `[warn] ${e}`),
      ...allWarnings.map(w => `[warn] ${w}`),
    ];

    return {
      data: { updated: results.length, results },
      _stderr: stderrLines.length > 0 ? stderrLines.join('\n') : undefined,
      _stages: tracer.collect(),
    };
  }

  // ── Single mode: node + props/content ──
  const ref = parameters.node || parameters.path;
  const { props, content } = parameters;

  if (!ref) {
    return {
      data: {
        message: 'edit — Update properties on existing nodes.',
        usage: 'edit({node: "1:2", props: {corner: 16, bg: "#FFF"}})',
        batch: 'edit({nodes: [{node: "1:1", props: {w: "fill"}}, {node: "1:2", props: {w: "fill"}}]})',
      },
    };
  }

  const resolved = await resolvePathToNode(ref);
  if (!resolved.ok) return resolved.response;
  if (resolved.isPage) {
    return { error: 'Cannot edit the page root. Specify a node ref.' };
  }

  const normalized = buildNormalizedProps(props, content);
  if (!normalized) {
    return { error: 'No props or content provided.' };
  }

  tracer.exit({ count: 1 });

  const { warnings } = await applyEdit(resolved.node, normalized);
  const _stderr = warnings.length > 0
    ? warnings.map(w => `[warn] ${w}`).join('\n')
    : undefined;

  const minimal = NodeSerializer.serializeMinimal(resolved.node, false);
  const minJson = JsonNodeSerializer.serialize(minimal, { minimal: true });

  return {
    data: { ...minJson, updated: true },
    _stderr,
    _stages: tracer.collect(),
  };
}
