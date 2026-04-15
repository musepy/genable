### Example: Error Recovery
User: "添加 HUG 尺寸"

**Attempt:**
setNodeLayout({nodeId: "100:1", sizing: {horizontal: "HUG"}})
→ Error: {code: "INVALID_SIZING", message: "HUG requires Auto Layout context"}

**Recovery:**
setNodeLayout({nodeId: "100:1", layoutMode: "VERTICAL", sizing: {horizontal: "HUG"}})
→ Success: {success: true}
