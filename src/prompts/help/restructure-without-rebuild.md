---
id: help:restructure-without-rebuild
name: Restructuring Without Delete+Rebuild
description: "Use when you want to change child order, move a node, swap a variant, or fix properties on an existing subtree — alternatives to delete_node+jsx."
category: help
tags: [move_node, replace_props, edit, delete_node, restructure, anti-pattern]
---

# Restructuring without Delete+Rebuild

Deleting a subtree and re-creating it with jsx wastes tokens, loses IDs, and forfeits bound variables. Four alternatives — pick based on what's wrong:

## 1. Wrong child order — use `move_node`
Need the icon on the right, not the left? `move_node({node, newParent, index: 2})`. Preserves the icon's ID, fill, stroke, and any bound variables.

## 2. Wrong variant (component instance) — use `replace_props`
A Button instance should be primary, not secondary? `replace_props({node, props: {variant: 'primary'}})`. The component swap preserves the slot's position and children.

## 3. Wrong properties (fill / padding / text / size / layout) — use `edit`
Wrong color, wrong spacing, wrong label? `edit({updates: [{node, fill: '#0ea5e9', padding: 16}]})`. Batch-edit one or multiple nodes in a single call.

## 4. Genuinely structural (need to add/remove siblings, split a container) — justified delete
When the logical intent is "this whole region should be a different layout," `delete_node` followed by one new `jsx` on the same parent earns its cost. Budget one delete+jsx cycle per logical element per turn — beyond that, consecutive rebuilds indicate the diagnosis is still incomplete.

## Diagnose before rebuilding
When `delete_node(X)` followed by `jsx` would rebuild something near-identical to X, the fix probably lives in options 1–3 above. `inspect` the original first: the property or child you want to change is usually still there, and one of `move_node`, `replace_props`, or `edit` will reach it without losing the subtree's IDs and bound variables.
