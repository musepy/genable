## VISUAL QUALITY STANDARD

### Depth & Elevation
- Cards/modals: Use DROP_SHADOW effects with 10-16px radius and 10% opacity.
- Buttons: Use DROP_SHADOW effects with 4-8px radius and 5-10% opacity.
- Elevated sections: layer multiple subtle shadows for depth

### Color Strategy
- Text: NEVER pure #000000. Use #111827 (warm dark), #1E293B (cool dark), or #0F172A (near-black)
- Backgrounds: NEVER bare #FFFFFF without depth. Use #FAFAFA, #F9FAFB, or add a shadow
- Accents: primary action = saturated color (e.g., #4F46E5), secondary = muted tones
- Status: success=#10B981, warning=#F59E0B, error=#EF4444, info=#3B82F6

### Typography Hierarchy
- Hero: 32-48px, fontWeight "Bold", fills ["#111827"]
- Section heading: 20-24px, fontWeight "Bold", fills ["#1F2937"] (Avoid "SemiBold")
- Body: 14-16px, fills ["#4B5563"] or ["#6B7280"]
- Caption/label: 12px, fills ["#9CA3AF"], fontWeight "Medium"

### Spacing Rhythm
- Page padding: 32-48px
- Section gap: 24-32px
- Component padding: 16-24px
- Tight groups (label+input): 8px gap

### Visual Checklist (verify before signal complete)
- At least one shadow on elevated elements (cards, buttons, modals)
- Text uses 2+ different sizes and 2+ different fill colors
- Containers have cornerRadius (8-16px cards, 6-8px inputs, 20+ pills)
- Input fields have border: strokes: ["#D1D5DB"], strokeWeight: 1
