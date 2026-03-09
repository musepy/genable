# Table Design Guidelines

## 1. Purpose & Scope

**Use for**: Data tables, spreadsheet views, admin lists, transaction logs, user management tables, inventory lists.

**Do NOT use for**: Card grids (use card-layout), key-value detail views, simple lists.

**Table container**: `width='fill'` — tables expand to available space. Wrap in a card with `bg='#FFFFFF'` and `corner='12'`.

## 2. Layout Template

```
+---Table Card (fill width)---+
|  Table Header               |
|    Title    Search  Actions  |
|  Column Headers              |
|    Col1  Col2  Col3  Col4    |
|  Data Rows                   |
|    Val1  Val2  Val3  Val4    |
|    Val1  Val2  Val3  Val4    |
|    ...                       |
|  Pagination                  |
|    < 1 2 3 ... 10 >          |
+------------------------------+
```

### XML Skeleton — copy and modify:

```xml
<frame name='Table Card' layout='column' gap='0' width='fill' height='hug' bg='#FFFFFF' corner='12' shadow='0,1,3,0,#0000001A'>
  <frame name='Table Header' layout='row' justifyContent='space-between' alignItems='center' p='16 20' width='fill' height='hug' bg='transparent'>
    <text name='Title' size='16' weight='Bold' fill='#111827'>Users</text>
    <frame name='Actions' layout='row' gap='12' alignItems='center' width='hug' height='hug' bg='transparent'>
      <!-- Search, filter, add buttons -->
    </frame>
  </frame>
  <frame name='Column Headers' layout='row' gap='0' p='12 20' width='fill' height='hug' bg='#F9FAFB'>
    <!-- Column header texts -->
  </frame>
  <frame name='Table Body' layout='column' gap='0' width='fill' height='hug' bg='transparent'>
    <!-- Data rows -->
  </frame>
  <frame name='Pagination' layout='row' justifyContent='space-between' alignItems='center' p='12 20' width='fill' height='hug' bg='transparent' stroke='#F3F4F6' strokeW='1'>
    <!-- Pagination controls -->
  </frame>
</frame>
```

## 3. Component Patterns

### Table Top Bar (title + actions)

```xml
<frame name='Table Header' layout='row' justifyContent='space-between' alignItems='center' p='16 20' width='fill' height='hug' bg='transparent'>
  <frame name='Left' layout='column' gap='4' width='hug' height='hug' bg='transparent'>
    <text name='Title' size='16' weight='Bold' fill='#111827'>All Users</text>
    <text name='Count' size='14' fill='#6B7280'>128 total</text>
  </frame>
  <frame name='Right' layout='row' gap='8' alignItems='center' width='hug' height='hug' bg='transparent'>
    <frame name='Search' layout='row' gap='8' alignItems='center' p='8 12' width='200' height='hug' bg='#F9FAFB' corner='6' stroke='#E5E7EB' strokeW='1'>
      <icon name='Icon' icon='lucide:search' size='16' fill='#9CA3AF'/>
      <text name='Placeholder' size='14' fill='#9CA3AF'>Search...</text>
    </frame>
    <frame name='Add Button' layout='row' gap='6' justifyContent='center' alignItems='center' p='8 12' width='hug' height='hug' bg='#4F46E5' corner='6'>
      <icon name='Plus' icon='lucide:plus' size='16' fill='#FFFFFF'/>
      <text name='Label' size='14' weight='Medium' fill='#FFFFFF'>Add User</text>
    </frame>
  </frame>
</frame>
```

### Column Headers

```xml
<frame name='Column Headers' layout='row' gap='0' p='12 20' width='fill' height='hug' bg='#F9FAFB'>
  <text name='Name' size='12' weight='Medium' fill='#6B7280' w='240'>NAME</text>
  <text name='Email' size='12' weight='Medium' fill='#6B7280' w='fill'>EMAIL</text>
  <text name='Role' size='12' weight='Medium' fill='#6B7280' w='120'>ROLE</text>
  <text name='Status' size='12' weight='Medium' fill='#6B7280' w='100'>STATUS</text>
  <text name='Actions' size='12' weight='Medium' fill='#6B7280' w='80'>ACTIONS</text>
</frame>
```

### Data Row

```xml
<frame name='Row' layout='row' gap='0' alignItems='center' p='16 20' width='fill' height='hug' bg='transparent' stroke='#F3F4F6' strokeW='1'>
  <frame name='Name Cell' layout='row' gap='12' alignItems='center' w='240' height='hug' bg='transparent'>
    <frame name='Avatar' w='32' h='32' corner='16' bg='#E5E7EB'/>
    <frame name='Info' layout='column' gap='2' width='hug' height='hug' bg='transparent'>
      <text name='Name' size='14' weight='Medium' fill='#111827'>Sarah Connor</text>
      <text name='Sub' size='12' fill='#6B7280'>Engineering</text>
    </frame>
  </frame>
  <text name='Email' size='14' fill='#6B7280' w='fill'>sarah@company.com</text>
  <text name='Role' size='14' fill='#374151' w='120'>Admin</text>
  <frame name='Status' layout='row' w='100' height='hug' bg='transparent'>
    <frame name='Badge' layout='row' p='2 10' width='hug' height='hug' bg='#DCFCE7' corner='12'>
      <text name='Label' size='12' weight='Medium' fill='#16A34A'>Active</text>
    </frame>
  </frame>
  <frame name='Actions' layout='row' gap='8' w='80' height='hug' bg='transparent'>
    <icon name='Edit' icon='lucide:pencil' size='16' fill='#6B7280'/>
    <icon name='Delete' icon='lucide:trash-2' size='16' fill='#6B7280'/>
  </frame>
</frame>
```

