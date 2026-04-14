/**
 * @file propertyDependencies.ts
 * @description Figma property dependency graph.
 *
 * Single source of truth for:
 * - Property prerequisite VALIDATION (which properties require which gates)
 * - Property auto-FIX (inject missing gate properties)
 * - Property application ORDER (derived via topological sort)
 *
 * Derived from plugin-api.d.ts Mixin analysis (AutoLayoutMixin, GeometryMixin,
 * BlendMixin, CornerMixin, NonResizableTextMixin, etc.).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

type Condition =
  | { readonly op: '!='; readonly value: string }
  | { readonly op: '=='; readonly value: string }
  | { readonly op: '>'; readonly value: number }
  | { readonly op: 'truthy' }
  | { readonly op: 'nonEmpty' };

/** A property name, or a property name gated on a specific value */
type Dependent =
  | string
  | { readonly property: string; readonly whenValue: string };

/**
 * Inject value — either a literal or a resolver that sees which dependents
 * actually triggered the gate miss. Used to infer direction (HORIZONTAL vs
 * VERTICAL) from what the agent wrote.
 */
type Injector = unknown | ((triggered: ReadonlySet<string>) => unknown);

interface DependencyRule {
  /** The gate property that must satisfy `condition` */
  readonly gate: string;
  /** Whether the gate lives on this node or the parent node */
  readonly scope: 'self' | 'parent';
  /** Condition the gate must satisfy */
  readonly condition: Condition;
  /** Value (or resolver) to auto-inject when gate is absent from both ops and node. Undefined = warn only. */
  readonly inject?: Injector;
  /** Properties that require this gate */
  readonly dependents: readonly Dependent[];
}

interface ExecutionOrderRule {
  /** Property that must be applied first */
  readonly before: string;
  /** Properties that must be applied after `before` */
  readonly after: readonly string[];
}

// ─── State Dependencies ──────────────────────────────────────────────────────
// Rule: if any `dependent` is being set, `gate` must satisfy `condition`.
// Self-scope gates can be auto-fixed via `inject`; parent-scope gates can only warn.

export const DEPENDENCY_RULES: readonly DependencyRule[] = [
  // ── Grid container (GridLayoutMixin) ───────────────────────────────────
  // Grid-only properties require layoutMode='GRID'. Placed BEFORE the generic
  // layoutMode!=NONE rule so GRID wins when the agent mixes grid-specific
  // props with generic auto-layout props — otherwise the generic rule would
  // inject VERTICAL first and the grid rule would then just warn.
  {
    gate: 'layoutMode',
    scope: 'self',
    condition: { op: '==', value: 'GRID' },
    inject: 'GRID',
    dependents: [
      'gridRowCount', 'gridColumnCount',
      'gridRowGap', 'gridColumnGap',
      'gridRowSizes', 'gridColumnSizes',
    ],
  },

  // ── Grid child (GridChildrenMixin) ─────────────────────────────────────
  // Grid child properties require parent layoutMode='GRID'. Parent-scope —
  // warn only, can't auto-fix from the child's position.
  {
    gate: 'layoutMode',
    scope: 'parent',
    condition: { op: '==', value: 'GRID' },
    dependents: [
      'gridRowSpan', 'gridColumnSpan',
      'gridChildHorizontalAlign', 'gridChildVerticalAlign',
    ],
  },

  // ── Auto Layout (AutoLayoutMixin) ──────────────────────────────────────
  // All auto-layout properties require layoutMode to be active.
  // Inject direction inferred from triggered dependents:
  //   align-only (primary/counter) → HORIZONTAL (CSS row flow)
  //   anything else (padding/gap/sizing) → VERTICAL (Figma default)
  // Rationale: `align="center"` with a hard-coded VERTICAL default centered
  // only horizontally. HORIZONTAL matches the "center in a row" intent when
  // alignment is the only signal; non-align deps carry no direction hint and
  // keep the Figma-side default.
  {
    gate: 'layoutMode',
    scope: 'self',
    condition: { op: '!=', value: 'NONE' },
    inject: (triggered: ReadonlySet<string>) => {
      const alignDeps = new Set(['primaryAxisAlignItems', 'counterAxisAlignItems']);
      for (const d of triggered) {
        if (!alignDeps.has(d)) return 'VERTICAL';
      }
      return 'HORIZONTAL';
    },
    dependents: [
      'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
      'itemSpacing',
      'primaryAxisSizingMode', 'counterAxisSizingMode',
      'primaryAxisAlignItems', 'counterAxisAlignItems',
      'layoutWrap', 'itemReverseZIndex', 'strokesIncludedInLayout',
      { property: 'layoutSizingHorizontal', whenValue: 'HUG' },
      { property: 'layoutSizingVertical', whenValue: 'HUG' },
    ],
  },

  // ── Wrap (AutoLayoutMixin) ─────────────────────────────────────────────
  // counterAxisSpacing/AlignContent only apply when wrap is enabled.
  {
    gate: 'layoutWrap',
    scope: 'self',
    condition: { op: '==', value: 'WRAP' },
    inject: 'WRAP',
    dependents: ['counterAxisSpacing', 'counterAxisAlignContent'],
  },

  // ── Child in Auto Layout (AutoLayoutChildrenMixin) ─────────────────────
  // These child properties are only meaningful when parent has auto-layout.
  {
    gate: 'layoutMode',
    scope: 'parent',
    condition: { op: '!=', value: 'NONE' },
    dependents: [
      'layoutAlign', 'layoutGrow', 'layoutPositioning',
      { property: 'layoutSizingHorizontal', whenValue: 'FILL' },
      { property: 'layoutSizingVertical', whenValue: 'FILL' },
    ],
  },

  // ── Strokes (MinimalStrokesMixin + GeometryMixin) ──────────────────────
  // Stroke styling properties have no visible effect without a stroke paint.
  {
    gate: 'strokes',
    scope: 'self',
    condition: { op: 'nonEmpty' },
    dependents: [
      'strokeWeight', 'strokeAlign', 'strokeJoin', 'strokeCap', 'dashPattern',
      'strokeTopWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeRightWeight',
    ],
  },

  // ── Stroke Miter (GeometryMixin) ───────────────────────────────────────
  {
    gate: 'strokeJoin',
    scope: 'self',
    condition: { op: '==', value: 'MITER' },
    dependents: ['strokeMiterLimit'],
  },

  // ── Mask (BlendMixin) ──────────────────────────────────────────────────
  {
    gate: 'isMask',
    scope: 'self',
    condition: { op: 'truthy' },
    dependents: ['maskType'],
  },

  // ── Corner Smoothing (CornerMixin) ─────────────────────────────────────
  {
    gate: 'cornerRadius',
    scope: 'self',
    condition: { op: '>', value: 0 },
    dependents: ['cornerSmoothing'],
  },

  // ── Text Truncation (TextNode) ─────────────────────────────────────────
  {
    gate: 'textTruncation',
    scope: 'self',
    condition: { op: '==', value: 'ENDING' },
    dependents: ['maxLines'],
  },
];

