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
import { updateNode, normalizeSizingInProps, type NodeResult } from '../../engine/actions/nodeFactory';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { PipelineTracer } from './pipelineTracer';

interface EditEntry {
  node: string;
  props?: Record<string, any>;
  content?: string;
}

/**
 * Split props into component props (by display name) and regular props,
 * BEFORE normalization. Component props bypass normalizeProps' unknown-prop filter.
 */
function splitComponentProps(
  node: SceneNode,
  props: Record<string, any> | undefined,
): { componentPropsRaw: Record<string, any>; remainingProps: Record<string, any> } {
  if (!props || node.type !== 'INSTANCE') {
    return { componentPropsRaw: {}, remainingProps: props || {} };
  }
  const instProps = (node as InstanceNode).componentProperties;
  const keyMap = new Set<string>();
  if (instProps) {
    for (const internalKey of Object.keys(instProps)) {
      const idx = internalKey.indexOf('#');
      const name = idx >= 0 ? internalKey.slice(0, idx) : internalKey;
      keyMap.add(name.toLowerCase());
    }
  }
  const componentPropsRaw: Record<string, any> = {};
  const remainingProps: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    if (keyMap.has(key.toLowerCase())) {
      componentPropsRaw[key] = value;
    } else {
      remainingProps[key] = value;
    }
  }
  return { componentPropsRaw, remainingProps };
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
): void {
  try {
    node.setProperties(componentProps);
  } catch {
    // non-fatal
  }
}

/** Apply an edit to a single resolved node. Returns true if any property actually changed. */
async function applyEdit(
  node: SceneNode,
  props: Record<string, any>,
): Promise<boolean> {
  const { regularProps, componentProps } = resolveInstanceProps(node, props);

  // Apply component property overrides first (instance only)
  if (Object.keys(componentProps).length > 0) {
    applyComponentProps(node as InstanceNode, componentProps);
  }

  // Apply regular Figma properties
  if (Object.keys(regularProps).length > 0) {
    const parentNode = node.parent as SceneNode | null;
    const isText = node.type === 'TEXT';
    normalizeSizingInProps(regularProps, node, parentNode, isText);
    const result: NodeResult = await updateNode(node, regularProps);
    // Fail-safe default: if diffs is missing, assume NOT changed. A missing diff
    // array means we have no evidence of a real write; an optimistic `?? true`
    // would mask silent writes (e.g. a truncated `props: "{…}"` string that
    // gets filtered to zero applied properties).
    const anyChanged = result.diffs?.some(d => d.changed) ?? false;
    return anyChanged || Object.keys(componentProps).length > 0;
  }

  return Object.keys(componentProps).length > 0;
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

    for (const entry of entries) {
      const ref = entry.node;
      if (!ref) { errors.push('Missing node ref in batch entry'); continue; }

      const resolved = await resolvePathToNode(ref);
      if (!resolved.ok) {
        errors.push(resolved.response.error || `Cannot resolve "${ref}"`);
        continue;
      }
      if (resolved.isPage) { errors.push(`Cannot edit page root (ref: "${ref}")`); continue; }

      const { componentPropsRaw, remainingProps } = splitComponentProps(resolved.node, entry.props);
      const normalized = buildNormalizedProps(remainingProps, entry.content);
      const merged = { ...(normalized || {}), ...componentPropsRaw };
      if (Object.keys(merged).length === 0) { errors.push(`No props or content for "${ref}"`); continue; }

      const changed = await applyEdit(resolved.node, merged);
      const minimal = NodeSerializer.serializeMinimal(resolved.node, false);
      const minJson = JsonNodeSerializer.serialize(minimal, { minimal: true });
      results.push({ ...minJson, updated: changed });
    }

    tracer.exit({ count: results.length });

    if (results.length === 0) {
      return { error: errors.join('; ') };
    }

    // Partial-failure propagation: when SOME entries applied but others failed
    // (e.g. "No props or content" on a truncated {…} placeholder that slipped
    // past the hook guard), surface the per-entry errors alongside the results
    // so the LLM sees which entries failed and can retry only those. Dropping
    // `errors[]` here was the "silent partial success" bug — the LLM would see
    // `updated: 3` and believe all 17 entries succeeded.
    return {
      data: {
        updated: results.length,
        results,
        ...(errors.length > 0 ? { errors, partial: true } : {}),
      },
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

  const { componentPropsRaw, remainingProps } = splitComponentProps(resolved.node, props);
  const normalized = buildNormalizedProps(remainingProps, content);
  const merged = { ...(normalized || {}), ...componentPropsRaw };
  if (Object.keys(merged).length === 0) {
    return { error: 'No props or content provided.' };
  }

  tracer.exit({ count: 1 });

  const changed = await applyEdit(resolved.node, merged);

  const minimal = NodeSerializer.serializeMinimal(resolved.node, false);
  const minJson = JsonNodeSerializer.serialize(minimal, { minimal: true });

  return {
    data: { ...minJson, updated: changed },
    _stages: tracer.collect(),
  };
}
