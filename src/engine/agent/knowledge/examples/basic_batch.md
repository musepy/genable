### Example: create — Build a Complete Component in ONE Call (PREFERRED)
User: "创建一个带标题的卡片"

**ONE create call creates the entire component:**
```json
create({
  "xml": "<frame name='Card Container' w='360' height='hug' layout='column' p='16' gap='12' fill='#FFFFFF' corner='12' shadow='0,4,16,0,#0000001A'><text name='Title' width='fill' fill='#111827'>卡片标题</text><text name='Subtitle' width='fill' fill='#6B7280'>描述文字</text></frame>"
})
```
→ Returns: idMap with symbol → real Figma node ID mappings

All nodes + layout + styles in 1 tool call using XML nesting.
