# Genable 测试 Prompts 库

> 📋 **使用方法**: 复制任意 prompt 到 Genable 插件中测试

---

## 📺 Desktop (1440px)

### D1: SaaS Dashboard
```
Create a SaaS analytics dashboard with:
- Width: 1440px, gray background (#F3F4F6)
- Left sidebar (260px fixed): Logo "Analytica", nav items: Overview (active, blue highlight), Reports, Users, Settings
- Main content area (FILL remaining width):
  - Header row: Title "Dashboard Overview" left, Date range dropdown right
  - Stats row with 4 KPI cards in horizontal layout (MUST use FILL for equal width):
    * Total Revenue: $48,290 (+12.5% green)
    * Active Users: 2,401 (+5.2% green)
    * Conversion Rate: 3.8% (-0.4% red)
    * Avg. Session: 4m 32s (+8% green)
  - Each card: White background, 24px padding, 12px corner radius, subtle shadow
- All nested containers MUST use layoutSizingHorizontal: FILL, not fixed widths
```

### D2: E-commerce Product Grid
```
Create an e-commerce product grid page:
- Width: 1440px
- Top navigation: Logo, Search bar (FILL width), Cart icon, User avatar (40px circular)
- Filter sidebar (280px left): Category checkboxes, Price range slider, Brand filters
- Product grid (FILL remaining):
  - Section title "Featured Products" with "View All" link (right aligned)
  - 3-column grid of product cards (each card MUST use FILL, not 320px)
  - Each card: Image placeholder (16:9), product name, rating stars, price ($99.99), "Add to Cart" button
  - Button: 44px height, blue background, white text
- Gap between cards: 24px
- Cards have subtle shadow on hover state indicator
```

### D3: Team Collaboration Workspace
```
Create a Notion-style workspace:
- Width: 1440px
- Sidebar (240px): Workspace name "Acme Team", navigation: Home, Projects, Tasks, Wiki, Team
- Main area (FILL):
  - Breadcrumb: Home > Projects > Q4 Planning
  - Page title: "Q4 Planning" (32px bold)
  - Horizontal toolbar: Text formatting buttons, Add block dropdown
  - Content area with 2-column layout (both columns FILL):
    * Left column (60%): Task list with checkboxes, assignee avatars (28px circular each)
    * Right column (40%): Calendar widget, upcoming deadlines
  - Each task row: Checkbox, task text, due date badge, avatar
- Dark mode header option (dark bg, white text)
```

### D4: Admin Data Table
```
Create an admin users table:
- Width: 1440px, white background
- Top toolbar: Search input (FILL), Filter dropdown, "Add User" button (blue, 44px)
- Table container:
  - Header row: Checkbox, Avatar, Name (FILL), Email (FILL), Role, Status, Actions
  - Zebra striped rows (alternating white and #F9FAFB)
  - Avatar: 36px circular
  - Status badges: Active (green), Pending (yellow), Inactive (red)
  - Actions: Edit and Delete icon buttons
- Pagination: Previous/Next buttons, page numbers, items per page dropdown
- All column children MUST stretch responsively
```

### D5: Settings Panel
```
Create a settings page with multiple sections:
- Width: 1200px centered
- Page title "Account Settings" (28px bold)
- 2-column layout:
  - Left nav (200px): Profile, Security, Notifications, Billing, Integrations
  - Right content (FILL):
    * Profile section: Avatar upload (96px circular), name/email inputs stacked
    * Security section: Password change form, 2FA toggle switch
    * Notifications section: Toggle switches with labels (Push, Email, SMS)
- Each input field: 48px height, 8px corner radius, 1px border
- Save button at bottom: FILL width, 48px height, blue
- Section cards: 24px padding, 12px corner radius
```

---

## 📱 Mobile (375px / 390px)