// ─── Execution Order ─────────────────────────────────────────────────────────
// API-level constraints: `before` must be applied before `after`.
// Not state prerequisites — just ordering for correct Figma API calls.

export const EXECUTION_ORDER: readonly ExecutionOrderRule[] = [
  // Layout structure established before resize
  { before: 'layoutMode', after: ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'] },
  // resize() resets primaryAxisSizingMode/counterAxisSizingMode to FIXED.
  // Must call resize BEFORE setting sizing modes, otherwise HUG/FILL gets overwritten.
  // See: figma-plugin-api-gotchas.md #1
  { before: 'width', after: ['primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutSizingHorizontal', 'layoutSizingVertical'] },
  { before: 'height', after: ['primaryAxisSizingMode', 'counterAxisSizingMode', 'layoutSizingHorizontal', 'layoutSizingVertical'] },
  // Font must be loaded before setting characters (Figma API throws otherwise)
  { before: 'fontName', after: ['characters'] },
  { before: 'fontSize', after: ['characters'] },
  { before: 'fontWeight', after: ['characters'] },
  // resize() can reset textAutoResize — apply dimensions first
  { before: 'width', after: ['textAutoResize'] },
  { before: 'height', after: ['textAutoResize'] },
];

// ─── Derived: Property Application Order ─────────────────────────────────────
// Topological sort of the dependency + execution order graphs.
// Gate properties get lower tiers (applied first); dependents get higher tiers.

function buildPropertyOrder(): Record<string, number> {
  const edges = new Map<string, Set<string>>();
  const allProps = new Set<string>();

  const addEdge = (from: string, to: string) => {
    allProps.add(from);
    allProps.add(to);
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };

  // State dependencies: gate → dependents (self-scope only — parent scope doesn't affect ordering)
  for (const rule of DEPENDENCY_RULES) {
    if (rule.scope !== 'self') continue;
    for (const dep of rule.dependents) {
      addEdge(rule.gate, typeof dep === 'string' ? dep : dep.property);
    }
  }

  // Execution order
  for (const rule of EXECUTION_ORDER) {
    for (const after of rule.after) {
      addEdge(rule.before, after);
    }
  }

  // Kahn's algorithm — assign tier by BFS level
  const inDegree = new Map<string, number>();
  for (const p of allProps) inDegree.set(p, 0);
  for (const [, targets] of edges) {
    for (const t of targets) {
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
    }
  }

  const order: Record<string, number> = {};
  let tier = 0;
  let queue = [...allProps].filter(p => inDegree.get(p) === 0);

  while (queue.length > 0) {
    const next: string[] = [];
    for (const p of queue) {
      order[p] = tier;
      for (const dep of edges.get(p) ?? []) {
        const deg = inDegree.get(dep)! - 1;
        inDegree.set(dep, deg);
        if (deg === 0) next.push(dep);
      }
    }
    tier++;
    queue = next;
  }

  return order;
}

export const PROPERTY_ORDER = buildPropertyOrder();

/** Default tier for properties not in the dependency graph (fills, opacity, etc.) */
export const DEFAULT_TIER = 1;

/** Sort property entries by dependency-derived order. */
export function sortByPropertyOrder(entries: [string, any][]): [string, any][] {
  return entries.sort(([a], [b]) => {
    const orderA = PROPERTY_ORDER[a] ?? DEFAULT_TIER;
    const orderB = PROPERTY_ORDER[b] ?? DEFAULT_TIER;
    return orderA - orderB;
  });
}

// ─── Validation + Auto-Fix ───────────────────────────────────────────────────

function checkCondition(value: unknown, condition: Condition): boolean {
  switch (condition.op) {
    case '!=': return value !== condition.value;
    case '==': return value === condition.value;
    case '>': return typeof value === 'number' && value > condition.value;
    case 'truthy': return !!value;
    case 'nonEmpty': return Array.isArray(value) && value.length > 0;
  }
}

function formatCondition(gate: string, cond: Condition): string {
  switch (cond.op) {
    case '!=': return `${gate} != '${cond.value}'`;
    case '==': return `${gate} == '${cond.value}'`;
    case '>': return `${gate} > ${cond.value}`;
    case 'truthy': return `${gate} to be set`;
    case 'nonEmpty': return `${gate} to be non-empty`;
  }
}

/**
 * Validate property dependencies and auto-fix missing gates.
 *
 * - Gate ABSENT from ops AND node → inject (if rule has `inject`), else warn
 * - Gate PRESENT but wrong value → warn (don't override explicit intent)
 * - Gate satisfied → OK
 *
 * @param props Properties being set on this node
 * @param nodeState Current gate property values on the node
 * @param parentState Current gate property values on the parent node
 */
export function validateDependencies(
  props: Record<string, unknown>,
  nodeState?: Record<string, unknown>,
  parentState?: Record<string, unknown>,
): { fixes: Record<string, unknown>; warnings: string[] } {
  const fixes: Record<string, unknown> = {};
  const warnings: string[] = [];

  for (const rule of DEPENDENCY_RULES) {
    // Pre-pass: collect triggered dependents so inject resolvers can infer
    // direction from the full set (not a single dep at a time).
    const triggered = new Set<string>();
    for (const dep of rule.dependents) {
      const depName = typeof dep === 'string' ? dep : dep.property;
      const depValue = props[depName];
      if (depValue === undefined) continue;
      if (typeof dep !== 'string' && depValue !== dep.whenValue) continue;
      triggered.add(depName);
    }

    for (const dep of rule.dependents) {
      const depName = typeof dep === 'string' ? dep : dep.property;
      const depValue = props[depName];

      // Dependent not being set — skip
      if (depValue === undefined) continue;

      // Conditional dependent — only check when value matches
      if (typeof dep !== 'string' && depValue !== dep.whenValue) continue;

      if (rule.scope === 'self') {
        // Check gate: ops (including prior fixes) → node state
        const gateInOps = props[rule.gate] ?? fixes[rule.gate];
        const gateOnNode = nodeState?.[rule.gate];
        const effective = gateInOps !== undefined ? gateInOps : gateOnNode;

        if (effective === undefined || (!checkCondition(effective, rule.condition) && gateInOps === undefined)) {
          // Gate absent from ops: either entirely missing or only on the node with wrong value.
          // Auto-fix: inject the correct gate value (e.g. layoutMode:'VERTICAL' when align is set
          // but no layout was specified — the node's default 'NONE' should not block injection).
          if (rule.inject !== undefined) {
            fixes[rule.gate] = typeof rule.inject === 'function'
              ? (rule.inject as (t: ReadonlySet<string>) => unknown)(triggered)
              : rule.inject;
          } else {
            warnings.push(`'${depName}' requires ${formatCondition(rule.gate, rule.condition)}`);
          }
        } else if (!checkCondition(effective, rule.condition)) {
          // Gate explicitly set in ops but with wrong value — warn, don't override intent
          warnings.push(
            `'${depName}' requires ${formatCondition(rule.gate, rule.condition)}, got '${effective}'`
          );
        }
      } else {
        // Parent gate — can't auto-fix, only warn
        const parentGate = parentState?.[rule.gate];
        if (parentGate === undefined || !checkCondition(parentGate, rule.condition)) {
          warnings.push(`'${depName}' requires parent ${formatCondition(rule.gate, rule.condition)}`);
        }
      }
    }
  }

  return { fixes, warnings };
}

// ─── Gate Property Sets (for efficiently reading node state) ─────────────────

/** Self-scope gate properties — read these from the node before validation */
export const SELF_GATE_PROPERTIES: readonly string[] = [...new Set(
  DEPENDENCY_RULES.filter(r => r.scope === 'self').map(r => r.gate)
)];

/** Parent-scope gate properties — read these from the parent node */
export const PARENT_GATE_PROPERTIES: readonly string[] = [...new Set(
  DEPENDENCY_RULES.filter(r => r.scope === 'parent').map(r => r.gate)
)];
