# Mobile App Design Guidelines

## 1. Purpose & Scope

**Use for**: Mobile app screens (iOS/Android), mobile web views, phone-size UI mockups.

**Do NOT use for**: Desktop dashboards, wide-screen layouts, tablet-specific layouts.

**Root frame**: `w='390' h='844'` — iPhone 14/15 standard viewport. Always use this as the mobile canvas.

## 2. Layout Template

```
+--------390px--------+
|  Status Bar (44px)   |
|  Navigation Bar      |
|    Title + Actions   |
+----------------------+
|                      |
|  Scrollable Content  |
|    Lists / Cards     |
|    ...               |
|                      |
+----------------------+
|  Bottom Nav (83px)   |
|  [Tab] [Tab] [Tab]  |
+--------390px--------+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Mobile Screen' layout='column' w='390' h='844' bg='#FFFFFF'>
  <frame name='Status Bar' layout='row' justifyContent='space-between' alignItems='center' p='0 24' width='fill' h='44' bg='transparent'>
    <text name='Time' size='14' weight='Medium' fill='#000000'>9:41</text>
    <frame name='Icons' layout='row' gap='6' alignItems='center' width='hug' height='hug' bg='transparent'>
      <icon name='Signal' icon='lucide:signal' size='14' fill='#000000'/>
      <icon name='Wifi' icon='lucide:wifi' size='14' fill='#000000'/>
      <icon name='Battery' icon='lucide:battery-full' size='14' fill='#000000'/>
    </frame>
  </frame>
  <frame name='Nav Bar' layout='row' justifyContent='space-between' alignItems='center' p='8 16' width='fill' h='44' bg='transparent'>
    <icon name='Back' icon='lucide:chevron-left' size='24' fill='#000000'/>
    <text name='Title' size='17' weight='Bold' fill='#000000'>Page Title</text>
    <icon name='More' icon='lucide:more-horizontal' size='24' fill='#000000'/>
  </frame>
  <frame name='Content' layout='column' gap='16' p='16' width='fill' height='fill' bg='transparent'>
    {/* Screen content goes here */}
  </frame>
  <frame name='Bottom Nav' layout='row' justifyContent='space-around' alignItems='center' p='8 0 34 0' width='fill' h='83' bg='#FFFFFF' shadow='0,-1,0,0,#0000001A'>
    {/* Tab items */}
  </frame>
</frame>
```

## 3. Component Patterns

### Mobile Navigation Bar (iOS style)

```xml
<frame name='Nav Bar' layout='row' justifyContent='space-between' alignItems='center' p='8 16' width='fill' h='44' bg='transparent'>
  <frame name='Left' layout='row' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Back' icon='lucide:chevron-left' size='24' fill='#007AFF'/>
    <text name='Back Label' size='17' fill='#007AFF'>Back</text>
  </frame>
  <text name='Title' size='17' weight='Bold' fill='#000000'>Settings</text>
  <frame name='Right' w='60' height='hug' bg='transparent'>
    <text name='Action' size='17' fill='#007AFF'>Done</text>
  </frame>
</frame>
```

### Bottom Tab Bar

```xml
<frame name='Bottom Nav' layout='row' justifyContent='space-around' alignItems='center' p='8 0 34 0' width='fill' h='83' bg='#FFFFFF' shadow='0,-1,0,0,#0000001A'>
  <frame name='Tab Active' layout='column' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Icon' icon='lucide:home' size='24' fill='#007AFF'/>
    <text name='Label' size='10' weight='Medium' fill='#007AFF'>Home</text>
  </frame>
  <frame name='Tab' layout='column' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Icon' icon='lucide:search' size='24' fill='#8E8E93'/>
    <text name='Label' size='10' fill='#8E8E93'>Search</text>
  </frame>
  <frame name='Tab' layout='column' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Icon' icon='lucide:heart' size='24' fill='#8E8E93'/>
    <text name='Label' size='10' fill='#8E8E93'>Favorites</text>
  </frame>
  <frame name='Tab' layout='column' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
    <icon name='Icon' icon='lucide:user' size='24' fill='#8E8E93'/>
    <text name='Label' size='10' fill='#8E8E93'>Profile</text>
  </frame>
</frame>
```

### List with Items