### M1: Social Profile Card
```
Create a mobile social profile card:
- Width: 375px, white background, center aligned content
- Avatar: 96px CIRCULAR (cornerRadius MUST be 48)
- Name: "Sarah Johnson" (20px bold)
- Bio: "Product Designer at Figma" (14px muted)
- Stats row with 3 items (MUST use FILL for equal width, NOT fixed 100px):
  * Posts: 248
  * Followers: 12.4K
  * Following: 843
- Action buttons row:
  * "Follow" button: Blue background, white text
  * "Message" button: White background, gray border
  * BOTH buttons: 44px height (NEVER 60px), FILL width, 12px gap
- Card padding: 24px, corner radius: 16px, subtle shadow
```

### M2: Login Screen
```
Create a mobile login screen:
- Width: 390px
- Container: 32px padding all sides
- Header: "Welcome back" (24px bold centered), "Sign in to continue" (14px muted centered)
- Form fields (each MUST be FILL width, NOT 320px):
  * Email input: 48px height, label above
  * Password input: 48px height, label above, show/hide toggle
- "Forgot password?" link (right aligned)
- Sign in button: FILL width, 48px height, blue, white bold text
- Divider with "or continue with" text centered
- Social buttons:
  * Google button: FILL width, 48px height, white with border
  * Apple button: FILL width, 48px height, black background
- Footer: "Don't have an account? Sign up" (centered)
- All elements perfectly centered, 20px gap between sections
```

### M3: Food Delivery Order
```
Create a food delivery order tracking card:
- Width: 375px
- Order status: "Order #1234 - On the way" header
- Progress bar with 4 steps: Confirmed, Preparing, On the way (active), Delivered
- Rider info card:
  * Avatar (48px circular) + name + rating stars
  * Call and message icon buttons
- Order details:
  * Restaurant name + logo
  * Items list with quantity badges
  * Subtotal, delivery fee, total (right aligned prices)
- Map placeholder (FILL width, 160px height)
- "Track on map" button: FILL width, 44px height
- All nested sections use FILL width, subtle shadows on cards
```

### M4: Music Player
```
Create a mobile music player now playing screen:
- Width: 390px, dark background (#1F1F1F)
- Album art: FILL width minus 48px margin, square aspect, 16px corners
- Song info: "Starlight" (22px bold white), "The Weeknd" (16px gray)
- Progress bar: Full width, current time left, total time right
- Control buttons row centered:
  * Shuffle, Previous, Play (larger, 64px circle), Next, Repeat
- Volume slider: Full width
- Bottom row: Heart icon, Add to playlist, Share
- All text MUST be white or light gray for contrast on dark bg
```

### M5: Chat Conversation
```
Create a mobile chat conversation screen:
- Width: 375px
- Header: Back arrow, Avatar (40px circular) + name + "Online" status, call/video icons
- Message bubbles:
  * Received: Left aligned, gray background, 16px padding, 16px radius
  * Sent: Right aligned, blue background, white text
  * Time stamps below each bubble (12px gray)
- Date separator: "Today" centered with lines
- Input area at bottom:
  * "+/Attach" button, text input (FILL), send button
  * Input: 44px height, rounded corners
- Messages container: FILL both directions
- Bubbles: max-width 70%, wrap text properly
```

---

## 🧪 Stress Tests

### Fixed Width Stress
```
Create a card grid that tests responsive layouts:
- Width: 1200px
- 3-column grid of feature cards
- CRITICAL: Each card container MUST NOT have fixed width like 320px or 375px
- Each card: Icon placeholder, title, description, "Learn more" link
- Cards should expand equally using FILL sizing
- Test that no child element has hardcoded mobile viewport widths
```

### Button Height Stress
```
Create a form with multiple button styles:
- Submit button (primary)
- Cancel button (secondary)
- Delete button (destructive red)
- Icon-only button
- CRITICAL: ALL buttons MUST be 44-48px height, NEVER 60px
- Test button containers with HUG height
```

### Avatar Grid Stress
```
Create a team members grid:
- 8 team member cards in 4x2 grid
- Each card has circular avatar (64px)
- CRITICAL: All avatars MUST have cornerRadius = 32 (half of 64)
- Name and role below avatar
- Social links row
```

### Shadow Opacity Stress
```
Create overlapping card layers:
- Background card with shadow
- Floating modal card on top with shadow
- Dropdown menu with shadow
- CRITICAL: All shadows MUST be subtle (8-15% opacity), NEVER pure black
- Test that #000000 shadows are converted to #00000014
```

