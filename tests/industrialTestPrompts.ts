/**
 * @file industrialTestPrompts.ts
 * @description Industrial-grade test prompts to stress-test LLM capabilities
 * 
 * 5 complex, multi-component prompts across different industries and styles
 * Designed to push the limits of:
 * - Layout complexity (nested AutoLayout, mixed directions)
 * - Component variety (cards, tables, forms, navigation, modals)
 * - Style sophistication (gradients, shadows, borders, responsive)
 * - Content density (data-heavy, multi-section)
 */

export interface IndustrialTestCase {
    id: string;
    industry: string;
    style: string;
    complexity: 'high' | 'extreme';
    prompt: string;
    expectedElements: string[];
    criticalChecks: string[];
}

export const INDUSTRIAL_TEST_PROMPTS: IndustrialTestCase[] = [
    // ==========================================
    // 1. FinTech - Banking Dashboard (Simplified)
    // ==========================================
    {
        id: 'fintech-dashboard',
        industry: 'FinTech / Banking',
        style: 'Professional, Dark Mode',
        complexity: 'high',
        prompt: `Create a banking dashboard with:

**Header (horizontal, dark background #1E293B):**
- Logo text "NeoBank" (white, 20px, left)
- Search input field (center, 280px wide)
- User avatar (40px, circular, right)

**Stats Row (horizontal, 4 equal cards):**
- Total Balance: "$24,850" (large white text)
- Income: "+$4,200" (green text)
- Expenses: "-$1,890" (red text)
- Savings: "68%" (blue text)
Each card: dark background #334155, 16px padding, 12px corner radius

**Action Buttons Row (horizontal, 4 buttons):**
- "Send Money" (blue #2563EB background, white text)
- "Request" (outline, dark border)
- "Pay Bills" (outline, dark border)
- "More" (ghost, text only)
All buttons: 44px height, 8px corner radius, equal width

Background: #0F172A, Inter font.`,
        expectedElements: [
            'Header with logo, search, avatar',
            '4 stat cards in horizontal row',
            'Action button row'
        ],
        criticalChecks: [
            'Avatar is circular (cornerRadius = width/2)',
            'Stat cards use FILL sizing',
            'Buttons have correct heights (44px)',
            'Dark theme colors applied'
        ]
    },

    // ==========================================
    // 2. Healthcare - Patient Portal
    // ==========================================
    {
        id: 'healthcare-portal',
        industry: 'Healthcare / Medical',
        style: 'Clean, Trustworthy, Light Mode',
        complexity: 'high',
        prompt: `Design a patient health portal screen with:

**Top Navigation:**
- Logo "HealthFirst" with medical cross icon
- Nav links: Dashboard, Appointments, Records, Messages, Pharmacy
- Active state: blue underline
- "Book Appointment" CTA button (rounded, green)
- Profile dropdown with name "John Doe"

**Main Content (2 columns, 60-40 split):**

**Left Column - Health Summary:**
- Greeting: "Good Morning, John" with sun icon
- Next Appointment Card:
  - Doctor avatar (48px, circular)
  - "Dr. Sarah Wilson - Cardiology"
  - "Tomorrow, 10:30 AM"
  - "Video Consultation" badge (blue)
  - "Join Call" button (primary)
  - "Reschedule" link

- Vital Signs Grid (2x2):
  - Heart Rate: 72 bpm (with heart icon, red)
  - Blood Pressure: 120/80 (with gauge icon)
  - Temperature: 98.6°F (with thermometer)
  - Weight: 165 lbs (with scale icon)
  Each card with trend arrow (up/down)

**Right Column - Activity:**
- Medication Reminders (3 items):
  - Pill icon, name, dosage, time, checkbox
- Recent Lab Results link
- Emergency Contact card

White background, blue accent (#3B82F6), Inter font.`,
        expectedElements: [
            'Top navigation with active state',
            '2-column layout',
            'Doctor appointment card',
            '2x2 vital signs grid',
            'Medication checklist'
        ],
        criticalChecks: [
            'Doctor avatar is circular',
            'Navigation uses horizontal layout',
            'Grid items use FILL',
            'Buttons are minimum 44px height',
            'Cards have consistent padding (16-20px)'
        ]
    },

    // ==========================================
    // 3. E-commerce - Product Listing
    // ==========================================
    {
        id: 'ecommerce-listing',
        industry: 'E-commerce / Retail',
        style: 'Modern, Visual, Lifestyle',
        complexity: 'extreme',
        prompt: `Create a product category page with:

**Sticky Header:**
- Logo "LUXE" 
- Category menu: Women, Men, Kids, Home, Sale (red)
- Search icon, Wishlist heart (badge: 2), Cart icon (badge: 3)
- All icons in a row, 24px

**Hero Banner:**
- Full width, 240px height
- Gradient overlay (black to transparent)
- Text overlay: "Summer Collection 2024"
- "Shop Now" button with arrow

**Filter Bar:**
- "128 Products" count
- Filter chips: Size, Color, Price, Brand (dismissible X)
- Sort dropdown: "Featured" with chevron
- Grid/List toggle icons

**Product Grid (3 columns):**
4 product cards, each with:
- Image placeholder (4:5 ratio)
- Wishlist heart icon (top right, white circle background)
- "NEW" badge if applicable (black, top left)
- Brand name (small, muted)
- Product name (medium weight)
- Price with original strikethrough if on sale
- Color dots (3-4 small circles)
- Star rating (4.5/5)

**Pagination:**
- << < 1 2 3 ... 12 > >>
- Current page highlighted

Clean white, accent #18181B, shadows on hover.`,
        expectedElements: [
            'Sticky header with icons and badges',
            'Hero banner with overlay',
            'Filter bar with chips',
            '3-column product grid',
            'Pagination controls'
        ],
        criticalChecks: [
            'Product cards have consistent structure',
            'Grid uses equal column widths',
            'Icons have touch target 44px',
            'Badges positioned correctly (top-right/left)',
            'Cards have hover shadow effect'
        ]
    },

    // ==========================================
    // 4. SaaS - Analytics Dashboard
    // ==========================================
    {
        id: 'saas-analytics',
        industry: 'SaaS / B2B',
        style: 'Data-driven, Minimal, Professional',
        complexity: 'extreme',
        prompt: `Design an analytics dashboard with:

**Sidebar (240px fixed, dark):**
- Logo "DataPulse" (white)
- Navigation sections:
  - MAIN: Dashboard (active), Analytics, Reports
  - MANAGEMENT: Users, Settings, Billing
  - Each item: icon (20px) + label
  - Active item: blue background, rounded
- Upgrade Banner at bottom: "Go Pro" with gradient

**Main Content Area:**

**Breadcrumb:** Dashboard > Analytics > Overview

**Date Range Selector:** "Last 7 Days" dropdown + Custom button

**KPI Cards Row (4 items):**
- Total Users: 12,458 (+12.5% green arrow)
- Active Sessions: 3,241 (-2.1% red arrow)
- Conversion Rate: 3.24% (sparkline mini chart)
- Revenue: $48,290 (+8.7%)
Cards with subtle border, rounded corners

**Charts Section (2 columns):**
- Left: Line chart placeholder "User Growth" (60% width)
  - Y-axis labels, X-axis dates
  - Legend: New Users, Returning Users
- Right: Donut chart "Traffic Sources" (40% width)
  - Organic: 45%, Paid: 30%, Referral: 15%, Direct: 10%
  - Legend below chart

**Top Pages Table:**
- Columns: Page, Views, Unique, Bounce Rate, Avg Time
- 5 rows with real data
- Sortable column headers (chevron icons)
- Hover state on rows

Inter font, #F8FAFC background, #6366F1 primary.`,
        expectedElements: [
            '240px fixed sidebar',
            '4 KPI cards in row',
            '2-column chart section',
            'Data table with sortable headers',
            'Breadcrumb navigation'
        ],
        criticalChecks: [
            'Sidebar is fixed 240px width',
            'KPI cards use FILL sizing',
            'Charts section uses 60/40 split',
            'Table has alternating rows or borders',
            'Active nav item has different background'
        ]
    },

    // ==========================================
    // 5. Social / Creator - Profile Page
    // ==========================================
    {
        id: 'creator-profile',
        industry: 'Social Media / Creator Economy',
        style: 'Vibrant, Expressive, Gen-Z',
        complexity: 'high',
        prompt: `Create a creator profile page with:

**Cover Image Area:**
- Full width, 200px height
- Gradient placeholder (purple to pink)
- Edit button (white, rounded, top right)

**Profile Section (overlapping cover):**
- Avatar: 96px, circular, white 4px border, centered
- Verified badge (blue checkmark overlay)
- Name: "Alex Creative" (24px, bold)
- Handle: "@alexcreative" (muted)
- Bio: "Digital artist | NFT Creator | Coffee addict ☕"
- Location pin icon + "Los Angeles, CA"
- Link icon + "alexcreative.design"

**Stats Row (centered, 3 items):**
- 248 Posts | 52.4K Followers | 892 Following
- Tappable, with subtle separator

**Action Buttons (centered):**
- "Follow" (gradient purple-pink, white text, pill shape)
- "Message" (outline, dark text, pill shape)
- Share icon button (circle)

**Tabs:**
- Posts | Collections | Liked | About
- Active: bold with underline
- Horizontal, centered

**Content Grid (3 columns, masonry-like):**
- 6 image placeholders
- Various heights (150px, 200px, 180px alternating)
- Rounded corners 12px
- Hover overlay with heart + count

Use Poppins font, dark mode (#0A0A0A), accent gradient.`,
        expectedElements: [
            'Cover image with edit button',
            'Overlapping avatar with badge',
            'Stats row with separators',
            'Gradient follow button',
            'Tab navigation',
            '3-column content grid'
        ],
        criticalChecks: [
            'Avatar is 96px circular with border',
            'Follow button uses gradient fill',
            'Stats use horizontal layout with FILL',
            'Tab underline on active state',
            'Grid columns are equal width'
        ]
    }
];

// ==========================================
// Test Execution Helper
// ==========================================

export function getTestPromptById(id: string): IndustrialTestCase | undefined {
    return INDUSTRIAL_TEST_PROMPTS.find(test => test.id === id);
}

export function getAllTestPrompts(): string[] {
    return INDUSTRIAL_TEST_PROMPTS.map(test => test.prompt);
}

export function formatTestSummary(): string {
    return INDUSTRIAL_TEST_PROMPTS.map((test, i) =>
        `${i + 1}. [${test.industry}] ${test.id}\n   Style: ${test.style}\n   Complexity: ${test.complexity}`
    ).join('\n\n');
}
