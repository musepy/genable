# Read Node Hierarchy Evaluation
- Date: 2026-02-28T02:26:05.831Z
- Model: mistral-nemo:12b
- OLLAMA_ENABLED: false
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
_No review text._