### Dark Mode Contrast Stress
```
Create a dark themed dashboard widget:
- Dark background (#1E1E2E)
- Stats with large numbers
- Graph placeholder
- Action buttons
- CRITICAL: All text MUST be white or light colored for readability
- Test that dark backgrounds auto-fix text to white
```

---

## 🎯 Edge Cases

### Semantic Ambiguity

**Button vs Stat**
```
Create a social profile header with:
- "Follow" button (should BE a button)
- "Following" status label (should NOT be a button)
- "1.2K Followers" stat (should NOT be a button)
- "12 Posts" stat (should NOT be a button)
CRITICAL: Only "Follow" should get button styling
```

**Line Ambiguity**
```
Create a UI with these elements:
- A "Divider Line" (1px height, FILL width)
- A "Headline" text (should NOT be 1px height!)
- A "Timeline" component (vertical list, NOT a divider)
- An "Outline" button (button with border, NOT a divider)
CRITICAL: Only "Divider Line" should get line/divider treatment
```

**Card Ambiguity**
```
Create a page with:
- A "Product Card" (should have padding, shadow)
- A "Credit Card" input field (input styling, NOT card padding)
- A "Card Number" label (text, NOT a card component)
CRITICAL: Only "Product Card" should get card styling
```

### Extreme Sizing

**Long Text**
```
Create a card with:
- Title: "This is an extremely long title that should wrap properly across multiple lines without breaking the layout"
- Description: A 500-character paragraph (generate placeholder text)
- Small container width: 280px
CRITICAL: Text should wrap, not overflow
```

**Many Children**
```
Create a tag cloud with:
- 25 individual tag badges
- Each tag: different lengths ("AI", "Machine Learning", "UX")
- Horizontal wrap layout
CRITICAL: Tags should wrap to new rows, not overflow
```

### Component Edge Cases

**Avatar Group**
```
Create an overlapping avatar group:
- 5 avatars (32px each, circular)
- Overlapping by 8px each
- "+3" overflow indicator at end
CRITICAL: All avatars should have cornerRadius = 16
```

**Toggle States**
```
Create toggle switches in different states:
- On state (blue background)
- Off state (gray background)
- Disabled state (faded)
CRITICAL: Switches should be 52x32px or similar, NOT button height
```

**Tab Bar**
```
Create a tab bar with:
- 4 tabs: Home, Search, Notifications, Profile
- Active tab has blue underline
- Tab labels (NOT buttons - different height)
CRITICAL: Tab heights should be 44-48px, but NOT apply button rules
```

---

## 🐕 Dogfood: Genable 自身 UI

### Settings Panel (Genable)
```
Create a dark themed settings panel (280px width) with:
- Header: "Settings" (13px bold, white text)
- API Key section:
  * Label "API Key" (10px muted)
  * Password input (48px height, dark bg)
- "Fetch Models" secondary button (gray border, white text)
- Model chips row: gemini-2.5-flash (blue active), gemini-pro (gray)
- Learned Preferences card:
  * "Radii: 8, 12, 16" text
  * "Font: Inter" text
  * "History: 5 generations" text
- "Clear Preferences" button (full width, gray)
- "Save & Continue" primary button (white bg, dark text, full width)
- All backgrounds: #09090b (bg), #18181b (cards)
- Border color: #27272a
```

### Experiment Tab (Genable)
```
Create a dark themed experiment tab UI with:
- Card: "Prompt Structure A/B Test"
  * Subtitle: "Compare 3 prompt variants × 10 iterations each"
  * "Start Test (30 generations)" blue button (full width, 44px)
- Progress section (when running):
  * Label "Testing: example-first" (variant name in blue)
  * Progress bar (blue fill, 8px height)
  * "3 / 10" counter text
- Results table:
  * Headers: Variant, Button, Stats, Avatar, Time
  * Row example: "Example-First", "85%", "70%", "90%", "2.3s"
  * Green for >70%, red for <=70%
- Dark background #09090b, cards #18181b
```
