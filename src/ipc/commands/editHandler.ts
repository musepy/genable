/**
 * @file editHandler.ts
 * @description Handler for the `edit` tool — update properties on existing nodes.
 *
 * Supports single node: edit({node: "1:2", props: {bg: "#FFF"}})
 * Supports batch:       edit({nodes: [{node: "1:1", props: {w: "fill"}}, {node: "1:2", props: {w: "fill"}}]})
 *
 * Calls nodeFactory directly — no IR, no executor.
 */

import type { ToolResponse, ToolWarning } from '../../engine/agent/tools/types';
import { resolvePathToNode } from './pathResolver';
import { normalizeProps } from '../../domain/node-normalizers';
import { coerceValue } from '../../engine/utils/prop-dsl';
import { updateNode, normalizeSizingInProps, type NodeResult } from '../../engine/actions/nodeFactory';
import { NodeSerializer } from '../../engine/figma-adapter/nodeSerializer';
import { JsonNodeSerializer } from '../../engine/flat/jsonNodeSerializer';
import { PipelineTracer } from './pipelineTracer';
import type { Warning as HandlerWarning } from '../../engine/actions/handlers/types';

/**
 * Translate a handler-side `Warning` (severity, code, message + extras) to
 * the LLM-facing `ToolWarning` shape (code + extras, message optional).
 * AMBIGUOUS_NAME_AUTOPICK and similar binding warnings cross from the
 * write-pipeline up to the tool response here.
 */
function toToolWarning(w: HandlerWarning): ToolWarning {
  // Severity is dropped from ToolWarning — it's encoded by where the warning
  // sits (warnings[] is non-fatal by definition; errors live in `error`).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { severity, ...rest } = w;
  return rest as ToolWarning;
}

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

/** Apply an edit to a single resolved node. Returns whether any property
 * actually changed AND the warnings the property pipeline raised. Warnings
 * include AMBIGUOUS_NAME_AUTOPICK from variableBindingHandler when a bare-
 * name token resolved to multiple candidates. */
async function applyEdit(
  node: SceneNode,
  props: Record<string, any>,
): Promise<{ changed: boolean; warnings: HandlerWarning[] }> {
  const { regularProps, componentProps } = resolveInstanceProps(node, props);
  const warnings: HandlerWarning[] = [];

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
    if (result.warnings && result.warnings.length > 0) warnings.push(...result.warnings);
    // Fail-safe default: if diffs is missing, assume NOT changed. A missing diff
    // array means we have no evidence of a real write; an optimistic `?? true`
    // would mask silent writes (e.g. a truncated `props: "{…}"` string that
    // gets filtered to zero applied properties).
    const anyChanged = result.diffs?.some(d => d.changed) ?? false;
    return {
      changed: anyChanged || Object.keys(componentProps).length > 0,
      warnings,
    };
  }

  return { changed: Object.keys(componentProps).length > 0, warnings };
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

    const results: Array<{ nodeId: string; name: string; changed: boolean }> = [];
    const errors: string[] = [];
    const aggregatedWarnings: ToolWarning[] = [];

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

      const { changed, warnings: entryWarnings } = await applyEdit(resolved.node, merged);
      // Forward entry's node id with each AMBIGUOUS_NAME_AUTOPICK warning so
      // the runtime can correlate to the bound node when emitting the event.
      for (const w of entryWarnings) {
        const tw = toToolWarning(w);
        if (w.code === 'AMBIGUOUS_NAME_AUTOPICK') {
          (tw as any).node_id = resolved.node.id;
        }
        aggregatedWarnings.push(tw);
      }
      const minimal = NodeSerializer.serializeMinimal(resolved.node, false);
      const minJson = JsonNodeSerializer.serialize(minimal, { minimal: true });
      results.push({ ...minJson, changed });
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
    // `count: 3` and believe all 17 entries succeeded.
    const response: ToolResponse = {
      data: {
        count: results.length,
        results,
        ...(errors.length > 0 ? { errors, partial: true } : {}),
      },
      _stages: tracer.collect(),
    };
    if (aggregatedWarnings.length > 0) response.warnings = aggregatedWarnings;
    return response;
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

  const { changed, warnings } = await applyEdit(resolved.node, merged);

  const minimal = NodeSerializer.serializeMinimal(resolved.node, false);
  const minJson = JsonNodeSerializer.serialize(minimal, { minimal: true });

  const response: ToolResponse = {
    data: { ...minJson, changed },
    _stages: tracer.collect(),
  };
  if (warnings.length > 0) {
    // Tag AMBIGUOUS_NAME_AUTOPICK warnings with the node id we bound on.
    response.warnings = warnings.map(w => {
      const tw = toToolWarning(w);
      if (w.code === 'AMBIGUOUS_NAME_AUTOPICK') (tw as any).node_id = resolved.node.id;
      return tw;
    });
  }
  return response;
}
