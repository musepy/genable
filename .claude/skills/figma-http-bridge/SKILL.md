# Figma HTTP Bridge — Control Figma via curl

Use this skill when the user wants to interact with the Figma plugin to create, inspect, or edit designs. This is an HTTP bridge — call Figma tools via `curl`, no MCP required.

## Prerequisites

One shared HTTP bridge server must be running (all coding agents share it):
```bash
npx tsx tools/mcp-server/httpBridge.ts
```
Default: HTTP on port 3460, WebSocket relay on port 3461.

## Multi-file Isolation

Multiple Figma files can connect simultaneously. Use `?file=` to target a specific file:
```bash
# List connected files
curl http://localhost:3460/clients

# Target a specific file (partial name match)
curl -X POST "http://localhost:3460/tool/inspect?file=myproject" ...

# Target by exact fileKey
curl -X POST "http://localhost:3460/tool/inspect?file=ExvSLYAdjmpnKrmFeh5fsS" ...
```

**IMPORTANT**: Always check `/clients` first to know which files are connected, then use `?file=` to avoid operating on the wrong file. Without `?file=`, the first connected client receives the call.

Draft files show as `[Draft] filename` with a temporary session ID.

## Quick Reference

```bash
# Check connection + list files
curl http://localhost:3460/health

# List all available tools
curl http://localhost:3460/tools

# Call any tool (targeting a specific file)
curl -X POST "http://localhost:3460/tool/<tool_name>?file=<name>" \
  -H "Content-Type: application/json" \
  -d '{ ...parameters... }'
```

## Core Tools

### Create UI (jsx)
```bash
curl -X POST "http://localhost:3460/tool/jsx?file=myfile" -H "Content-Type: application/json" -d '{
  "markup": "<Frame name=\"Card\" w={320} h={200} layout=\"vertical\" p={16} gap={12} fill=\"#FFFFFF\" cornerRadius={12}><Text name=\"Title\" characters=\"Hello\" fontSize={24} fontWeight=\"bold\" fill=\"#1A1A1A\"/></Frame>"
}'
```

### Inspect Nodes (inspect)
```bash
curl -X POST "http://localhost:3460/tool/inspect?file=myfile" -H "Content-Type: application/json" -d '{
  "node": "Card#1:2", "mode": "detail"
}'
```

### Edit Properties (edit)
```bash
curl -X POST "http://localhost:3460/tool/edit?file=myfile" -H "Content-Type: application/json" -d '{
  "node": "Title#1:3", "props": { "fill": "#FF0000", "fontSize": 32 }
}'
```

### Find Nodes (find_nodes)
```bash
curl -X POST "http://localhost:3460/tool/find_nodes?file=myfile" -H "Content-Type: application/json" -d '{
  "query": "Button"
}'
```

### Get Current Selection (get_selection)
```bash
curl -X POST "http://localhost:3460/tool/get_selection?file=myfile" -H "Content-Type: application/json" -d '{}'
```

## Node Addressing

Nodes are referenced as `name#id` (e.g. `"Card#1:2"`). Get IDs from `inspect`, `find_nodes`, or `get_selection` results.

## Response Format

Success: `{ "ok": true, "data": { ... } }`
Error:   `{ "error": "message" }`

## Workflow

1. `/clients` → identify which file to work on
2. `get_selection` or `find_nodes` with `?file=` → get node references
3. `inspect` → understand current structure
4. `jsx` → create new nodes / `edit` → modify existing
5. `inspect` with `screenshot: true` → verify result
