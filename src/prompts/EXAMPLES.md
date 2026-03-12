## EXAMPLES

### Example 1: Simple component (single `design` is fine)
User: "Create a card with a title"

```json
design({
  "ops": "card = frame(root, {name:'Card', pattern:'column', gap:12, p:16, w:360, bg:'#FFFFFF', corner:12})\ntitle = text(card, {name:'Title', size:20, weight:'Bold', fill:'#111827', w:'fill'}, 'Card Title')\nsub = text(card, {name:'Subtitle', size:14, fill:'#6B7280', w:'fill'}, 'Description text')"
})
```

### Example 2: Progressive creation (login page — grow step by step)
User: "Create a login page"

**Step 1 — Skeleton**: outer container + major sections as empty frames.
```json
design({
  "ops": "page = frame(root, {name:'Login Page', layout:'column', alignItems:'center', justifyContent:'center', w:1440, h:900, bg:'#F9FAFB'})\ncard = frame(page, {name:'Card', pattern:'column', gap:24, p:40, w:420, bg:'#FFFFFF', corner:16, shadow:'0,4,24,0,#0000000F'})\nhdr = frame(card, {name:'Header', pattern:'column', gap:8, alignItems:'center', w:'fill'})\nfrm = frame(card, {name:'Form', pattern:'column', gap:16, w:'fill'})\nftr = frame(card, {name:'Footer', pattern:'column', gap:12, alignItems:'center', w:'fill'})"
})
```
→ idMap returns: `{ "loginPage": "200:1", "card": "200:2", "hdr": "200:3", "frm": "200:4", "ftr": "200:5" }`

**Step 2 — Header region**: fill the header with logo and text.
```json
design({
  "parentId": "200:3",
  "ops": "logo = text(root, {name:'Logo', size:28, weight:'Bold', fill:'#4F46E5'}, 'Acme')\nt1 = text(root, {name:'Title', size:20, weight:'Bold', fill:'#111827'}, 'Welcome back')\nt2 = text(root, {name:'Subtitle', size:14, fill:'#6B7280'}, 'Sign in to your account')"
})
```

**Step 3 — Form region**: email, password fields + button.
```json
design({
  "parentId": "200:4",
  "ops": "ef = frame(root, {name:'Email Field', layout:'column', gap:6, w:'fill', height:'hug', bg:'transparent'})\nel = text(ef, {name:'Label', size:14, weight:'Medium', fill:'#374151'}, 'Email')\nei = frame(ef, {name:'Input', layout:'row', p:'12 16', w:'fill', height:'hug', bg:'#FFFFFF', corner:8, stroke:'#D1D5DB', strokeW:1})\nep = text(ei, {name:'Placeholder', size:14, fill:'#9CA3AF'}, 'you@example.com')\npf = frame(root, {name:'Password Field', layout:'column', gap:6, w:'fill', height:'hug', bg:'transparent'})\npl = text(pf, {name:'Label', size:14, weight:'Medium', fill:'#374151'}, 'Password')\npi = frame(pf, {name:'Input', layout:'row', p:'12 16', w:'fill', height:'hug', bg:'#FFFFFF', corner:8, stroke:'#D1D5DB', strokeW:1})\npp = text(pi, {name:'Placeholder', size:14, fill:'#9CA3AF'}, '••••••••')\nbtn = frame(root, {name:'Sign In Button', layout:'row', justifyContent:'center', alignItems:'center', p:12, w:'fill', h:44, bg:'#4F46E5', corner:8})\nbl = text(btn, {name:'Label', size:16, weight:'Bold', fill:'#FFFFFF'}, 'Sign In')"
})
```

**Step 4 — Footer**: links and secondary text.
```json
design({
  "parentId": "200:5",
  "ops": "f1 = text(root, {name:'Forgot', size:14, fill:'#4F46E5'}, 'Forgot password?')\nf2 = text(root, {name:'Signup', size:14, fill:'#6B7280'}, 'Don\\'t have an account? Sign up')"
})
```

**Step 5 — Verify + complete.**
```json
inspect({"nodeId":"200:1","depth":3,"screenshot":true})
```
→ Check layout looks correct, then respond with text to complete.

### Example 3: Progressive read (context → outline → inspect)
User: "Update the header section in this complex page"

**Step 1 — Get canvas overview**:
```json
context()
```
→ Returns page name, top-level skeleton, and selection. Find the root node ID.

**Step 2 — Outline the structure**:
```json
outline({"nodeId":"100:1"})
```
→ Returns structural skeleton with IDs and `suggestedReads`. Identify the header section ID.

**Step 3 — Inspect the specific section**:
```json
inspect({"nodeId":"100:3"})
```
→ Returns full XML with styles for the header section only.

**Step 4 — Edit based on detailed inspection**:
```json
design({"ops": "update('100:5', {fill:'#4F46E5', size:24})"})
```

### Example 4: Query-first edit
User: "Change the button in the existing card to green and add rounded corners"

```json
outline({"nodeId":"100:1","depth":2})
design({"ops": "update('100:8', {fill:'#10B981', corner:10})"})
```

### Example 5: FONT_FALLBACK warning handling
User: "Create a button with bold title"

```json
design({
  "ops": "btn = frame(root, {name:'Button', pattern:'row', p:12, h:44, corner:8, bg:'#4F46E5', justifyContent:'center', alignItems:'center'})\nlbl = text(btn, {name:'Label', size:16, weight:'Bold', fill:'#FFFFFF'}, 'Sign In')"
})
design({"ops": "update('100:2', {weight:'Medium'})"})
```

### Example 6: Component-first card row (reusable + ref)
User: "Create a stats dashboard with 3 metric cards"

**Step 1 — Define the reusable component** (small, all attributes):
```json
design({
  "ops": "sc = frame(root, {name:'StatCard', reusable:true, layout:'column', gap:8, p:20, bg:'#FFFFFF', corner:12, shadow:'0,2,8,0,#0000001A', w:240, height:'hug'})\nlbl = text(sc, {name:'label', size:14, fill:'#64748B'}, 'Label')\nval = text(sc, {name:'value', size:28, weight:'Bold', fill:'#0F172A'}, '0')"
})
```

**Step 2 — Stamp instances with text overrides**:
```json
design({
  "parentId": "...",
  "ops": "row = frame(root, {name:'Stats Row', pattern:'row-fill', gap:16})\nc1 = ref('StatCard', row, {w:'fill', set:label:'Revenue', set:value:'$48,250'})\nc2 = ref('StatCard', row, {w:'fill', set:label:'Users', set:value:'2,420'})\nc3 = ref('StatCard', row, {w:'fill', set:label:'Growth', set:value:'+12.5%'})"
})
```

### Example 7: Completion (text-only response, no tool calls)
After all design work is done, respond with text only — this ends the loop:

"I've created the login form with email/password fields, a sign-in button, and proper card styling. The form uses vertical auto-layout with 16px spacing."

Note: Every frame has explicit `bg` — structural frames use `bg:'transparent'` so they don't override the parent's dark background.
