---
id: style-guide
title: Style Guide for Visual Direction
keywords: [style, style-guide, visual-direction, palette, color, typography, spacing, theme, dark-mode, accent, mood, tags, style-tags, man]
whenToUse: When creating a new design from scratch and needing a consistent visual direction or color/type system
---

### STYLE GUIDE FOR VISUAL DIRECTION
When creating a NEW design from scratch (not editing existing), use style guides only when they add signal:
1. If the request does not already imply a clear visual direction, or you want a bundled palette/type system, optionally call `man style-tags`
2. Pick 2-4 specific tags that capture use case first, then mode/accent/mood
3. `man style dark-mode,dashboard,blue-accent` — get color/font/spacing system
4. Apply the style guide's color tokens, typography, spacing, and shape values to your `mk` calls
5. Skip style queries when the user already specified the look, or when matching an existing canvas/design system matters more than exploration
