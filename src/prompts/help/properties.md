---
id: properties
title: Property Reference (mk command)
keywords: [mk, properties, props, property, reference, attribute, shorthand, fill, bg, layout, padding, width, height, font, size, weight, corner, radius, shadow, blur, stroke, align, gap, opacity, clip, wrap, border, text, color, create, update, icon, iconify, iconName, lucide, mdi]
whenToUse: When you need to know available property names for mk create/update commands
---

### PROPERTY REFERENCE

Properties use `key:value` syntax in mk commands. Both shorthand and canonical names are accepted.

#### Layout
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `layout` | layoutMode | `row`, `column`, `none` |
| `pattern` | (composite) | `row`, `column`, `row-fill`, `column-fill`, `stack` |
| `align` | primary+counterAxisAlignItems | `center`, `start`, `end`, `space-between` |
| `alignMain` | primaryAxisAlignItems | `center`, `start`, `end`, `space-between` |
| `alignCross` | counterAxisAlignItems | `center`, `start`, `end`, `baseline` |
| `gap` | itemSpacing | number |
| `crossGap` | counterAxisSpacing | number |
| `wrap` | layoutWrap | `wrap`, `nowrap` |
| `positioning` | layoutPositioning | `auto`, `absolute` |

#### Sizing
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `w` | width | number, `fill`, `hug` |
| `h` | height | number, `fill`, `hug` |
| `sizing` | layoutSizingH+V | `HUG`, `FILL`, `FIXED` |
| `sizingH` | layoutSizingHorizontal | `HUG`, `FILL`, `FIXED` |
| `sizingV` | layoutSizingVertical | `HUG`, `FILL`, `FIXED` |
| `minW` | minWidth | number |
| `maxW` | maxWidth | number |
| `minH` | minHeight | number |
| `maxH` | maxHeight | number |
| `lockRatio` | constrainProportions | `true`, `false` |

#### Spacing
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `p` | padding (all sides) | number or `top right bottom left` |
| `pt` | paddingTop | number |
| `pr` | paddingRight | number |
| `pb` | paddingBottom | number |
| `pl` | paddingLeft | number |

#### Appearance
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `fill` / `bg` | fills | `#hex`, `transparent`, `none` |
| `stroke` | strokes+strokeWeight+strokeAlign | `#hex width align` |
| `strokeW` | strokeWeight | number |
| `strokeA` | strokeAlign | `inside`, `outside`, `center` |
| `strokeJ` | strokeJoin | `miter`, `bevel`, `round` |
| `strokeC` | strokeCap | `none`, `round`, `square` |
| `dash` | dashPattern | array e.g. `[10,5]` |
| `strokeT/R/B/L` | strokeTop/Right/Bottom/LeftWeight | number |
| `opacity` | opacity | 0-1 |
| `blend` | blendMode | `normal`, `multiply`, `screen`, etc. |
| `visible` | visible | `true`, `false` |

#### Shape
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `corner` / `radius` | cornerRadius | number, `full`, `[tl,tr,bl,br]` |
| `smooth` | cornerSmoothing | 0-1 |
| `overflow` | clipsContent | `hidden`/`clip`=true, `visible`=false |

#### Effects
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `shadow` | effects | `"x y blur spread #color"` |
| `blur` | effects (layer blur) | number (radius) |
| `bgblur` | effects (bg blur) | number (radius) |

#### Text
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `size` | fontSize | number |
| `weight` | fontWeight | `thin`, `light`, `regular`, `medium`, `semi-bold`, `bold`, `extra-bold`, `black` |
| `font` | fontFamily | string |
| `textAlign` | textAlignHorizontal | `left`, `center`, `right`, `justified` |
| `leading` / `lineHeight` | lineHeight | number or `%` (values <=5 treated as multiplier) |
| `tracking` | letterSpacing | number |
| `characters` | characters | text content (or use `-- text` syntax) |
| `textAutoResize` | textAutoResize | `WIDTH_AND_HEIGHT`, `HEIGHT`, `NONE`, `TRUNCATE` |
| `textTruncation` | textTruncation | `DISABLED`, `ENDING` |
| `maxLines` | maxLines | number |
| `textCase` | textCase | `UPPER`, `LOWER`, `TITLE`, `ORIGINAL` |
| `textDecoration` | textDecoration | `NONE`, `UNDERLINE`, `STRIKETHROUGH` |

#### Layout Details
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `x` | x | number (position) |
| `y` | y | number (position) |
| `rotation` | rotation | number (degrees) |
| `pin` | constraints | `{horizontal, vertical}` |
| `strokesInLayout` | strokesIncludedInLayout | `true`, `false` |
| `reverseZ` | itemReverseZIndex | `true`, `false` |
| `layoutGrow` | layoutGrow | 0 or 1 |
| `layoutAlign` | layoutAlign | `STRETCH`, `INHERIT` |

#### Icon
| Shorthand | Canonical | Values |
|-----------|-----------|--------|
| `iconName` | iconName | `prefix:name` — Iconify API format |
| `w` | width | number (default 24) |
| `h` | height | number (default 24) |
| `fill` | fills | `#hex` — recolors all icon vectors |

**Prefixes**: `lucide`, `mdi`, `heroicons`, `tabler`, `f7`, `hugeicons`, `logos` (brand icons with original colors).
**Example**: `mk /Card/Icon icon iconName:lucide:heart w:20 h:20 fill:#EF4444`

#### Variable Binding
Any property value starting with `$` binds to a Figma variable: `fill:$colors/primary`
