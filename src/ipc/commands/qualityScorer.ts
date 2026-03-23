/**
 * @file qualityScorer.ts
 * @description Lightweight post-creation quality scorer.
 *
 * Runs on the main thread after jsx/create to score the created design.
 * Returns dimensional scores + actionable issues for the agent to fix.
 * Designed to be fast (<50ms) — walks the created subtree only.
 */

interface QualityIssue {
  nodeId: string;
  nodeName: string;
  dimension: string;
  message: string;
  fix: string;
}

interface QualityReport {
  spacing: number;   // 0-100
  padding: number;   // 0-100
  overall: number;   // 0-100
  issues: QualityIssue[];
}

/**
 * Score a created node subtree on design quality dimensions.
 * @param rootIds - Figma node IDs of root nodes to score
 * @returns Quality report with scores and issues
 */
export async function scoreCreatedNodes(rootIds: string[]): Promise<QualityReport> {
  const issues: QualityIssue[] = [];
  let spacingTotal = 0;
  let spacingPass = 0;
  let paddingTotal = 0;
  let paddingPass = 0;

  for (const rootId of rootIds) {
    const node = await figma.getNodeByIdAsync(rootId);
    if (!node || !('children' in node)) continue;
    walkNode(node as FrameNode, issues, {
      spacingTotal: () => spacingTotal++,
      spacingPass: () => spacingPass++,
      paddingTotal: () => paddingTotal++,
      paddingPass: () => paddingPass++,
    });
  }

  const spacing = spacingTotal > 0 ? Math.round((spacingPass / spacingTotal) * 100) : 100;
  const padding = paddingTotal > 0 ? Math.round((paddingPass / paddingTotal) * 100) : 100;
  const overall = Math.round((spacing + padding) / 2);

  return { spacing, padding, overall, issues };
}

function walkNode(
  node: SceneNode,
  issues: QualityIssue[],
  counters: {
    spacingTotal: () => void;
    spacingPass: () => void;
    paddingTotal: () => void;
    paddingPass: () => void;
  },
): void {
  if (!('children' in node)) return;
  const frame = node as FrameNode;

  const hasLayout = frame.layoutMode && frame.layoutMode !== 'NONE';
  const childCount = frame.children.filter(c => c.visible).length;

  // ── Spacing check: layout frame with 2+ children must have gap or SPACE_BETWEEN
  if (hasLayout && childCount > 1) {
    counters.spacingTotal();
    const hasGap = (frame.itemSpacing ?? 0) > 0;
    const hasSpaceBetween = frame.primaryAxisAlignItems === 'SPACE_BETWEEN';
    if (hasGap || hasSpaceBetween) {
      counters.spacingPass();
    } else {
      issues.push({
        nodeId: frame.id,
        nodeName: frame.name,
        dimension: 'spacing',
        message: `${childCount} children, no gap`,
        fix: `edit({path: "/${frame.name}/", props: {gap: 16}})`,
      });
    }
  }

  // ── Padding check: surface frame (has visible fill) must have padding
  if (hasLayout && childCount > 0) {
    const hasFill = frame.fills && Array.isArray(frame.fills) &&
      frame.fills.length > 0 && frame.fills.some((f: Paint) => f.visible !== false);
    if (hasFill) {
      counters.paddingTotal();
      const hasPadding = (frame.paddingTop ?? 0) > 0 ||
        (frame.paddingRight ?? 0) > 0 ||
        (frame.paddingBottom ?? 0) > 0 ||
        (frame.paddingLeft ?? 0) > 0;
      if (hasPadding) {
        counters.paddingPass();
      } else {
        issues.push({
          nodeId: frame.id,
          nodeName: frame.name,
          dimension: 'padding',
          message: `has fill but no padding`,
          fix: `edit({path: "/${frame.name}/", props: {p: 16}})`,
        });
      }
    }
  }

  // Recurse
  for (const child of frame.children) {
    if (child.visible && 'children' in child) {
      walkNode(child as FrameNode, issues, counters);
    }
  }
}

/**
 * Format quality report as stderr string for agent consumption.
 */
export function formatQualityReport(report: QualityReport): string {
  const perfect = report.spacing === 100 && report.padding === 100;

  if (perfect) {
    return '[quality] ✅ spacing: 100%  padding: 100%';
  }

  const lines: string[] = [];
  lines.push(`[quality] ❌ spacing: ${report.spacing}%  padding: ${report.padding}% — fix issues below, then inspect to re-check`);

  for (const issue of report.issues.slice(0, 10)) {
    lines.push(`  ⚠ "${issue.nodeName}" (${issue.nodeId}): ${issue.message} → ${issue.fix}`);
  }
  if (report.issues.length > 10) {
    lines.push(`  ... and ${report.issues.length - 10} more issues`);
  }

  return lines.join('\n');
}
