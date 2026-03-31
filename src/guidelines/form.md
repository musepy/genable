# Form Design Guidelines

## 1. Purpose & Scope

**Use for**: Login/signup forms, checkout flows, settings pages, contact forms, multi-step wizards, data entry screens.

**Do NOT use for**: Display-only content, pure navigation, dashboards (use dashboard guideline).

**Root frame**: Depends on context — standalone form card `w='420'`, full-page settings `w='600'–`w='800'`.

## 2. Layout Template

```
+----------Form Card (420px)----------+
|  Header                             |
|    Title                             |
|    Subtitle                          |
|                                      |
|  Form Fields (column, gap=16)        |
|    +--Field Group--+                 |
|    | Label          |                |
|    | Input          |                |
|    | Helper text    |                |
|    +----------------+                |
|    +--Field Group--+                 |
|    | Label          |                |
|    | Input          |                |
|    +----------------+                |
|                                      |
|  Actions                             |
|    [Primary Button]                  |
|    Secondary link                    |
+--------------------------------------+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Form Card' layout='column' gap='24' p='32' w='420' height='hug' bg='#FFFFFF' corner='16' shadow='0,4,24,0,#0000000F'>
  <frame name='Header' layout='column' gap='8' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='24' weight='Bold' fill='#111827'>Sign In</text>
    <text name='Subtitle' size='14' fill='#6B7280'>Welcome back to your account</text>
  </frame>
  <frame name='Fields' layout='column' gap='16' width='fill' height='hug' bg='transparent'>
    {/* Input fields go here */}
  </frame>
  <frame name='Actions' layout='column' gap='12' width='fill' height='hug' bg='transparent'>
    {/* Buttons go here */}
  </frame>
</frame>
```

## 3. Component Patterns

### Text Input Field

```xml
<frame name='Email Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'>
  <text name='Label' size='14' weight='Medium' fill='#374151'>Email address</text>
  <frame name='Input' layout='row' alignItems='center' p='12 16' width='fill' height='hug' bg='#FFFFFF' corner='8' stroke='#D1D5DB' strokeW='1'>
    <text name='Placeholder' size='14' fill='#9CA3AF'>you@example.com</text>
  </frame>
</frame>
```

### Input with Icon

```xml
<frame name='Search Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'>
  <text name='Label' size='14' weight='Medium' fill='#374151'>Search</text>
  <frame name='Input' layout='row' gap='8' alignItems='center' p='12 16' width='fill' height='hug' bg='#FFFFFF' corner='8' stroke='#D1D5DB' strokeW='1'>
    <icon name='Search Icon' icon='lucide:search' size='16' fill='#9CA3AF'/>
    <text name='Placeholder' size='14' fill='#9CA3AF'>Search...</text>
  </frame>
</frame>
```

### Password Field

```xml
<frame name='Password Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'>
  <frame name='Label Row' layout='row' justifyContent='space-between' width='fill' height='hug' bg='transparent'>
    <text name='Label' size='14' weight='Medium' fill='#374151'>Password</text>
    <text name='Forgot' size='14' fill='#4F46E5'>Forgot?</text>
  </frame>
  <frame name='Input' layout='row' alignItems='center' justifyContent='space-between' p='12 16' width='fill' height='hug' bg='#FFFFFF' corner='8' stroke='#D1D5DB' strokeW='1'>
    <text name='Value' size='14' fill='#111827'>••••••••</text>
    <icon name='Toggle' icon='lucide:eye-off' size='16' fill='#9CA3AF'/>
  </frame>
</frame>
```

### Input with Error State

```xml
<frame name='Error Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'>
  <text name='Label' size='14' weight='Medium' fill='#374151'>Email</text>
  <frame name='Input' layout='row' alignItems='center' p='12 16' width='fill' height='hug' bg='#FEF2F2' corner='8' stroke='#EF4444' strokeW='1'>
    <text name='Value' size='14' fill='#111827'>invalid-email</text>
  </frame>
  <text name='Error' size='12' fill='#EF4444'>Please enter a valid email address</text>
</frame>
```

### Checkbox / Radio

```xml
<frame name='Checkbox Row' layout='row' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'>
  <frame name='Checkbox' layout='row' justifyContent='center' alignItems='center' w='20' h='20' bg='#4F46E5' corner='4'>
    <icon name='Check' icon='lucide:check' size='14' fill='#FFFFFF'/>
  </frame>
  <text name='Label' size='14' fill='#374151'>Remember me</text>
</frame>
```

### Select / Dropdown

```xml
<frame name='Select Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'>
  <text name='Label' size='14' weight='Medium' fill='#374151'>Country</text>
  <frame name='Select' layout='row' alignItems='center' justifyContent='space-between' p='12 16' width='fill' height='hug' bg='#FFFFFF' corner='8' stroke='#D1D5DB' strokeW='1'>
    <text name='Selected' size='14' fill='#111827'>United States</text>
    <icon name='Chevron' icon='lucide:chevron-down' size='16' fill='#6B7280'/>
  </frame>
</frame>
```

### Primary Button

```xml
<frame name='Submit Button' layout='row' justifyContent='center' alignItems='center' p='12' width='fill' h='44' bg='#4F46E5' corner='8'>
  <text name='Label' size='16' weight='Bold' fill='#FFFFFF'>Sign In</text>
</frame>
```

### Button Hierarchy (Primary + Secondary)

```xml
<frame name='Actions' layout='column' gap='12' width='fill' height='hug' bg='transparent'>
  <frame name='Primary Button' layout='row' justifyContent='center' alignItems='center' p='12' width='fill' h='44' bg='#4F46E5' corner='8'>
    <text name='Label' size='16' weight='Bold' fill='#FFFFFF'>Create Account</text>
  </frame>
  <frame name='Secondary' layout='row' justifyContent='center' gap='4' width='fill' height='hug' bg='transparent'>
    <text name='Text' size='14' fill='#6B7280'>Already have an account?</text>
    <text name='Link' size='14' weight='Medium' fill='#4F46E5'>Sign in</text>
  </frame>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Form card width | `420` px (auth), `600` px (settings) |
| Card padding | `32` px |
| Card corner | `16` px |
| Section gap (header/fields/actions) | `24` px |
| Field gap (between inputs) | `16` px |
| Label-to-input gap | `6` px |
| Input padding | `12 16` px |
| Input corner | `8` px |
| Input stroke | `#D1D5DB`, `1` px |
| Input error stroke | `#EF4444`, `1` px |
| Button height | `44` px |
| Button corner | `8` px |
| Label text | `14` px, `Medium`, `#374151` |
| Placeholder text | `14` px, `#9CA3AF` |
| Error text | `12` px, `#EF4444` |
| Helper text | `12` px, `#6B7280` |
| Primary button bg | `#4F46E5` |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| Input without label | Every input MUST have a visible label text above it |
| No gap between label and input | Use `gap='6'` in the field group frame |
| Button without fixed height | Buttons: `h='44'` for consistent touch targets |
| Missing stroke on inputs | Inputs need `stroke='#D1D5DB' strokeW='1'` to be visible |
| Fields directly in card (no wrapper) | Wrap all fields in a `Fields` frame with `gap='16'` |
| Error state without color change | Error: `stroke='#EF4444'` on input + red helper text below |
| Form card without shadow on centered layout | Use `shadow='0,4,24,0,#0000000F'` for floating form cards |
