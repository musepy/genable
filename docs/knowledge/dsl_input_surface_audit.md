# DSL Input Surface Audit

> **Goal**: Inventory every DSL key the LLM can write, the value forms each accepts, the Figma API target it translates to, and where tolerant fallbacks let translation errors slip past the LLM.
>
> **Baseline**: `layout` was converted to fail-fast in commit `58656a4` (April 2026). This audit identifies every other DSL key that still has the same shape of problem.
>
> **Scope read**: `src/engine/actions/expandShorthands.ts` (canonical translation table), `src/engine/utils/prop-dsl.ts` (coercion + value classes), `src/engine/actions/handlers/defaultHandler.ts` (passthrough setter), `src/engine/jsx/templateCompiler.ts` (JSX walk + sizing defaults), `src/ipc/commands/writeHandlers.ts` (legacy `mk` parser, mostly dead), `src/domain/node-normalizers.ts` (post-expansion enum/range gates), `src/constants/figma-property-registry.ts` (PROPERTY_META — capability allowlist).

---

## 1. DSL Property Full Table

The following enumerates every key recognized by `EXPANDERS` in `expandShorthands.ts:87-514`, plus DSL-aware passthrough behaviour from `prop-dsl.ts:36-69` and post-expansion normalization in `node-normalizers.ts:147-180`.

Legend for "fallback":
- **strict** — unknown values throw or are dropped
- **silent** — unknown values silently fall through to Figma (which may throw later)
- **upper** — unknown values are blindly `.toUpperCase()`'d and forwarded as if valid
- **drop** — only some shapes accepted; others return `{}` (key silently disappears)
- **N/A** — pure scalar/string passthrough, no enum semantics

### 1a. Layout & Container

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `layout` | `'row' \| 'column' \| 'horizontal' \| 'vertical' \| 'grid' \| 'none'` (case- and `_-`insensitive) | `layoutMode` ∈ HORIZONTAL/VERTICAL/GRID/NONE | `expandShorthands.ts:93-102` | **strict** (throws) ← reference |
| `pattern` | `'row' \| 'column' \| 'row-fill' \| 'column-fill' \| 'stack'` | `layoutMode` + `layoutSizing*` + `fills:[]` macro bundle | `expandShorthands.ts:104-120, 38-44` | **drop** (unknown → `{}`) |
| `align` | single token (`center`/`start`/`end`/`flex-start`/`flex-end`/`space-between`/`between`/`space-around`/`around`/`space-evenly`/`evenly`/`baseline`) or two-token "main cross" | `primaryAxisAlignItems` + `counterAxisAlignItems` ∈ MIN/CENTER/MAX/SPACE_BETWEEN/BASELINE | `expandShorthands.ts:123-135, 28-36` | **upper** (unknown → uppercased raw) |
| `justifyContent` | same as `align` single-axis | `primaryAxisAlignItems` | `expandShorthands.ts:137` | **upper** |
| `justify` | same | `primaryAxisAlignItems` | `expandShorthands.ts:138` | **upper** |
| `alignItems` | same | `counterAxisAlignItems` | `expandShorthands.ts:139` | **upper** |
| `alignMain` | same | `primaryAxisAlignItems` | `expandShorthands.ts:331` | **upper** |
| `alignCross` | same | `counterAxisAlignItems` | `expandShorthands.ts:332` | **upper** |
| `wrap` | `true \| 'true' \| '1' \| 'wrap' \| false \| 'false' \| '0' \| 'nowrap' \| 'no-wrap'` | `layoutWrap` ∈ WRAP/NO_WRAP | `expandShorthands.ts:293-298` | **upper** (unknown → uppercased raw, *then* PROPERTY_META drops it at `node-normalizers.ts:147-166`) |
| `positioning` | string | `layoutPositioning` ∈ AUTO/ABSOLUTE | `expandShorthands.ts:334` | **upper** (PROPERTY_META also accepts `RELATIVE→AUTO` map) |
| `strokesInLayout` | bool / `'true'`/`'false'` | `strokesIncludedInLayout` (boolean) | `expandShorthands.ts:355` | strict (anything not "true" → false) |
| `reverseZ` | bool / string | `itemReverseZIndex` (boolean) | `expandShorthands.ts:356` | strict |

### 1b. Sizing

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `width` | `number \| numberAsString \| 'fill' \| '100%' \| 'hug' \| '<n>px'` | `width` (number) OR `layoutSizingHorizontal` ∈ FILL/HUG | `expandShorthands.ts:190-200` | **silent** — unrecognized string passes raw to `width` |
| `w` | alias for `width` | same | `expandShorthands.ts:303` | same |
| `height` | same as width on V-axis | `height` OR `layoutSizingVertical` | `expandShorthands.ts:202-212` | **silent** — same shape |
| `h` | alias for `height` | same | `expandShorthands.ts:304` | same |
| `sizing` | `string` (single → both axes) or `[string, string]` | `layoutSizingHorizontal` + `layoutSizingVertical` | `expandShorthands.ts:214-223` | **upper** (no enum check at this layer; PROPERTY_META catches FIXED/FILL/HUG/AUTO/STRETCH later) |
| `sizingH` | string | `layoutSizingHorizontal` | `expandShorthands.ts:353` | **upper** |
| `sizingV` | string | `layoutSizingVertical` | `expandShorthands.ts:354` | **upper** |
| `minW` | `$varRef \| number \| numberAsString` | `minWidth` | `expandShorthands.ts:359` | strict (Number coercion → NaN drops at `node-normalizers.ts:170-178`) |
| `maxW` | same | `maxWidth` | `expandShorthands.ts:360` | strict |
| `minH` | same | `minHeight` | `expandShorthands.ts:361` | strict |
| `maxH` | same | `maxHeight` | `expandShorthands.ts:362` | strict |
| `lockRatio` | bool / `'true'`/`'false'` | `constrainProportions` | `expandShorthands.ts:357` | strict |
| `pin` | string `"H,V"` (e.g. `"MIN,CENTER"`) or `{horizontal,vertical}` object | `constraints` | `expandShorthands.ts:358` → `constraintsHandler` `domain/property-specs.ts:404-410` | **drop** (unknown enum → `MIN`) |

