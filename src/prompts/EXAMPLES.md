## EXAMPLES

### Example 1: Simple component (single `create` is fine)
User: "Create a card with a title"

```json
create({
  "xml": "<frame name='Card' layout='column' gap='12' p='16' w='360' height='hug' bg='#FFFFFF' corner='12'><text name='Title' size='20' weight='Bold' fill='#111827' width='fill'>Card Title</text><text name='Subtitle' size='14' fill='#6B7280' width='fill'>Description text</text></frame>"
})
```

### Example 2: Progressive creation (login page — grow step by step)
User: "Create a login page"

**Step 1 — Skeleton**: outer container + major sections as empty frames.
```json
create({
  "xml": "<frame name='Login Page' layout='column' alignItems='center' justifyContent='center' w='1440' h='900' bg='#F9FAFB'><frame name='Card' layout='column' gap='24' p='40' w='420' height='hug' bg='#FFFFFF' corner='16' shadow='0,4,24,0,#0000000F'><frame name='Header' layout='column' gap='8' alignItems='center' width='fill' height='hug' bg='transparent'/><frame name='Form' layout='column' gap='16' width='fill' height='hug' bg='transparent'/><frame name='Footer' layout='column' gap='12' alignItems='center' width='fill' height='hug' bg='transparent'/></frame></frame>"
})
```
→ idMap returns: `{ "Login Page": "200:1", "Card": "200:2", "Header": "200:3", "Form": "200:4", "Footer": "200:5" }`

**Step 2 — Header region**: fill the header with logo and text.
```json
create({
  "parentId": "200:3",
  "xml": "<text name='Logo' size='28' weight='Bold' fill='#4F46E5'>Acme</text><text name='Title' size='20' weight='Bold' fill='#111827'>Welcome back</text><text name='Subtitle' size='14' fill='#6B7280'>Sign in to your account</text>"
})
```

**Step 3 — Form region**: email, password fields + button.
```json
create({
  "parentId": "200:4",
  "xml": "<frame name='Email Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'><text name='Label' size='14' weight='Medium' fill='#374151'>Email</text><frame name='Input' layout='row' p='12 16' width='fill' height='hug' bg='#FFFFFF' corner='8' stroke='#D1D5DB' strokeW='1'><text name='Placeholder' size='14' fill='#9CA3AF'>you@example.com</text></frame></frame><frame name='Password Field' layout='column' gap='6' width='fill' height='hug' bg='transparent'><text name='Label' size='14' weight='Medium' fill='#374151'>Password</text><frame name='Input' layout='row' p='12 16' width='fill' height='hug' bg='#FFFFFF' corner='8' stroke='#D1D5DB' strokeW='1'><text name='Placeholder' size='14' fill='#9CA3AF'>••••••••</text></frame></frame><frame name='Sign In Button' layout='row' justifyContent='center' alignItems='center' p='12' width='fill' h='44' bg='#4F46E5' corner='8'><text name='Label' size='16' weight='Bold' fill='#FFFFFF'>Sign In</text></frame>"
})
```

**Step 4 — Footer**: links and secondary text.
```json
create({
  "parentId": "200:5",
  "xml": "<text name='Forgot' size='14' fill='#4F46E5'>Forgot password?</text><text name='Signup' size='14' fill='#6B7280'>Don't have an account? <text size='14' fill='#4F46E5' weight='Medium'>Sign up</text></text>"
})
```

**Step 5 — Verify + complete.**
```json
read({"nodeId":"200:1","depth":3,"screenshot":true})
```
→ Check layout looks correct, then respond with text to complete.

### Example 3: Equal-height card row (sibling alignment)
User: "Create a row of 2 feature cards with actions"

Key: `h='fill'` (equal height) + `justifyContent='space-between'` (action pinned to bottom).
```json
create({
  "xml": "<frame name='Cards Row' layout='row' gap='24' w='fill' height='hug' bg='transparent'><frame name='Card A' layout='column' w='fill' h='fill' justifyContent='space-between' p='24' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000000F'><frame name='Content' layout='column' gap='12' w='fill' height='hug' bg='transparent'><text name='Title' size='20' weight='Bold' fill='#111827'>Feature One</text><text name='Desc' size='14' fill='#6B7280' width='fill'>Short description.</text></frame><frame name='Action' layout='row' justifyContent='center' alignItems='center' w='fill' h='44' corner='8' bg='transparent' stroke='#D1D5DB' strokeW='1'><text size='14' weight='Medium' fill='#111827'>Learn more</text></frame></frame><frame name='Card B' layout='column' w='fill' h='fill' justifyContent='space-between' p='24' bg='#FFFFFF' corner='12' shadow='0,2,8,0,#0000000F'><frame name='Content' layout='column' gap='12' w='fill' height='hug' bg='transparent'><text name='Title' size='20' weight='Bold' fill='#111827'>Feature Two</text><text name='Desc' size='14' fill='#6B7280' width='fill'>Longer description that wraps to multiple lines and makes this card taller than its sibling.</text></frame><frame name='Action' layout='row' justifyContent='center' alignItems='center' w='fill' h='44' corner='8' bg='transparent' stroke='#D1D5DB' strokeW='1'><text size='14' weight='Medium' fill='#111827'>Learn more</text></frame></frame></frame>"
})
```
Note: Card B has longer text, but both cards are equal height (`h='fill'`). Actions align at the bottom (`justifyContent='space-between'`). Title text uses same `size='20'` across both.

### Example 4: Progressive read (large tree → summary → targeted full)
User: "Update the header section in this complex page"

**Step 1 — Read the whole page (auto-degrades for large trees)**:
```json
read({"nodeId":"100:1"})
```
→ Returns structural skeleton + hint: "Node tree is large (15 children). Use read with specific child IDs for full style details."

**Step 2 — Read the specific section with full detail**:
```json
read({"nodeId":"100:3"})
```
→ Returns full XML with styles for the header section only.

**Step 3 — Edit based on detailed read**:
```json
edit({"xml": "<text id='100:5' fill='#4F46E5' size='24'>New Header</text>"})
```

**Alternative — use summary mode explicitly for navigation**:
```json
read({"nodeId":"100:1","detail":"summary"})
```
→ Always returns skeleton regardless of size. Good for discovering node IDs before targeted reads.

### Example 5: Query-first edit
User: "Change the button in the existing card to green and add rounded corners"

```json
read({"nodeId":"100:1","depth":2})
edit({
  "xml": "<frame id='100:8' fill='#10B981' corner='10'/>"
})
```

### Example 6: FONT_FALLBACK warning handling
User: "Create a button with bold title"

```json
create({
  "xml": "<frame name='Button' layout='row' p='12' width='hug' h='44' corner='8' bg='#4F46E5' justifyContent='center' alignItems='center'><text name='Label' size='16' weight='Bold' fill='#FFFFFF'>Sign In</text></frame>"
})
edit({"xml": "<text id='100:2' weight='Medium'/>"})
```

### Example 7: Completion (text-only response, no tool calls)
After all design work is done, respond with text only — this ends the loop:

"I've created the login form with email/password fields, a sign-in button, and proper card styling. The form uses vertical auto-layout with 16px spacing."

Note: Every frame has explicit `bg` — structural frames use `bg='transparent'` so they don't override the parent's dark background.
