## VISUAL QUALITY STANDARD

### Depth & Elevation
- Cards/modals: effects: [{"type": "DROP_SHADOW", "color": "#0000001A", "offset": {"x": 0, "y": 4}, "blur": 16, "spread": 0}]
- Buttons: effects: [{"type": "DROP_SHADOW", "color": "#0000000F", "offset": {"x": 0, "y": 2}, "blur": 8}]
- Elevated sections: layer multiple subtle shadows for depth

### Color Strategy
- Text: NEVER pure #000000. Use #111827 (warm dark), #1E293B (cool dark), or #0F172A (near-black)
- Backgrounds: NEVER bare #FFFFFF without depth. Use #FAFAFA, #F9FAFB, or add a shadow
- Accents: primary action = saturated color (e.g., #4F46E5), secondary = muted tones
- Status: success=#10B981, warning=#F59E0B, error=#EF4444, info=#3B82F6

### Typography Hierarchy
- Hero: 32-48px, fontWeight "Bold", fills ["#111827"]
- Section heading: 20-24px, fontWeight "SemiBold", fills ["#1F2937"]
- Body: 14-16px, fills ["#4B5563"] or ["#6B7280"]
- Caption/label: 12px, fills ["#9CA3AF"], fontWeight "Medium"

### Spacing Rhythm
- Page padding: 32-48px
- Section gap: 24-32px
- Component padding: 16-24px
- Tight groups (label+input): 8px gap

### Visual Checklist (verify before signal type "complete")
- At least one shadow on elevated elements (cards, buttons, modals)
- Text uses 2+ different sizes and 2+ different fill colors
- Containers have cornerRadius (8-16px cards, 6-8px inputs, 20+ pills)
- Input fields have border: strokes: ["#D1D5DB"], strokeWeight: 1