### 1c. Spacing

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `padding` | `number \| 'n' \| 'n n' \| 'n n n' \| 'n n n n' \| number[] \| {top,right,bottom,left}` (also `t,r,b,l`) \| `$varRef` | `paddingTop/Right/Bottom/Left` | `expandShorthands.ts:142-162` | **drop** (NaN parts → `{}`) |
| `p` | alias for `padding` | same | `expandShorthands.ts:305` | same |
| `pt` / `pr` / `pb` / `pl` | `number \| numberAsString \| $varRef` | individual `padding*` | `expandShorthands.ts:306-309` | strict (Number coercion) |
| `px` | one number → `paddingLeft + paddingRight` | both axes | `expandShorthands.ts:310-313` | strict |
| `py` | one number → `paddingTop + paddingBottom` | both axes | `expandShorthands.ts:314-317` | strict |
| `gap` | `number \| numberAsString \| $varRef` | `itemSpacing` (or `gridRow/ColumnGap` if container is GRID) | `expandShorthands.ts:164-171` | strict |
| `crossGap` / `crossAxisGap` | same | `counterAxisSpacing` | `expandShorthands.ts:172-173` | strict |
| `rowGap` | same | `gridRowGap` | `expandShorthands.ts:178` | strict |
| `colGap` / `columnGap` | same | `gridColumnGap` | `expandShorthands.ts:179-180` | strict |

### 1d. Grid

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `cols` | `number \| numberAsString` | `gridColumnCount` | `expandShorthands.ts:176` | strict |
| `rows` | same | `gridRowCount` | `expandShorthands.ts:177` | strict |
| `rowSpan` | same | `gridRowSpan` | `expandShorthands.ts:183` | strict |
| `colSpan` / `columnSpan` | same | `gridColumnSpan` | `expandShorthands.ts:184-185` | strict |
| `alignX` | `'start'\|'end'\|'center'\|'auto'\|'min'\|'max'` | `gridChildHorizontalAlign` ∈ MIN/MAX/CENTER/AUTO | `expandShorthands.ts:186, 23-26, 57-59` | **upper** |
| `alignY` | same | `gridChildVerticalAlign` | `expandShorthands.ts:187` | **upper** |

### 1e. Paint (fill/stroke)

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `fill` | `'#hex' \| 'transparent' \| 'none' \| $varRef \| string[] \| object[] \| Paint object` | `fills: any[]` (lowered by `figma-lowering.ts:22-33` → Figma Paint) | `expandShorthands.ts:226-233` | **silent** (any non-string-non-array wraps in `[v]` → fed to lowering, may throw) |
| `background` | alias for `fill` | `fills` | `expandShorthands.ts:235` | same |
| `bg` | alias for `fill` | `fills` | `expandShorthands.ts:236` | same |
| `stroke` | shorthand string `"weight color align"` (any token order) | `strokes: ['#hex'] + strokeWeight + strokeAlign` | `expandShorthands.ts:238-253` | **upper** for align token; non-string returns `{}` (drop) |
| `strokeW` | `number \| $varRef` | `strokeWeight` | `expandShorthands.ts:344` | strict |
| `strokeA` | string | `strokeAlign` ∈ INSIDE/OUTSIDE/CENTER | `expandShorthands.ts:345` | **upper** (PROPERTY_META drops if unknown) |
| `strokeJ` | string | `strokeJoin` ∈ MITER/BEVEL/ROUND | `expandShorthands.ts:346` | **upper** |
| `strokeC` | string | `strokeCap` ∈ NONE/ROUND/SQUARE/ARROW_LINES/ARROW_EQUILATERAL | `expandShorthands.ts:347` | **upper** |
| `strokeT/R/B/L` | `number` | individual `stroke*Weight` | `expandShorthands.ts:349-352` | strict |
| `dash` | `string '10,5' \| number[]` | `dashPattern` | `expandShorthands.ts:348` → `dashPatternHandler.ts:17-32` | strict (NaN filtered) |
| `outline` | shorthand string (always sets `strokeAlign:OUTSIDE`) | `strokes + strokeAlign + strokeWeight` | `expandShorthands.ts:502-513` | **drop** (non-string → `{}`) |

### 1f. Shape & Corner

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `radius` | `number \| 'full' \| number[4] \| $varRef` | `cornerRadius` OR per-corner `topLeftRadius`/etc. | `expandShorthands.ts:266-274` | strict (NaN → NaN, dropped by PROPERTY_META) |
| `corner` | alias for `radius` | same | `expandShorthands.ts:276` | same |
| `borderRadius` | same value, *unconditional pass* (no parsing) | `cornerRadius: v` | `expandShorthands.ts:281` | **silent** (e.g. `'12px'` would slip through unparsed) |
| `smooth` | `number` | `cornerSmoothing` | `expandShorthands.ts:279` | strict |
| `arc` | `string '<start> <end> [innerRadius]' \| 'ring <r>' \| {startingAngle,endingAngle,innerRadius}` | `arcData` | `expandShorthands.ts:460-482` | **drop** (malformed → `{}`) |
| `path` | string SVG `'M..L..Z'` | `vectorPaths: [{windingRule:'NONZERO', data}]` | `expandShorthands.ts:439-442` | **drop** (non-string/empty → `{}`) |
| `paths` | `string[] \| VectorPath[]` | `vectorPaths` | `expandShorthands.ts:444-451` | **drop** (non-array → `{}`) |

