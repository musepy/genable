# genable-site

Marketing/docs site for Genable. Astro static site, deploys to Vercel/Netlify/anywhere.

## Status

**Initial bootstrap.** Pages are written, design tokens match the Figma cover redesign, all visualizations render in HTML/CSS. Iterate from here.

## Run

```bash
cd genable-site
npm install
npm run dev   # http://localhost:4321
npm run build # → dist/
```

## Structure

```
src/
  layouts/Layout.astro       — page shell (head, fonts, topnav, footer)
  components/
    Topnav.astro
    Footer.astro
    BentoCard.astro          — bento grid cell (used by index + features index)
    viz/
      ButtonsViz.astro       — Components viz (button system)
      PagesViz.astro         — Pages viz (sections mosaic)
      VariablesViz.astro     — Variables viz (token list + modes)
      VariantsViz.astro      — Variants viz (light/dark/brand)
      SystemViz.astro        — Design system viz (page tree)
      SpeedViz.astro         — Speed viz (8s + bar chart)
  pages/
    index.astro              — / Hero + Bento + Flow + Detailed-prompt + Models + FAQ + CTA
    quickstart.astro         — /quickstart
    docs.astro               — /docs
    examples.astro           — /examples
    changelog.astro          — /changelog
    features/index.astro     — /features (grid of 6)
    features/[slug].astro    — /features/components etc. (one per capability)
  styles/global.css          — design tokens + base styles
```

## Design tokens

Mirrors the cover-design palette in `genable-cover-design/project/covers-en.jsx` so cover and site share a brand:

- `--bg #FAFAFA` / `--bg-deep #F2F2F0` / `--surface #FFFFFF`
- `--ink #0A0A0A` / `--ink-2 #262626` / `--muted #6B6B6B` / `--micro #9A9A9A`
- `--accent #2A6FDB` (mono palette)
- `--font-display Inter` / `--font-mono JetBrains Mono` / `--font-serif Newsreader`

## Messaging principles (DO NOT VIOLATE)

- **Sell convenience, not brevity.** Never frame Genable as "one sentence" or "in seconds because of brevity." Detailed prompts are explicitly welcome and produce better results.
- **Hand off the busywork.** The verbs we use: hand off, automate, offload, build, theme, expand. Avoid: just describe, tell it once, fewer turns.
- **Six capabilities, equal weight:** Components / Pages / Variables / Variants / Design system / Speed. They are the bento taxonomy across cover, README, site.

## Deploy

Vercel (recommended):
```bash
# Install the Vercel CLI then:
vercel
```

Netlify:
```bash
# In netlify dashboard: connect repo, set base = genable-site, build = npm run build, publish = dist
```

Or any static host — `npm run build` outputs plain HTML/CSS/JS in `dist/`.

## Open work

- Replace placeholder GitHub link `https://github.com/anthropics/genable` once the public repo is named
- Add real screenshots / demo Loom to /examples (currently text-only gallery)
- Add OG images per page (use the cover designs as templates)
- Wire `/changelog` to pull from the root `CHANGELOG.md` instead of duplicating
- Add a `/blog` if/when there are posts to publish
- Add Chinese site (`/zh/*`) if marketing in CN — copy is already prepared in `covers.jsx`
