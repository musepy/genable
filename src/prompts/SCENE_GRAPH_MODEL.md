## SCENE GRAPH MENTAL MODEL

### Structure: Rooted Acyclic Tree
- The Figma scene graph is a TREE. Every node has exactly one parent. The root has parent: null.
- FRAME = container (can hold children, supports layoutMode, padding, gap).
- TEXT, RECTANGLE, ELLIPSE, LINE, ICON = leaf nodes (no children, no layoutMode).
- TEXT nodes NEVER support layoutMode. Setting layoutMode on TEXT is silently ignored.
- Nesting depth determines visual grouping. A "card with header and body" = FRAME(card) > FRAME(header) + FRAME(body).

### Layout Context Propagation (Parent Constrains Child)
- A parent's layoutMode (HORIZONTAL/VERTICAL) creates an auto-layout context for its children.
- Children's sizing behavior is RELATIVE TO PARENT:
  - FILL = stretch to fill parent's available space. Requires parent to have layoutMode.
  - HUG = shrink to fit own content. Requires the FRAME itself to have layoutMode.
  - FIXED = explicit width/height in pixels. Always valid.
- Without layoutMode on the parent, child FILL/HUG sizing is MEANINGLESS and falls back to FIXED.

### Constraint Rules (Violations Cause Silent Failures)
1. FILL requires auto-layout parent: layoutSizingHorizontal: "FILL" only works if parent has layoutMode set. Otherwise Figma silently reverts to FIXED.
2. HUG requires auto-layout on self: A FRAME with HUG sizing must also have its own layoutMode set. Without it, HUG is ignored.
3. No HUG parent + FILL child: This creates a circular dependency. Figma silently breaks the cycle by forcing FIXED.
4. Root should have explicit dimensions: Without width/height, defaults may be undesirable.

### Nesting Strategy
- Nest when children share a layout axis (row of buttons = FRAME[HORIZONTAL] > button + button + button).
- Nest when a group needs its own padding/gap independent of siblings.
- Every visual grouping (card, input field, nav bar) should be its own FRAME with layoutMode.

### Text Sizing & Overflow
- textAutoResize controls how text boxes adapt:
  - WIDTH_AND_HEIGHT: box shrinks/grows to fit text (use for short labels, buttons).
  - HEIGHT: fixed width, auto height — enables wrapping (use for paragraphs, descriptions).
  - NONE: fixed box, text may overflow silently (avoid for dynamic content).
  - TRUNCATE: fixed box, excess text clipped with "..." (use with textTruncation=ENDING).
- textTruncation=ENDING + maxLines=N: show at most N lines with ellipsis.
  - For labels in fixed-width containers: use textTruncation=ENDING, maxLines=1, textAutoResize=TRUNCATE.
  - For body text with known width: use textAutoResize=HEIGHT (auto-wraps, auto-adjusts height).
- Rule: Never use textAutoResize=NONE unless you intentionally want overflow.
- Rule: FILL width + long text → set textAutoResize=HEIGHT to enable wrapping.

### Efficiency: Think in Trees, Not Nodes
- Output the complete structure in one `create_node` call when possible.
- Plan the full hierarchy before outputting: root > sections > components > leaves.
- Avoid creating bare frames and restyling in later iterations when requirements are already known.
