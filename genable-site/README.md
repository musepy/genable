# genable-site

Canonical Astro source for the Genable marketing and docs site.

## Status

The site builds as static HTML/CSS and is published at
[genable.pages.dev](https://genable.pages.dev) through the Cloudflare Pages
project `genable`.

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
    BentoCard.astro          — capability grid cell (used by features index)
    viz/
      ButtonsViz.astro       — Components viz (button system)
      PagesViz.astro         — Pages viz (sections mosaic)
      VariablesViz.astro     — Variables viz (token list + modes)
      VariantsViz.astro      — Variants viz (light/dark/brand)
      SystemViz.astro        — Design system viz (page tree)
      ChecksViz.astro        — Inspect / screenshot / refine viz
  pages/
    index.astro              — / Hero + Agent loop + Direction + Models + Surfaces + FAQ
    quickstart.astro         — /quickstart
    docs.astro               — /docs
    examples.astro           — /examples
    changelog.astro          — /changelog
    features/index.astro     — /features (Plan / Build / Check overview)
    features/[slug].astro    — /features/pages, /components, /checks, etc.
  styles/global.css          — design tokens + base styles
```

## Design tokens

The live site tokens are defined in `src/styles/global.css`. Keep that file and the editable cover source in `../genable-cover-design/project/covers-en.jsx` synchronized when the brand palette or typography changes.

## Messaging principles

- **Plan / Build / Check.** Start with brief-led visual direction, build native Figma structure, then inspect and refine.
- **Editable output.** Describe frames, Auto Layout, variables, components, pages, and screenshots as Figma operations — never as a flattened mock.
- **Keep the surfaces distinct.** The plugin uses a provider the user connects. The MCP path uses the model configured in the STDIO client and relays typed operations through the local bridge.
- **Detailed briefs welcome.** Ask for audience, content, brand, mood, hierarchy, and structural constraints. Do not sell prompt brevity.
- **Claims need evidence.** Do not publish speed, cost, tool-count, fixed model-version, or absolute privacy claims unless the supporting measurement and scope ship with the copy.

## Deploy

Cloudflare Pages is connected to `musepy/genable` with these production
settings:

- Production branch: `main`
- Root directory: `genable-site`
- Build command: `npm run build`
- Build output directory: `dist`

Every push to `main` creates a production deployment. Pull requests receive
preview deployments. Build locally before pushing:

```bash
npm ci
npm run build
```

If a production deployment is bad, revert its source commit and push the
revert. For an urgent hosting-only rollback, select the previous successful
deployment in Cloudflare Pages and choose **Rollback to this deployment**.

## Open work

- Add real screenshots / demo Loom to /examples (currently text-only gallery)
- Add OG images per page (use the cover designs as templates)
- Wire `/changelog` to pull from the root `CHANGELOG.md` instead of duplicating
- Register and bind a custom domain if `genable.design` is acquired
- Add a `/blog` if/when there are posts to publish
- Add Chinese site (`/zh/*`) if marketing in CN — copy is already prepared in `covers.jsx`
