# Read Node Hierarchy Evaluation
- Date: 2026-02-28T02:20:22.207Z
- Model: mistral-nemo:12b
- OLLAMA_ENABLED: true
## Static Metrics
| Metric | Value |
| --- | --- |
| riskScore | 92 |
| readNodeLoc | 75 |
| hierarchyLoc | 24 |
| branchCount | 13 |
| awaitCount | 4 |
| readNodeEstimatedTokens | 772 |
| hierarchyEstimatedTokens | 252 |
| usesDepthCap | true |
| usesChildrenCap | false |
| usesTotalNodeCap | false |
| pruneDefaultsFalse | true |
| callsTreeAnomalies | true |
| nodeModeIsUncompressed | true |
| maxInspectDepth | 4 |
| maxInspectChildren | 15 |
| sampleWorstVisibleNodes | 54241 |
| toolResultMaxChars | 3000 |
| maxHistoryArgsChars | 1500 |
| treeAnomalyMaxDepthDefault | 5 |
| treeAnomalyMaxAnomaliesDefault | 10 |
### Risk Flags
- hierarchy path does not set maxChildrenPerLevel
- hierarchy path does not set maxTotalNodes
- hierarchy path keeps default props (higher payload)
- hierarchy path performs second tree traversal for anomalies
- node mode uses uncompressed serialization
## Key Snippet: read_node(hierarchy)
```ts
case 'hierarchy': {
            if (!readNodeId) {
              response = { success: false, error: { code: 'MISSING_PARAM', message: 'nodeId is required for hierarchy mode.' } };
              break;
            }
            const hNode = await figma.getNodeByIdAsync(readNodeId) as SceneNode;
            if (!hNode) {
              response = { success: false, error: { code: 'NODE_NOT_FOUND', message: `Node ${readNodeId} not found.` } };
              break;
            }
            const hSerialized = NodeSerializer.serializeWithCompression(hNode, {
              maxDepth: Math.min(readDepth || 5, 10),
              pruneDefaults: false
            });
            const anomalies = collectTreeAnomalies(hNode, Math.min(readDepth || 5, 10));
            response = {
              success: true,
              data: {
                ...hSerialized,
                anomalies: anomalies.length > 0 ? anomalies : undefined
              }
            };
            break;
          }
```
## Key Snippet: inspect cleaner
```ts
private extractInspectNode(node: any, depth: number): any {
    const MAX_INSPECT_DEPTH = 4;
    const MAX_INSPECT_CHILDREN = 15;

    const result: any = {
      id: node.id,
      type: node.type,
    };

    // Preserve visual props from the props bag
    if (node.props && typeof node.props === 'object') {
      const kept: Record<string, any> = {};
      for (const [key, value] of Object.entries(node.props)) {
        if (ToolResultCleaner.INSPECT_PRESERVE_PROPS.has(key)) {
          kept[key] = value;
        }
      }
      if (Object.keys(kept).length > 0) {
        result.props = kept;
      }
    }

    // Recurse children with depth control
    if (Array.isArray(node.children) && node.children.length > 0 && depth < MAX_INSPECT_DEPTH) {
      result.children = node.children
        .slice(0, MAX_INSPECT_CHILDREN)
        .map((c: any) => this.extractInspectNode(c, depth + 1));
      if (node.children.length > MAX_INSPECT_CHILDREN) {
        result._moreChildren = node.children.length - MAX_INSPECT_CHILDREN;
      }
    } else if (Array.isArray(node.children)) {
      result.childrenCount = node.children.length;
    }

    return result;
  }

  /**
   * Sanitizes tool calls for history to prevent context bloat.
   */
```
## Mistral Review
**1) Overall Verdict:** CONCERN

The current implementation has a high risk score (92) due to issues related to token waste, depth, and children traversal. There's also a concern about the plugin's performance due to unnecessary anomalies collection.

**2) Findings:**

- **P1:** The `hierarchy` case performs a second tree traversal for anomalies collection (`collectTreeAnomalies`), which is inefficient and increases token usage.
  - Evidence: `hierarchyChars = 1007`, `hierarchyEstimatedTokens = 252`
- **P2:** The plugin does not use caps for maximum children per level (`maxChildrenPerLevel`) or total nodes (`maxTotalNodes`).
  - Evidence: `usesChildrenCap = false`, `usesTotalNodeCap = false`
- **P3:** Uncompressed serialization is used in node mode, leading to larger payloads and increased token usage.
  - Evidence: `nodeModeIsUncompressed = true`

**3) Minimal Patch Plan:**

1. Remove the second tree traversal for anomalies collection by using the already serialized data (`hSerialized`).
2. Implement depth and children caps in the cleaner to control recursion.
   - Update `extractInspectNode` method:
     ```typescript
     if (depth >= MAX_INSPECT_DEPTH) return result;
     if (node.children.length > MAX_INSPECT_CHILDREN) {
       result._moreChildren = node.children.length - MAX_INSPECT_CHILDREN;
       result.children = node.children.slice(0, MAX_INSPECT_CHILDREN);
     } else {
       result.children = node.children.map((c: any) => this.extractInspectNode(c, depth + 1));
     }
     ```
3. Update `NodeSerializer.serializeWithCompression` to use compression by default:
   ```typescript
   const hSerialized = NodeSerializer.serializeWithCompression(hNode, {
     maxDepth: Math.min(readDepth || 5, 10),
     pruneDefaults: true,
     compress: true // Add this line
   });
   ```

**4) Experiment Matrix:**

| Experiment | Metric Target | Patch |
|---|---|---|
| E1 | Reduce `hierarchyEstimatedTokens` by 30% | Remove anomalies second traversal |
| E2 | Limit recursion depth in cleaner | Update `extractInspectNode`'s depth check |
| E3 | Control children count in cleaner | Update `extractInspectNode`'s children slicing |
| E4 | Reduce serialized payload size | Add compression to `serializeWithCompression` |

**5) Suggested Default Thresholds:**

- Depth: 4 (maxDepth default)
- Children: 15 (MAX_INSPECT_CHILDREN in cleaner)
- Total nodes: Not explicitly capped, but consider adding a threshold based on use cases.