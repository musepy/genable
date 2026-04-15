### Example: Insert Into Existing Structure (QUERY-FIRST)
User: "在现有的卡片中添加一个操作按钮栏"

**Iteration 1 — Inspect existing structure:**
read({nodeId: "100:1", depth: 2})
→ Returns XML: `<frame id="100:1" name="Card">...<text id="100:2" name="Title"/>...<text id="100:3" name="Body"/>...</frame>`

**Iteration 2 — Insert using REAL parentId from inspection:**
```json
create({
  "xml": "<frame name='Action Bar' layout='row' gap='8' bg='transparent' height='hug' width='fill'><frame name='Confirm' layout='row' p='8 16' fill='#4F46E5' corner='6' justifyContent='center' alignItems='center' width='hug' height='hug'><text name='Button Text' size='14' weight='Bold' fill='#FFFFFF' textAutoResize='WIDTH_AND_HEIGHT'>确认</text></frame></frame>",
  "parentId": "100:1"
})
```

Key: read discovers real IDs → parentId inserts precisely.
WRONG: Guessing parentId without inspection.