### 1g. Effects

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `shadow` | string `"ox,oy,blur,spread,#color"` (or space-separated, with optional `inset,` prefix) `\| any[]` | `effects: [...]` | `expandShorthands.ts:256-260` → `parseEffectToFigma` `domain/property-specs.ts:239-282` | **silent** (best-effort parse, missing parts default to 0/`#0000001A`) |
| `blur` | `number` | `effects: [{type:'LAYER_BLUR', radius}]` | `expandShorthands.ts:262` | strict |
| `bgblur` | `number` | `effects: [{type:'BACKGROUND_BLUR', radius}]` | `expandShorthands.ts:263` | strict |
| `blend` | string | `blendMode` ∈ 19 enum values | `expandShorthands.ts:280` | **silent** (no toUpperCase, no enum check at this layer; PROPERTY_META drops unknowns) |

### 1h. Text & Typography

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `font` | string | `fontFamily` | `expandShorthands.ts:330` | N/A (string) |
| `weight` | `'thin'/'extralight'/'light'/'regular'/'medium'/'semibold'/'bold'/'extrabold'/'black'` (also hyphenated) `\| string` | `fontWeight` (passed to fontName resolver) | `expandShorthands.ts:319-329` | **silent** — anything unrecognized passes raw (`'WEIGHT_ALIASES[normalized] ?? s'`) |
| `size` | `number \| $varRef` | `fontSize` | `expandShorthands.ts:318` | strict |
| `lineHeight` | `number \| string \| {value, unit}` (1–5 → percent multiplier) | `lineHeight` | `expandShorthands.ts:338-342` → `unitValueHandler` | **silent** for >5 numbers (pass raw to handler which Number()s); see methodology note below |
| `leading` | alias for `lineHeight` | same | `expandShorthands.ts:343` | same |
| `tracking` | any | `letterSpacing` (passes as-is) | `expandShorthands.ts:335` | **silent** (unitValueHandler later coerces) |
| `textAlign` | string | `textAlignHorizontal` ∈ LEFT/CENTER/RIGHT/JUSTIFIED | `expandShorthands.ts:333` | **upper** (PROPERTY_META drops unknowns) |
| `decoration` | `'underline'/'strikethrough'/'none'/'line-through'` | `textDecoration` ∈ NONE/UNDERLINE/STRIKETHROUGH | `expandShorthands.ts:368-374` | **upper** |
| `decorationStyle` | string | `textDecorationStyle` ∈ SOLID/WAVY/DOTTED | `expandShorthands.ts:377` | **upper** |
| `decorationThickness` | `number \| 'auto' \| object` | `textDecorationThickness: {value, unit}` or `{unit:'AUTO'}` | `expandShorthands.ts:380-388` | **drop** (NaN+non-object → `{}`) |
| `decorationOffset` | same shape | `textDecorationOffset` | `expandShorthands.ts:390-398` | **drop** |
| `decorationColor` | `'#hex' \| 'auto' \| object` | `textDecorationColor` | `expandShorthands.ts:401-415` | **drop** |
| `truncate` | bool / `'true'` | `textTruncation: 'ENDING' + textAutoResize:'NONE'` (or DISABLED) | `expandShorthands.ts:417-422` | strict |
| `maxLines` | `number` | `maxLines + textTruncation:'ENDING'` | `expandShorthands.ts:424` | strict |
| `whiteSpace` | `'nowrap'/'normal'/'pre'` | `textAutoResize` ∈ WIDTH_AND_HEIGHT/HEIGHT | `expandShorthands.ts:426-432` | **drop** (unknown → `{}`) |
| `italic` | bool / `'true'` | `fontStyle: 'italic'` or `'normal'` | `expandShorthands.ts:489` | strict (anything else → `'normal'`) |
| `slant` | number | `fontSlant` | `expandShorthands.ts:490` | strict |
| `link` | string | `hyperlink: 'URL'` (or `'NODE:<id>'`) | `expandShorthands.ts:365` → `hyperlinkHandler.ts:18-22` | strict (any string accepted) |
| `characters` | string (also auto-set from JSX text children) | `characters` + `textCase` if `'uppercase '/'lowercase '/'capitalize '` prefix | `expandShorthands.ts:521-541` | strict (TEXT_TRANSFORM_PREFIXES) |

### 1i. Image / Misc

