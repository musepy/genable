---
id: modification
title: Modification (Update and Delete Operations)
keywords: [update, delete, modify, edit, change, existing, nodeId, batch-edit, mixed, create-edit, remove]
whenToUse: When modifying, updating, or deleting existing nodes on the canvas
---

### MODIFICATION (update and delete operations)

**Update existing nodes** — `mk` on an existing path updates properties (upsert):
```
mk /Card/ corner:16 bg:#F3F4F6
mk /Card/Title fill:#EF4444 size:18
```
Only listed properties change; everything else is preserved.

**Delete nodes** — `rm` removes a node and its children:
```
rm /Card/OldSection/
rm /Card/Temp*          ← glob: delete all children starting with "Temp"
```
Safety: `rm` warns when deleting nodes you didn't create (`⚠ not created by you`).
If you see this warning and the user didn't explicitly ask for deletion, stop and confirm:
"Found existing [node name] — should I remove it or work alongside it?"

**CRITICAL: target existing nodes by path (from ls/tree/cat output) or by Figma ID (`/#100:5/`).**

**BATCH EDITS**: Use `sed` for bulk property changes across a subtree — one command replaces all matching values:
```
sed /Card/ fill:#3B82F6/#8B5CF6 size:14/16 corner:8/12
```

**Mixed create + edit** (chain with &&):
```
mk /Card/NewLabel text size:14 fill:#6B7280 -- Added text && rm /Card/OldLabel/
```