```xml
<frame name='List' layout='column' gap='0' width='fill' height='hug' bg='#FFFFFF'>
  <frame name='List Item' layout='row' gap='12' alignItems='center' p='12 16' width='fill' height='hug' bg='transparent'>
    <frame name='Icon Wrapper' layout='row' justifyContent='center' alignItems='center' w='36' h='36' bg='#007AFF' corner='8'>
      <icon name='Icon' icon='lucide:wifi' size='20' fill='#FFFFFF'/>
    </frame>
    <frame name='Content' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
      <text name='Label' size='17' fill='#000000'>Wi-Fi</text>
      <frame name='Right' layout='row' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
        <text name='Value' size='17' fill='#8E8E93'>Home Network</text>
        <icon name='Chevron' icon='lucide:chevron-right' size='16' fill='#C7C7CC'/>
      </frame>
    </frame>
  </frame>
  <line name='Separator' w='fill' stroke='#E5E5EA'/>
  <frame name='List Item 2' layout='row' gap='12' alignItems='center' p='12 16' width='fill' height='hug' bg='transparent'>
    <frame name='Icon Wrapper' layout='row' justifyContent='center' alignItems='center' w='36' h='36' bg='#34C759' corner='8'>
      <icon name='Icon' icon='lucide:bluetooth' size='20' fill='#FFFFFF'/>
    </frame>
    <frame name='Content' layout='row' justifyContent='space-between' alignItems='center' width='fill' height='hug' bg='transparent'>
      <text name='Label' size='17' fill='#000000'>Bluetooth</text>
      <frame name='Right' layout='row' gap='4' alignItems='center' width='hug' height='hug' bg='transparent'>
        <text name='Value' size='17' fill='#8E8E93'>On</text>
        <icon name='Chevron' icon='lucide:chevron-right' size='16' fill='#C7C7CC'/>
      </frame>
    </frame>
  </frame>
</frame>
```

### Section Header (grouped list)

```xml
<frame name='Section' layout='column' gap='0' width='fill' height='hug' bg='transparent'>
  <text name='Section Header' size='13' fill='#6D6D72' p='16 16 8 16'>GENERAL</text>
  <frame name='Group' layout='column' gap='0' width='fill' height='hug' bg='#FFFFFF' corner='10' p='0 16'>
    {/* List items here, separated by 1px rects */}
  </frame>
</frame>
```

### Mobile Card

```xml
<frame name='Card' layout='column' gap='12' p='16' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000001A'>
  <frame name='Header' layout='row' gap='12' alignItems='center' width='fill' height='hug' bg='transparent'>
    <frame name='Avatar' w='40' h='40' corner='20' bg='#E5E7EB'/>
    <frame name='Info' layout='column' gap='2' width='fill' height='hug' bg='transparent'>
      <text name='Name' size='15' weight='Medium' fill='#000000'>Jane Smith</text>
      <text name='Time' size='13' fill='#8E8E93'>2 hours ago</text>
    </frame>
  </frame>
  <text name='Body' size='15' fill='#000000' lineHeight='140%' width='fill'>This is a sample post content that wraps nicely on mobile screens.</text>
</frame>
```

### Floating Action Button

```xml
<frame name='FAB' layout='row' justifyContent='center' alignItems='center' w='56' h='56' bg='#007AFF' corner='28' shadow='0,4,12,0,#0000003D'>
  <icon name='Plus' icon='lucide:plus' size='24' fill='#FFFFFF'/>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Screen width | `390` px |
| Screen height | `844` px |
| Status bar height | `44` px |
| Nav bar height | `44` px |
| Bottom tab bar height | `83` px (includes 34px home indicator) |
| Content padding | `16` px horizontal |
| Content gap | `16` px |
| List item padding | `12 16` px |
| List icon wrapper | `36` x `36` px, `corner='8'` |
| Touch target minimum | `44` x `44` px |
| Tab bar icon size | `24` px |
| Tab bar label size | `10` px |
| iOS system blue | `#007AFF` |
| iOS label color | `#000000` |
| iOS secondary label | `#8E8E93` |
| iOS separator | `#E5E5EA` |
| iOS grouped bg | `#F2F2F7` |
| iOS card bg | `#FFFFFF` |
| Body text (iOS) | `17` px for primary, `15` px for secondary |
| Caption text (iOS) | `13` px |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Screen width != 390 | Always `w='390'` for mobile — not 375, not 360 |
| Missing bottom safe area (home indicator) | Bottom nav: `p='8 0 34 0'` — 34px bottom for home indicator |
| Touch targets < 44px | Every tappable element: minimum `44` px in both dimensions |
| Tab labels > 10px | Tab bar labels: `10` px to match iOS convention |
| Content touching edges | Always `p='16'` on content area |
| No status bar | Include status bar with time + icons for realistic mockup |
| Body text < 15px | Mobile body text: `15`–`17` px minimum for readability |