### Status Badge Variants

```xml
<frame name='Active Badge' layout='row' p='2 10' width='hug' height='hug' bg='#DCFCE7' corner='12'>
  <text name='Label' size='12' weight='Medium' fill='#16A34A'>Active</text>
</frame>
<frame name='Inactive Badge' layout='row' p='2 10' width='hug' height='hug' bg='#FEF3C7' corner='12'>
  <text name='Label' size='12' weight='Medium' fill='#D97706'>Pending</text>
</frame>
<frame name='Error Badge' layout='row' p='2 10' width='hug' height='hug' bg='#FEE2E2' corner='12'>
  <text name='Label' size='12' weight='Medium' fill='#DC2626'>Suspended</text>
</frame>
```

### Pagination

```xml
<frame name='Pagination' layout='row' justifyContent='space-between' alignItems='center' p='12 20' width='fill' height='hug' bg='transparent' stroke='#F3F4F6' strokeW='1'>
  <text name='Info' size='14' fill='#6B7280'>Showing 1-10 of 128 results</text>
  <frame name='Controls' layout='row' gap='2' alignItems='center' width='hug' height='hug' bg='transparent'>
    <frame name='Prev' layout='row' justifyContent='center' alignItems='center' w='32' h='32' bg='transparent' corner='6' stroke='#E5E7EB' strokeW='1'>
      <icon name='Arrow' icon='lucide:chevron-left' size='16' fill='#6B7280'/>
    </frame>
    <frame name='Page Active' layout='row' justifyContent='center' alignItems='center' w='32' h='32' bg='#4F46E5' corner='6'>
      <text name='Num' size='14' weight='Medium' fill='#FFFFFF'>1</text>
    </frame>
    <frame name='Page' layout='row' justifyContent='center' alignItems='center' w='32' h='32' bg='transparent' corner='6'>
      <text name='Num' size='14' fill='#6B7280'>2</text>
    </frame>
    <frame name='Page' layout='row' justifyContent='center' alignItems='center' w='32' h='32' bg='transparent' corner='6'>
      <text name='Num' size='14' fill='#6B7280'>3</text>
    </frame>
    <frame name='Next' layout='row' justifyContent='center' alignItems='center' w='32' h='32' bg='transparent' corner='6' stroke='#E5E7EB' strokeW='1'>
      <icon name='Arrow' icon='lucide:chevron-right' size='16' fill='#6B7280'/>
    </frame>
  </frame>
</frame>
```

### Empty State

```xml
<frame name='Empty State' layout='column' gap='16' alignItems='center' p='48 20' width='fill' height='hug' bg='transparent'>
  <frame name='Icon Wrapper' layout='row' justifyContent='center' alignItems='center' w='48' h='48' bg='#F3F4F6' corner='24'>
    <icon name='Icon' icon='lucide:inbox' size='24' fill='#9CA3AF'/>
  </frame>
  <text name='Title' size='16' weight='Medium' fill='#374151'>No users found</text>
  <text name='Desc' size='14' fill='#6B7280'>Try adjusting your search or filters.</text>
</frame>
```

## 4. Spacing & Visual Reference

| Element | Value |
|---|---|
| Table card corner | `12` px |
| Table card shadow | `0,1,3,0,#0000001A` |
| Top bar padding | `16 20` px |
| Column header padding | `12 20` px |
| Column header bg | `#F9FAFB` |
| Column header text | `12` px `Medium` `#6B7280`, uppercase |
| Row padding | `16 20` px |
| Row border | `stroke='#F3F4F6' strokeW='1'` (bottom) |
| Cell text (primary) | `14` px `#111827` |
| Cell text (secondary) | `14` px `#6B7280` |
| Avatar in table | `32` x `32` px, `corner='16'` |
| Badge padding | `2 10` px |
| Badge corner | `12` px (pill) |
| Pagination padding | `12 20` px |
| Page button size | `32` x `32` px |
| Name column | `240` px |
| Status column | `100` px |
| Actions column | `80` px |

## 5. Anti-Patterns

| Mistake | Fix |
|---|---|
| All columns same width | Size columns by content: names wide, status narrow, email fill |
| No column header bg | Headers need `bg='#F9FAFB'` to distinguish from data |
| Header text same size as data | Headers: `12px Medium` uppercase; data: `14px` |
| Missing row borders | Every row: `stroke='#F3F4F6' strokeW='1'` for scanlines |
| Status as plain text | Use colored badge pills for status (green=active, yellow=pending, red=error) |
| No pagination | Tables with > 10 rows need pagination footer |
| Table without card wrapper | Wrap table in a card: `bg='#FFFFFF' corner='12' shadow=...` |
