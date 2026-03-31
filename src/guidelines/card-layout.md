# Card Layout Design Guidelines

## 1. Purpose & Scope

**Use for**: Product grids, blog post lists, team member grids, pricing cards, feature showcases, gallery layouts.

**Do NOT use for**: Data tables (use table guideline), navigation lists, form layouts.

**Card grid container**: `width='fill'` or explicit width, `layout='row'`, `wrap='wrap'` for responsive-like grids.

## 2. Layout Template

```
+---Card Grid (row, wrap, gap=24)---+
| +--Card--+ +--Card--+ +--Card--+ |
| | Image  | | Image  | | Image  | |
| | Title  | | Title  | | Title  | |
| | Desc   | | Desc   | | Desc   | |
| | Footer | | Footer | | Footer | |
| +--------+ +--------+ +--------+ |
+-----------------------------------+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Card Grid' layout='row' gap='24' wrap='wrap' width='fill' height='hug' bg='transparent'>
  <frame name='Card 1' layout='column' gap='0' w='360' height='hug' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A' overflow='hidden'>
    <frame name='Image' w='fill' h='200' bg='#E5E7EB'/>
    <frame name='Content' layout='column' gap='12' p='20' width='fill' height='hug' bg='transparent'>
      <text name='Title' size='18' weight='Bold' fill='#111827' width='fill'>Card Title</text>
      <text name='Description' size='14' fill='#6B7280' lineHeight='160%' width='fill'>Description text goes here with enough detail.</text>
    </frame>
    <frame name='Footer' layout='row' justifyContent='space-between' alignItems='center' p='16 20' width='fill' height='hug' bg='transparent' stroke='#F3F4F6' strokeW='1'>
      <text name='Meta' size='12' fill='#9CA3AF'>Jan 15, 2026</text>
      <text name='Action' size='14' weight='Medium' fill='#4F46E5'>Read more</text>
    </frame>
  </frame>
  {/* More cards follow the same structure */}
</frame>
```

## 3. Component Patterns

### Basic Content Card

```xml
<frame name='Card' layout='column' gap='16' p='24' w='360' height='hug' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A'>
  <text name='Title' size='18' weight='Bold' fill='#111827' width='fill'>Card Title</text>
  <text name='Description' size='14' fill='#6B7280' lineHeight='160%' width='fill'>A brief description that provides context about this card's content.</text>
  <frame name='Action' layout='row' width='hug' height='hug' bg='transparent'>
    <text name='Link' size='14' weight='Medium' fill='#4F46E5'>Learn more</text>
  </frame>
</frame>
```

### Image Card (top image)

```xml
<frame name='Image Card' layout='column' gap='0' w='360' height='hug' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A' overflow='hidden'>
  <frame name='Image' width='fill' h='200' bg='#E5E7EB'/>
  <frame name='Content' layout='column' gap='12' p='20' width='fill' height='hug' bg='transparent'>
    <frame name='Tags' layout='row' gap='8' width='fill' height='hug' bg='transparent'>
      <frame name='Tag' layout='row' p='4 10' width='hug' height='hug' bg='#EEF2FF' corner='12'>
        <text name='Label' size='12' weight='Medium' fill='#4F46E5'>Design</text>
      </frame>
    </frame>
    <text name='Title' size='18' weight='Bold' fill='#111827' width='fill'>Article Title Here</text>
    <text name='Description' size='14' fill='#6B7280' lineHeight='160%' width='fill'>A short preview of the article content that gives readers context.</text>
  </frame>
</frame>
```

### Product Card

```xml
<frame name='Product Card' layout='column' gap='0' w='280' height='hug' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A' overflow='hidden'>
  <frame name='Image' width='fill' h='280' bg='#F9FAFB'/>
  <frame name='Content' layout='column' gap='8' p='16' width='fill' height='hug' bg='transparent'>
    <text name='Category' size='12' weight='Medium' fill='#6B7280'>Electronics</text>
    <text name='Name' size='16' weight='Bold' fill='#111827' width='fill'>Product Name</text>
    <frame name='Price Row' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
      <text name='Price' size='18' weight='Bold' fill='#111827'>$49.99</text>
      <text name='Original' size='14' fill='#9CA3AF' textDecoration='strikethrough'>$79.99</text>
    </frame>
    <frame name='Rating' layout='row' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
      <icon name='Star' icon='lucide:star' size='14' fill='#F59E0B'/>
      <text name='Score' size='12' fill='#6B7280'>4.8 (124 reviews)</text>
    </frame>
  </frame>
</frame>
```

