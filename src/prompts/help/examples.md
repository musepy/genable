---
id: examples
title: Tool Usage Examples
keywords: [example, card, login, progressive, read, ls, tree, cat, path, component, instance, variant, clone, cp, comp, edit, update, FONT_FALLBACK, completion, button-group]
whenToUse: When you need concrete examples of how to use design tools for various scenarios
---

## EXAMPLES

### Example 1: Simple component (single mk chain)
User: "Create a card with a title"

```
mk /Card/ frame layout:column gap:12 p:16 w:360 bg:#FFFFFF corner:12
mk /Card/Title text size:20 weight:Bold fill:#111827 w:fill -- Card Title
mk /Card/Subtitle text size:14 fill:#6B7280 w:fill -- Description text
```

### Example 2: Progressive creation (login page — grow step by step)
User: "Create a login page"

**Step 1 — Skeleton**: outer container + major sections as empty frames.
```
mk /Login_Page/ frame layout:column alignCross:center alignMain:center w:1440 h:900 bg:#F9FAFB
mk /Login_Page/Card frame layout:column gap:24 p:40 w:420 bg:#FFFFFF corner:16 shadow:0,4,24,0,#0000000F
mk /Login_Page/Card/Header frame layout:column gap:8 alignCross:center w:fill
mk /Login_Page/Card/Form frame layout:column gap:16 w:fill
mk /Login_Page/Card/Footer frame layout:column gap:12 alignCross:center w:fill
```

**Step 2 — Header region**: fill the header with logo and text.
```
mk /Login_Page/Card/Header/Logo text size:28 weight:Bold fill:#4F46E5 -- Acme
mk /Login_Page/Card/Header/Title text size:20 weight:Bold fill:#111827 -- Welcome back
mk /Login_Page/Card/Header/Subtitle text size:14 fill:#6B7280 -- Sign in to your account
```

**Step 3 — Form region**: email, password fields + button.
```
mk /Login_Page/Card/Form/EmailField frame layout:column gap:6 w:fill bg:transparent
mk /Login_Page/Card/Form/EmailField/Label text size:14 weight:Medium fill:#374151 -- Email
mk /Login_Page/Card/Form/EmailField/Input frame layout:row p:'12 16' w:fill bg:#FFFFFF corner:8 stroke:'1 #D1D5DB'
mk /Login_Page/Card/Form/EmailField/Input/Placeholder text size:14 fill:#9CA3AF -- you@example.com
mk /Login_Page/Card/Form/PasswordField frame layout:column gap:6 w:fill bg:transparent
mk /Login_Page/Card/Form/PasswordField/Label text size:14 weight:Medium fill:#374151 -- Password
mk /Login_Page/Card/Form/PasswordField/Input frame layout:row p:'12 16' w:fill bg:#FFFFFF corner:8 stroke:'1 #D1D5DB'
mk /Login_Page/Card/Form/PasswordField/Input/Placeholder text size:14 fill:#9CA3AF -- ••••••••
mk /Login_Page/Card/Form/SignInBtn frame layout:row alignMain:center alignCross:center p:12 w:fill h:44 bg:#4F46E5 corner:8
mk /Login_Page/Card/Form/SignInBtn/Label text size:16 weight:Bold fill:#FFFFFF -- Sign In
```

**Step 4 — Footer**: links and secondary text.
```
mk /Login_Page/Card/Footer/Forgot text size:14 fill:#4F46E5 -- Forgot password?
mk /Login_Page/Card/Footer/Signup text size:14 fill:#6B7280 -- Don't have an account? Sign up
```

**Step 5 — Verify + complete.**
```
cat /Login_Page/ -s
```
Check layout looks correct, then respond with text to complete.

### Example 3: Progressive read (ls → tree → cat)
User: "Update the header section in this complex page"

**Step 1 — Get canvas overview**:
```
ls /
```

**Step 2 — See the structure**:
```
tree /Dashboard/ -d 2
```

**Step 3 — Inspect the specific section**:
```
cat /Dashboard/Header/ -s
```

**Step 4 — Edit based on detailed inspection**:
```
mk /Dashboard/Header/Title fill:#4F46E5 size:24
```

### Example 4: Query-first edit
User: "Change the button in the existing card to green and add rounded corners"

```
tree /Card/ -d 2
mk /Card/Button bg:#10B981 corner:10
```

### Example 5: Batch replace (rebranding)
User: "Change all blue (#3B82F6) to purple (#8B5CF6) in the card"

```
grep /Card/ fill,stroke
sed /Card/ fill:#3B82F6/#8B5CF6 stroke:#3B82F6/#8B5CF6
```

### Example 6: Component-first card row (comp create + instance)
User: "Create a stats dashboard with 3 metric cards"

**Step 1 — Define the reusable component** (small, all attributes):
```
mk /StatCard/ frame layout:column gap:8 p:20 bg:#FFFFFF corner:12 shadow:0,2,8,0,#0000001A w:240 h:hug
mk /StatCard/label text size:14 fill:#64748B -- Label
mk /StatCard/value text size:28 weight:Bold fill:#0F172A -- 0
comp create /StatCard/
```

**Step 2 — Stamp instances with overrides**:
```
mk /Stats/ frame layout:row gap:16 w:fill h:hug bg:transparent
comp instance /StatCard/ --parent /Stats/
comp instance /StatCard/ --parent /Stats/
comp instance /StatCard/ --parent /Stats/
```

### Example 7: Variant ComponentSet with clone (multi-axis)
User: "Create a Button component with Primary/Neutral variants and Default/Hover states"

**Step 1 — Base component**:
```
mk /Base/ frame layout:row gap:8 p:12 corner:8 bg:#2C2C2C stroke:'1 #2C2C2C' w:hug h:hug alignMain:center alignCross:center overflow:hidden
mk /Base/Label text size:16 fill:#F5F5F5 -- Button
```

**Step 2 — Clone variants** (only differences):
```
cp /Base/ /Hover/ bg:#1E1E1E
cp /Base/ /Disabled/ bg:#D9D9D9 stroke:'1 #B3B3B3'
cp /Base/ /Neutral/ bg:#E3E3E3 stroke:'1 #767676'
```

**Step 3 — Combine into ComponentSet**:
```
comp combine /Base/ /Hover/ /Disabled/ /Neutral/ --name Button
```

### Example 8: Completion (text-only response, no tool calls)
After all design work is done, respond with text only — this ends the turn:

"I've created the login form with email/password fields, a sign-in button, and proper card styling. The form uses vertical auto-layout with 16px spacing."

Note: Every frame has explicit `bg` — structural frames use `bg:transparent` so they don't override the parent's dark background.
