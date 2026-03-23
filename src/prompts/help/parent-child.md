---
id: parent-child
title: Parent-Child Creation
keywords: [parent, child, idMap, cross-call, reference, insert, parentId, nested, hierarchy, existing-tree]
whenToUse: When inserting children into existing frames or using idMap from previous design calls
---

## PARENT-CHILD CREATION

**Progressive building** — create skeleton first, then add children:
```
mk /Card/ frame w:400 layout:column p:24 bg:#FFF corner:12
mk /Card/Header frame layout:row alignCross:center gap:12
mk /Card/Header/Title text size:18 weight:Bold fill:#111 -- Card Title
mk /Card/Body text size:14 fill:#666 -- Description here
```

**Insert into existing trees** — use `tree` or `ls` first to discover the structure, then `mk` into the path:
```
tree /ExistingCard/ -d 2
mk /ExistingCard/Footer frame layout:row gap:8 alignMain:end
mk /ExistingCard/Footer/Btn frame layout:row p:'8 16' bg:#000 corner:6
mk /ExistingCard/Footer/Btn/Label text size:12 fill:#FFF weight:Medium -- Action
```

**$LAST shortcut** — reference the last created node in chains:
```
mk /Card/Icon frame w:40 h:40 bg:#EEE corner:20 && cat $LAST -s
```

**By name#id** — use ref from ls/receipt for precise targeting:
```
mk /NewChild#1134:25994/ text size:14 fill:#333 -- Inserted by ref
```