| DSL key | Accepted value forms | Figma API target | Code | Fallback |
|---|---|---|---|---|
| `fit` | `'cover'/'contain'/'none'/'tile'/'fill'/'fit'/'crop'` | `scaleMode` ∈ FILL/FIT/CROP/TILE | `expandShorthands.ts:493-499` | **upper** |
| `overflow` | bool / `'true'/'hidden'/'clip'` | `clipsContent` (boolean) | `expandShorthands.ts:283-286` | strict (anything else → `false`) |
| `clips` | alias for `overflow` | same | `expandShorthands.ts:288-291` | strict |
| `rotate` | `number` (degrees, sign-flipped vs Figma's CCW convention) | `rotation` | `expandShorthands.ts:486` | strict |

### 1j. Direct Passthrough (no expander, but `KNOWN_PROP_KEYS`-allowlisted)

Any property listed in `PROPERTY_META` (`figma-property-registry.ts:1223-1345`) with no expander entry passes through untouched into `node-normalizers.ts` step 5 (enum/scalar gates). Examples the LLM frequently sees:

| DSL key | Figma target | Notes |
|---|---|---|
| `name`, `visible`, `opacity` | identity | string/bool/scalar |
| `layoutMode` | `layoutMode` | **direct write** (bypasses `layout` expander entirely) — see §2 multi-entry table |
| `layoutSizingHorizontal/Vertical` | identity | direct enum write |
| `primaryAxisAlignItems`, `counterAxisAlignItems`, `counterAxisAlignContent` | identity | direct enum write |
| `paddingTop/Right/Bottom/Left`, `itemSpacing`, `counterAxisSpacing` | identity | direct numeric |
| `gridRowCount`, `gridColumnCount`, `gridRowGap`, `gridColumnGap`, `gridRowSpan`, `gridColumnSpan`, `gridChildHorizontalAlign`, `gridChildVerticalAlign` | identity | direct |
| `pointCount`, `innerRadius`, `arcData`, `vectorPaths` | identity | shape data |
| `topLeftRadius`/etc., `cornerSmoothing`, all per-side `stroke*Weight` | identity | numeric |
| `textCase`, `textAlignHorizontal/Vertical`, `textAutoResize`, `paragraphSpacing`, `paragraphIndent`, `listSpacing`, `hangingPunctuation`, `hangingList`, `leadingTrim` | identity | typography |
| `fillStyle`, `strokeStyle`, `effectStyle`, `textStyle` | resolved by `styleRefHandler.ts:13-26` | name → styleId |
| `fills`, `strokes`, `effects` | lowered by paint/effect handlers | object pass-through accepted |
| `fontName` (object) | identity | also synthesized from `fontFamily` + `fontWeight` |
| `mainComponent` | resolved by `nodeFactory.ts:653-680` | name → component swap on instances |
| `__set_<name>` | (JSX only) instance text override | `templateCompiler.ts:117, 320-322` |

### 1k. Coercion (raw string → typed value)

`coerceValue(key, value)` in `prop-dsl.ts:78-97` only fires on tokenized inputs (legacy `mk` parser at `writeHandlers.ts:38-48, 95-135` — see §2 dead-code note). For the live JSX/edit pipeline, JSX literal types are preserved by sucrase, so this coercion mostly affects component overrides written as quoted strings.

- `STRING_VALUE_PROPS` (51 keys): keep as string. Includes both canonical (`fontWeight`, `layout`, `textAlignHorizontal`, …) and abbrev (`weight`, `font`, `alignMain`, `sizingH`, `decoration`, `whiteSpace`, `italic`, …).
- `MIXED_VALUE_PROPS` (`width/height/w/h`): `'<n>%'` → keep as string, else `parseFloat`.
- `NUMERIC_PROPS` (33 keys): `parseFloat`, NaN → keep raw string.
- `lineHeight` special-case: `'<n>%'` preserved.
- `'true'/'false'` → boolean (precedes numeric branch).

Note: `STRING_VALUE_PROPS` line 39 still lists `layout` (fine), but post-`58656a4` the value space is narrow. There's no analogous coercion-time gate.

---

## 2. Multi-entry Table (Figma target → all DSL inputs)

Grouped by Figma API property. **All entries that can write the same target.** "Recommendation" reflects the same logic as the layout fail-fast: keep one canonical entry the LLM is trained on, deprecate or strict-collapse the rest.

### `layoutMode` ← 2 entries
- `layout` — narrow vocab, fail-fast (`expandShorthands.ts:93-102`) **← canonical**
- `layoutMode` — direct write via `KNOWN_PROP_KEYS`, no enum check until `node-normalizers.ts` step 5 (which accepts only HORIZONTAL/VERTICAL/NONE — **GRID is missing from PROPERTY_META.layoutMode.enumMap**, so a direct write of `layoutMode:'GRID'` would be dropped! `figma-property-registry.ts:1230`)
- **Stale alternate path**: `templateCompiler.ts:521` still has `?? props.layout.toUpperCase()` fallback. Dead since `58656a4` because `applyLayoutDefaults` runs *after* `expandShorthands` already threw on bad layout. Confirm via test, then delete the stale `LAYOUT_KEYWORD_TO_MODE` lookup + uppercase fallback.
- **Recommendation**: (a) delete `templateCompiler.ts:497-500, 518-522` stale lookup; (b) add `GRID` to `PROPERTY_META.layoutMode.enumMap`; (c) keep both `layout` and `layoutMode` (LLM training prior is strong), but strict the `layoutMode` direct path so unknown values are rejected (currently silently dropped post-PROPERTY_META).

### `layoutSizingHorizontal` ← 6 entries
- `width`/`w` (`'fill'`/`'100%'`/`'hug'`) — `expandShorthands.ts:190-200, 303`
- `sizing` (single value sets both axes) — `expandShorthands.ts:214-223`
- `sizingH` — `expandShorthands.ts:353`
- `pattern` — bundled (deletes itself if `w/width/sizingH/sizing` present) — `expandShorthands.ts:113-115`
- `layoutSizingHorizontal` — direct write via PROPERTY_META
- All four expander paths use `String(v).toUpperCase()` **with no enum check at expansion time**; PROPERTY_META later catches unknowns at `node-normalizers.ts:147-166` (FIXED/FILL/HUG/AUTO→HUG/STRETCH→FILL).
- **Recommendation**: Replace 5x `String(v).toUpperCase()` with a shared `mapSizing()` that fail-fasts (mirror `layout`). The current "expand uppercase, drop downstream" pattern silently swallows typos like `sizingH:'fil'`.

### `layoutSizingVertical` ← 6 entries — symmetric to above

### `primaryAxisAlignItems` ← 5 entries
- `align` (single token sets both, two-token sets main+cross) — `expandShorthands.ts:123-135`
- `justify` — `expandShorthands.ts:138`
- `justifyContent` — `expandShorthands.ts:137`
- `alignMain` — `expandShorthands.ts:331`
- `primaryAxisAlignItems` — direct write
- All call `mapAlign()` which does `ALIGN_MAP[norm(v)] ?? v.toUpperCase()` — **upper fallback**.
- **Recommendation**: Tighten `mapAlign` to throw (or return undefined and have caller drop) on unknown. Trained vocabulary for LLMs covers center/start/end/space-between — the upper fallback catches at most 1-2 stray cases per session.

### `counterAxisAlignItems` ← 4 entries
- `align` (cross axis), `alignItems`, `alignCross`, direct — same fallback shape as above.

### `width` (numeric) ← 2 entries
- `width`/`w` (`'<n>'` / `'<n>px'` / `number`) — `expandShorthands.ts:190-200`
- `width` direct via PROPERTY_META — Number() coerced
- Fallback: if `width:'foo'` is passed, `parseFloat → NaN`, then `expandShorthands` returns `{ width: 'foo' }` (no parse), then PROPERTY_META scalar-range gate at `node-normalizers.ts:170-178` drops it with a warn. Safe but circuitous.

### `height` ← 2 entries — symmetric to width

### `cornerRadius` ← 3 entries
- `radius` — supports `number \| 'full' \| number[4]` — `expandShorthands.ts:266-274`
- `corner` — alias for `radius` — `expandShorthands.ts:276`
- `borderRadius` — **bare passthrough** `{ cornerRadius: v }`, no parsing — `expandShorthands.ts:281`
- `cornerRadius` — direct write via PROPERTY_META
- **Recommendation**: Either delete `borderRadius` (LLM doesn't need 3 spellings) or have it delegate to `radius` so `'12px'`/`'full'`/`number[4]` shapes work the same. Current state: `borderRadius:'12px'` writes the literal string `'12px'` to Figma.

### `fills` ← 4 entries
- `fill`, `background`, `bg` (all alias to `EXPANDERS.fill`) — `expandShorthands.ts:226-236`
- `fills` direct (color/array passthrough → `lowerPaints`)
- **Recommendation**: Three spellings all map to one expander; this is fine — well-trained vocabulary, low cost.

### `strokes` / `strokeWeight` / `strokeAlign` ← shared inputs
- `stroke` shorthand (one string, all three composed) — `expandShorthands.ts:238-253`
- `outline` shorthand (forces `OUTSIDE` align) — `expandShorthands.ts:502-513`
- `strokeW`/`strokeA`/`strokeJ`/`strokeC` per-aspect — `expandShorthands.ts:344-347`
- `strokes`/`strokeWeight`/`strokeAlign`/etc. direct
- **Recommendation**: Keep — overlap is minor, LLM tends to pick one shape per call.

### `itemSpacing` ← 2 entries
- `gap` (also routes to `gridRowGap+gridColumnGap` if container is GRID) — `expandShorthands.ts:164-171`
- `itemSpacing` direct
- **Recommendation**: Keep — `gap` is the universally-trained name, `itemSpacing` is the canonical Figma name. No fallback issues.

### `gridRowGap` / `gridColumnGap` ← 3 entries each
- `gap` (when GRID) splits to both
- `rowGap`/`colGap`/`columnGap`
- direct
- **Recommendation**: Keep — clean.

### `padding{Top,Right,Bottom,Left}` ← 4-way fan-out
- `padding`/`p` (string/number/array/object → all 4) — `expandShorthands.ts:142-162`
- `pt`/`pr`/`pb`/`pl` per-side — `expandShorthands.ts:306-309`
- `px` (left+right), `py` (top+bottom)
- `paddingTop`/etc. direct
- **Recommendation**: Keep — convergent, no fallbacks.

### `fontWeight` ← 3 entries
- `weight` (alias map of 9 names → "Regular"/"Bold"/etc.) — `expandShorthands.ts:319-329`
- `fontWeight` direct
- (also resolved as part of `fontName` via `fontNameSpec`, `domain/property-specs.ts:453-489`)
- **Fallback**: `weight:'foo'` → `WEIGHT_ALIASES['foo'] ?? s` → string `'foo'` written to fontWeight, font load may fail downstream silently.
- **Recommendation**: Strict the alias map — drop unknowns and warn. Font weight names are a closed enum (Inter has 9, Google Fonts publish them).

### `lineHeight` ← 2 entries (shape transform)
- `lineHeight` / `leading` aliases — multiplier detection (1-5 → percent) — `expandShorthands.ts:338-343`
- direct + `unitValueHandler` lowering (`figma-lowering.ts:68-79`)
- **Edge case**: A user writing `lineHeight: 6` (literal pixels) passes through as `6` → `unitValueHandler` writes `{value:6, unit:'PIXELS'}`. A user writing `lineHeight: 5` (intending pixels) gets `{value:500, unit:'PERCENT'}`. The 1-5 boundary is heuristic, not declarative.

### `textDecoration` ← 1 entry (1 alias) — `decoration`/`textDecoration`. Upper fallback.

### `clipsContent` ← 2 entries — `overflow`/`clips`/direct. Strict.

### `layoutWrap` ← 2 entries — `wrap`/direct. Upper fallback (mostly safe due to PROPERTY_META).

### `rotation` ← 2 entries — `rotate` (sign-flipped) / `rotation` (direct, raw degrees). Both write `rotation` but with **opposite sign convention**. ⚠️

### `constraints` ← 2 entries — `pin` shorthand / `constraints` direct (parsed by `constraintsSpec` `domain/property-specs.ts:412-447`). Drop fallback (unknown enum → MIN).

### `constrainProportions` ← 2 entries — `lockRatio` / direct. Strict.

### `cornerSmoothing` ← 2 entries — `smooth` / direct. Strict.

### `effects` ← 4 entries (merged in pre-pass)
- `shadow` — string/array — `expandShorthands.ts:256-260`
- `blur` — number → LAYER_BLUR — `expandShorthands.ts:262`
- `bgblur` — number → BACKGROUND_BLUR — `expandShorthands.ts:263`
- `effects` direct
- Pre-pass at `expandShorthands.ts:558-568` merges all 3 shorthands' arrays before main pass.
- **Recommendation**: Keep — well-designed merge.

### `vectorPaths` ← 2 entries — `path` (single string) / `paths` (array). Both drop on bad input.

### `arcData` ← 1 entry (`arc`) + direct.

### `hyperlink` ← 1 entry (`link`) + direct + `hyperlinkHandler` (parses `'NODE:<id>'`).

### `layoutPositioning` ← 2 entries — `positioning` (`String(v).toUpperCase()`) / direct. PROPERTY_META catches unknowns; `RELATIVE→AUTO` aliasing happens in PROPERTY_META.

### `gridChildHorizontalAlign` / `Vertical` ← 2 entries — `alignX`/`alignY` (upper fallback) / direct.

### `gridRowSpan` / `gridColumnSpan` ← 2 entries — `rowSpan`/`colSpan`/`columnSpan` / direct.

### `scaleMode` ← 1 entry (`fit`) + direct on `fills` paint object. Upper fallback.

---

## 3. Tolerant Fallback Inventory

Each entry below silently lets unknown LLM input through. After the `layout` fail-fast precedent, every `?? toUpperCase()` is in scope for the same treatment.

| File:line | Pattern | Context | Notes |
|---|---|---|---|
| `expandShorthands.ts:54` | `ALIGN_MAP[norm(v)] ?? v.toUpperCase()` | `mapAlign` (used by `align`, `justify`, `justifyContent`, `alignItems`, `alignMain`, `alignCross`) | **Same shape as old `resolveLayoutMode`.** Direct candidate for fail-fast collapse. |
| `expandShorthands.ts:58` | `GRID_ALIGN_MAP[norm(...)] ?? String(v).toUpperCase()` | `mapGridAlign` (used by `alignX`, `alignY`) | Same shape. |
| `expandShorthands.ts:216` | `const s = v.toUpperCase()` (no map check) | `sizing` shorthand expander | Forwards raw uppercased to `layoutSizing*`; PROPERTY_META catches it. |
| `expandShorthands.ts:220` | `String(v[0]).toUpperCase()` / `String(v[1]).toUpperCase()` | `sizing` array form | Same as above. |
| `expandShorthands.ts:244` | `result.strokeAlign = p.toUpperCase()` | `stroke` shorthand parser (per-token branch) | No enum check; PROPERTY_META catches. |
| `expandShorthands.ts:297` | `return { layoutWrap: String(v).toUpperCase() }` | `wrap` (else-branch) | Caller already mapped wrap/no-wrap; this is the dead else. PROPERTY_META gate catches. |
| `expandShorthands.ts:333` | `String(v).toUpperCase()` | `textAlign` | No enum check at this layer. |
| `expandShorthands.ts:334` | `String(v).toUpperCase()` | `positioning` | Same. |
| `expandShorthands.ts:345-347` | `String(v).toUpperCase()` | `strokeA`/`strokeJ`/`strokeC` | Same. |
| `expandShorthands.ts:353-354` | `String(v).toUpperCase()` | `sizingH`/`sizingV` | Same. |
| `expandShorthands.ts:373` | `DECO_MAP[norm(...)] ?? String(v).toUpperCase()` | `decoration` | Same shape as align. |
| `expandShorthands.ts:377` | `String(v).toUpperCase()` | `decorationStyle` | Same. |
| `expandShorthands.ts:498` | `FIT_MAP[norm(...)] ?? String(v).toUpperCase()` | `fit` (image scaleMode) | Same shape as align. |
| `expandShorthands.ts:196, 208` | `parseFloat(w)` — succeeds → numeric; fails → falls through to `{width: v}` literal pass-through | `width`/`height` | Type-mismatch downstream, but Figma `resize()` will throw and `resizeHandler.ts:18-19` catches with warning. |
| `expandShorthands.ts:199, 211` | `return { width: v }` / `return { height: v }` (final fallthrough when no string parse matched) | `width`/`height` | **Silent passthrough** — non-numeric, non-`fill/hug/100%` strings reach Figma raw. |
| `expandShorthands.ts:281` | `borderRadius: (v) => ({ cornerRadius: v })` | `borderRadius` direct passthrough | **No parsing** — `'12px'`, `'full'`, arrays all bypass `radius` expander semantics. Bug-shaped. |
| `expandShorthands.ts:280` | `blend: (v) => ({ blendMode: v })` | `blend` direct passthrough | No upper, no enum check; PROPERTY_META catches. |
| `expandShorthands.ts:328` | `WEIGHT_ALIASES[normalized] ?? s` | `weight` alias map | Pass-through to fontName resolver; bad weights cause silent font-load failure (no enum check, no warn). |
| `templateCompiler.ts:521` | `LAYOUT_KEYWORD_TO_MODE[...] ?? props.layout.toUpperCase()` | `applyLayoutDefaults` (JSX walk pre-pass for sizing defaults) | **Stale**, dead since `58656a4`. Same pattern that `resolveLayoutMode` used to have. Delete or assert-unreachable. |
| `templateCompiler.ts:217` | `ALIGN_MAP[v.toLowerCase()] ?? v.toUpperCase()` | `mapAlign` inside template `align()` function | Same fallback shape; impacts only JSX template-function callers. |
| `LayoutValidator.ts:48-55, 67-70, 74-77` | Silent demotion HUG→FIXED, FILL→FIXED/HUG | `normalizeSizing` (post-expansion) | **Not unknown-value tolerance** — these are deterministic constraint-fixups; the recent commit `cdadde0` added a `console.warn` so reachability can be measured. Audit only — keep. |
| `editHandler.ts:65` | `typeof value === 'string' ? coerceValue(...) : value` | `buildNormalizedProps` (edit pipeline) | Coerces only string-typed inputs; numeric/boolean JSX values pass through untouched. |
| `node-normalizers.ts:139-144` | `if (boolProp ... typeof !== 'boolean') ... v === 'true' ...` | Boolean-prop string coercion | Strict — anything not `'true'/'hidden'/'clip'` becomes `false`. |
| `writeHandlers.ts:84-92` | local `applyLayoutDefaults` (different impl from templateCompiler) | inside `executeSingleMk` and `executeMkBatch` | **Dead code** — `handleMk` is exported but never imported by the dispatcher (confirmed: only self-references). The legacy `mk` parser path is unreachable from current tools. |
| `writeHandlers.ts:38-48, 95-135` | `parseTokensToProps`, `parsePropString` — `key:value` token parser feeding `coerceValue` | `mk` parser | Same — dead. |

---

## 4. Source Dialects in the DSL

The DSL accepts inputs from at least 4 different dialects, often inside the same key. This is what creates the "is the LLM writing CSS or Figma?" cognitive load.

### CSS-like
- `'100%'` → `layoutSizingHorizontal:'FILL'` (`expandShorthands.ts:193, 205`)
- `'<n>px'` → strip "px" suffix to number (`expandShorthands.ts:196, 208`)
- `'1.5'` (line-height multiplier 1–5) → `'150%'` (`expandShorthands.ts:340`)
- `'space-between'`, `'space-around'`, `'space-evenly'`, `'flex-start'`, `'flex-end'` → folded into Figma's MIN/MAX/SPACE_BETWEEN (`expandShorthands.ts:30-34`); the around/evenly map degrades to SPACE_BETWEEN (closest available)
- `'<top> <right> <bottom> <left>'` shorthand for `padding` (`expandShorthands.ts:142-162`)
- `'inset' '<n>px' '<color>'` shorthand for `shadow` (`property-specs.ts:249-282`)
- `linear-gradient(...)` / `radial-gradient(...)` (`property-specs.ts:78-87` via `gradient-parser.ts`)
- `'line-through'` → STRIKETHROUGH (`expandShorthands.ts:371`)
- `'nowrap'/'normal'/'pre'` for `whiteSpace` (`expandShorthands.ts:427-429`)
- `'cover'/'contain'/'crop'` for `fit` (`expandShorthands.ts:494-497`)
- DSL keys themselves: `borderRadius`, `lineHeight`, `letterSpacing`, `fontWeight`, `fontFamily`, `fontStyle`, `fontSize`, `whiteSpace`, `justifyContent`, `alignItems`, `textAlign`, `overflow`

### Tailwind-like
- `pt`/`pr`/`pb`/`pl`/`px`/`py` for padding (`expandShorthands.ts:306-317`)
- `w`/`h` for width/height (`expandShorthands.ts:303-304`)
- `'fill'`/`'hug'`/`'full'` (Figma's own naming, but Tailwind-flavoured)
- `gap`, `row`, `column` (these are also Figma names so they overlap)

### Figma-native direct
- All keys in `PROPERTY_META` (1k+ lines) are accepted as-is and bypass the expander entirely. This is how `layoutMode='HORIZONTAL'`, `layoutSizingHorizontal='FILL'`, `primaryAxisAlignItems='CENTER'` reach the API. **Confirmed**: per the layout fail-fast commit, the `layout` expander no longer reads `layoutMode`, but PROPERTY_META still allows direct writes.

### Compact custom shorthand
- `corner`, `radius`, `smooth` (Figma terminology, abbreviated)
- `strokeW/A/J/C/T/R/B/L` (compressed Figma names)
- `minW/maxW/minH/maxH` (compressed Figma names)
- `align`/`justify`/`alignMain`/`alignCross` (custom — neither CSS nor Figma)
- `pattern` ("row"/"column"/"row-fill"/"column-fill"/"stack" macro bundles)
- `arc` ("0 270 0.5" / "ring 0.5") — degrees + optional inner radius
- `pin` ("MIN,CENTER" → constraints object)
- `path` / `paths` (raw SVG path data)
- `outline` (force OUTSIDE stroke)
- `dash` ("10,5" or "10 5")
- `link` (URL or "NODE:<id>")
- `bg` (background as fill alias)
- `weight` (font weight name)

### Variable references
- `$colors/primary` → variable binding via `variableBindingHandler.ts` (10 places in `expandShorthands.ts` use `isVarRef` to short-circuit pass-through)

### "Anything looks correct"
- `align="space-around"` accepted, silently mapped to SPACE_BETWEEN (`expandShorthands.ts:33`). This is a stylistic choice but worth flagging — the LLM can't tell it didn't get what it asked for.

---

## 5. Issues & Convergence Recommendations

Ordered by impact (= occurrences × LLM error frequency × downstream silence).

### P1: `mapAlign` upper fallback — 8 entry points
**Currently**: `ALIGN_MAP[norm(v)] ?? v.toUpperCase()` at `expandShorthands.ts:54`.
**Risk**: Most-used family of shorthands (align, justify, justifyContent, alignItems, alignMain, alignCross, plus `align` two-arg form). LLM typos like `align:'centre'` or `align:'middle'` write `CENTRE`/`MIDDLE` to Figma → PROPERTY_META drops with warn → no auto-correction signal back to LLM in the same iteration (it gets a downstream warn it ignores).
**Fix**: Make `mapAlign` throw with `valid: center|start|end|space-between|baseline` — same shape as `layout` fail-fast. The throw surfaces in tool error → next iteration fixes it.

### P2: `templateCompiler.ts:521` stale `LAYOUT_KEYWORD_TO_MODE ?? toUpperCase` 
**Currently**: Dead since `58656a4` because the `layout` expander throws before reaching `applyLayoutDefaults`.
**Fix**: Delete `LAYOUT_KEYWORD_TO_MODE` (`templateCompiler.ts:497-500`) and simplify the `layoutMode` derivation at `:518-522` to read only `props.layoutMode` (which by now reflects the expanded value). Same dead path lives in `writeHandlers.ts:84-92`; entire `mk` parser is dead and could go.

### P3: `borderRadius` is a no-op pass-through
**Currently**: `borderRadius: (v) => ({ cornerRadius: v })` at `expandShorthands.ts:281`. A user writing `borderRadius:'12px'` gets the literal string into Figma, which throws.
**Fix**: Either delete `borderRadius` (LLM has `radius`/`corner`/`cornerRadius` already) or make it `EXPANDERS.radius(v, {})` so all the same value forms work.

### P4: `mapGridAlign` upper fallback (2 entry points: `alignX`, `alignY`)
Same shape as P1, smaller blast radius. Collapse to fail-fast at the same time as P1.

### P5: `decoration` and `fit` — `?? toUpperCase()` fallbacks
`expandShorthands.ts:373` and `:498`. Same shape, narrower vocab. Fail-fast or drop (return `{}` and let PROPERTY_META warn).

### P6: `weight` alias fallthrough
`expandShorthands.ts:328`: `WEIGHT_ALIASES[normalized] ?? s`. Bad font weights (e.g. `weight:'400'`) silently pass to Figma's font loader and either silently substitute `Regular` or fail to apply text. **Fix**: Drop unknowns and warn. The Inter family weights are a known closed set; Google Fonts also publish theirs.

### P7: `sizing` family direct uppercase (5 expanders)
`sizing`, `sizingH`, `sizingV` use `String(v).toUpperCase()` with no enum check. Currently only saved by PROPERTY_META catching FIXED/FILL/HUG/AUTO/STRETCH at `node-normalizers.ts` step 5. **Fix**: Centralize to `mapSizing()` that maps the LLM-friendly inputs (`fill/hug/fixed/auto/stretch`) and throws on unknowns. Delete the duplicate enum knowledge between expander and PROPERTY_META.

### P8: `layoutMode` direct write skips GRID
`PROPERTY_META.layoutMode.enumMap` at `figma-property-registry.ts:1230` lacks `GRID`. So while `layout:'grid'` works, `layoutMode:'GRID'` directly is silently dropped by `node-normalizers.ts:147-166`. **Fix**: Add `GRID: 'GRID'` to the enumMap.

### P9: `width`/`height` final fallthrough
`expandShorthands.ts:199, 211`: `return { width: v }` after the string-handling block. If `v` is a non-numeric string that also isn't `fill/hug/100%`, it slips through unparsed. Currently saved by `resizeHandler.ts:18-19` which catches the throw, but the LLM doesn't see "I gave you a bad number" as cleanly as a fail-fast.

### P10: `align="space-around"` silently maps to SPACE_BETWEEN
`expandShorthands.ts:33-34`. This is a "best approximation" choice (Figma genuinely lacks SPACE_AROUND). Worth either keeping as-is (current behaviour) and documenting in tool description, or rejecting so the LLM picks an alternative layout strategy intentionally. **Recommendation**: keep, but note in the system prompt knowledge entry — the silent translation creates a "I asked for X, got Y, can't tell why" loop.

### P11: `setLayout` setter doesn't pass through grid params
`setterAdapter.ts:88-106` filters params to `layout/gap/p/justify/align/wrap`. But the `set_layout` tool description (`setterTools.ts:99-117`) advertises `cols/rows/rowGap/colGap`. So `set_layout({node, layout:'grid', cols:3, rows:2, gap:16})` quietly drops cols/rows. **Fix**: Add `cols/rows/rowGap/colGap` to the param-forwarding list at `setterAdapter.ts:94-99`.

### Lower-impact (keep as-is, accept multi-entry):
- `bg`/`background`/`fill` ← all converge to one expander, low cost.
- `pt`/`pr`/`pb`/`pl`/`px`/`py` vs `padding` — clean, no fallback.
- `gap` (with GRID auto-routing) — clean.
- Direct Figma names alongside abbreviations (`weight`/`fontWeight`, `font`/`fontFamily`, etc.) — LLM training prior is strong both ways.

---

## 待确认 (Unresolved)

1. **Deprecation status of `mk`/`writeHandlers.ts`**: `handleMk` is exported but no dispatcher imports it. `useDevBridge.ts:64` references the string `'mk'` for filtering, suggesting historical telemetry. Verify it's truly dead before deleting `parseTokensToProps`/`parsePropString`/`extractOverridesFromTokens`/`applyLayoutDefaults`/`executeSingleMk`/`executeMkBatch` (~400 lines).
2. **`PROPERTY_META.clipsContent.enumMap`** at `figma-property-registry.ts:1331` lists `{'true':'true','false':'false'}` (string keys). `expandShorthands.ts:283-291` returns a real boolean. The Step 4 boolean-coercion loop at `node-normalizers.ts:139-144` should rescue this, but the enum map is suspicious — could it accidentally re-stringify? Worth a unit test.
3. **`textAutoResize` enum has TRUNCATE** at `figma-property-registry.ts:1277`, but `truncate` shorthand at `expandShorthands.ts:418-422` writes `textAutoResize:'NONE'`. That's likely intentional (TRUNCATE only matters when `maxLines` is set), but the divergence between the enum allowing TRUNCATE and the shorthand not using it is worth confirming with someone who's debugged truncation issues.
4. **`align` two-arg form ordering**: `expandShorthands.ts:134` returns `{primary: parts[0], counter: parts[1]}` — i.e. "main cross" order. The single-arg form sets *both* axes. Is the two-arg "main cross" or "cross main" the trained convention? (CSS shorthand is actually "row cross-axis" for `place-items` which is cross-then-main). Not a code bug, just a doc concern.
5. **JSX `align()` template function** (`templateFunctions.ts:225-233`) has *opposite* single-arg semantics from the JSX attribute `align`: single arg sets `counterAxisAlignItems` only, not both axes. Inconsistency between two parts of the same DSL.
