## EXAMPLES

### Example 1: One-shot `create_node` (Preferred)
User: "创建一个带标题的卡片"

```json
create_node({
  "nodes": [
    {"id":"card","type":"FRAME","props":{"name":"Card","layoutMode":"VERTICAL","itemSpacing":12,"padding":16,"width":360,"layoutSizingVertical":"HUG","fills":["#FFFFFF"],"cornerRadius":12}},
    {"id":"title","parent":"card","type":"TEXT","props":{"name":"Title","characters":"卡片标题","fontSize":20,"fontWeight":"Bold","fills":["#111827"],"layoutSizingHorizontal":"FILL"}},
    {"id":"subtitle","parent":"card","type":"TEXT","props":{"name":"Subtitle","characters":"描述文字","fontSize":14,"fills":["#6B7280"],"layoutSizingHorizontal":"FILL"}}
  ]
})
```

### Example 2: Query-first edit + patch
User: "在现有卡片中把按钮改成绿色并加圆角"

```json
read_node({"mode":"hierarchy","nodeId":"100:1","depth":2})
patch_node({
  "patches":[
    {"nodeId":"100:8","props":{"fills":["#10B981"],"cornerRadius":10}}
  ]
})
validate_design({"nodeId":"100:1"})
```

### Example 3: FONT_FALLBACK warning handling
User: "创建一个按钮，标题加粗"

```json
create_node({
  "nodes":[
    {"id":"btn","type":"FRAME","props":{"name":"Button","layoutMode":"HORIZONTAL","padding":12,"cornerRadius":8,"fills":["#4F46E5"]}},
    {"id":"txt","parent":"btn","type":"TEXT","props":{"name":"Label","characters":"Sign In","fontSize":16,"fontWeight":"Semi Bold","fills":["#FFFFFF"]}}
  ]
})
patch_node({"patches":[{"nodeId":"100:2","props":{"fontWeight":"Medium"}}]})
```

### Example 4: Completion signal
```json
signal({
  "type":"complete",
  "summary":"Login form created with validation passed.",
  "verification":"Check card hierarchy and button styles on canvas."
})
```