### Pricing Card (highlighted)

```xml
<frame name='Pricing Card' layout='column' gap='24' p='32' w='340' height='hug' bg='#FFFFFF' corner='16' stroke='#4F46E5' strokeW='2' shadow='0,4,24,0,#4F46E51A'>
  <frame name='Header' layout='column' gap='8' width='fill' height='hug' bg='transparent'>
    <frame name='Badge' layout='row' p='4 12' width='hug' height='hug' bg='#EEF2FF' corner='12'>
      <text name='Popular' size='12' weight='Bold' fill='#4F46E5'>Most Popular</text>
    </frame>
    <text name='Plan' size='20' weight='Bold' fill='#111827'>Pro</text>
    <frame name='Price' layout='row' gap='4' alignItems='baseline' width='hug' height='hug' bg='transparent'>
      <text name='Amount' size='36' weight='Bold' fill='#111827'>$29</text>
      <text name='Period' size='14' fill='#6B7280'>/month</text>
    </frame>
  </frame>
  <frame name='Features' layout='column' gap='12' width='fill' height='hug' bg='transparent'>
    <frame name='Feature 1' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='transparent'>
      <icon name='Check' icon='lucide:check' size='16' fill='#10B981'/>
      <text name='Label' size='14' fill='#374151'>Unlimited projects</text>
    </frame>
    <frame name='Feature 2' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='transparent'>
      <icon name='Check' icon='lucide:check' size='16' fill='#10B981'/>
      <text name='Label' size='14' fill='#374151'>Priority support</text>
    </frame>
  </frame>
  <frame name='CTA' layout='row' justifyContent='center' alignItems='center' p='12' width='fill' h='44' bg='#4F46E5' corner='8'>
    <text name='Label' size='16' weight='Bold' fill='#FFFFFF'>Get Started</text>
  </frame>
</frame>
```

### Team Member Card

```xml
<frame name='Team Card' layout='column' gap='16' alignItems='center' p='24' w='280' height='hug' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A'>
  <frame name='Avatar' w='80' h='80' corner='40' bg='#E5E7EB'/>
  <frame name='Info' layout='column' gap='4' alignItems='center' width='fill' height='hug' bg='transparent'>
    <text name='Name' size='16' weight='Bold' fill='#111827' textAlign='center'>Jane Smith</text>
    <text name='Role' size='14' fill='#6B7280' textAlign='center'>Lead Designer</text>
  </frame>
  <frame name='Socials' layout='row' gap='16' width='hug' height='hug' bg='transparent'>
    <icon name='Twitter' icon='lucide:twitter' size='18' fill='#6B7280'/>
    <icon name='LinkedIn' icon='lucide:linkedin' size='18' fill='#6B7280'/>
  </frame>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Card width (content) | `360` px |
| Card width (product) | `280` px |
| Card width (pricing) | `340` px |
| Grid gap | `24` px |
| Card padding | `24` px (content), `20` px (with image), `32` px (pricing) |
| Card corner | `12` px (standard), `16` px (pricing) |
| Card shadow | `0,2,8,0,#0000001A` |
| Image height | `200` px (blog), `280` px (product) |
| Content gap (internal) | `12` px |
| Title size | `18` px `Bold` |
| Description | `14` px `Regular` `#6B7280` |
| Tag padding | `4 10` px |
| Tag corner | `12` px (pill) |
| Footer border | `stroke='#F3F4F6' strokeW='1'` (top only) |
| Highlighted card border | `stroke='#4F46E5' strokeW='2'` |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Cards without `overflow='hidden'` when image is top | Add `overflow='hidden'` so image corners respect card radius |
| Image without explicit height | Always set `h='200'` or similar — `hug` collapses to 0 with no children |
| Cards in column layout | Card grids should be `layout='row'` with `wrap='wrap'` or `gap` |
| Inconsistent card widths in a grid | All cards in a row should have the same `w` value |
| No shadow on cards | Cards need `shadow` to separate from background |
| Content directly inside card (no padding wrapper) | Use a `Content` frame with padding when image is edge-to-edge |
| Missing `bg='transparent'` on inner frames | Content/footer frames inside cards: `bg='transparent'` |
