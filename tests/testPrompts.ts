/**
 * @file testPrompts.ts
 * @description Test prompts for validating LLM constraint improvements
 * 
 * 5 UI components with increasing complexity to test:
 * 1. PostProcessor rules (height, shadow, padding, cornerSmoothing)
 * 2. Few-Shot example matching (card, navigation, form)
 * 3. SelectionContext style feature extraction
 */

import { NodeLayer } from '../schema';
import { Effect } from './postProcessor';

// ==========================================
// Test Cases - 5 Different Components
// ==========================================

export interface TestCase {
    id: string;
    name: string;
    complexity: 'simple' | 'medium' | 'complex';
    prompt: string;
    expectedChecks: {
        name: string;
        check: (layer: NodeLayer) => boolean;
        relatedRule?: string;  // Which PostProcessor rule should catch this
    }[];
}

export const TEST_CASES: TestCase[] = [
    // ==========================================
    // 1. Simple Button - Tests ButtonHeight, LineHeight
    // ==========================================
    {
        id: 'simple-button',
        name: 'Primary Action Button',
        complexity: 'simple',
        prompt: `Create a modern primary action button with:
- Text: "Get Started"
- Style: Blue background, white text
- Full width in container`,
        expectedChecks: [
            {
                name: 'Button height is 40-48px',
                check: (layer) => {
                    const btn = findNode(layer, ['button', 'btn', 'cta', 'get', 'started']);
                    return btn?.props?.height >= 40 && btn?.props?.height <= 48;
                },
                relatedRule: 'ButtonHeightCorrection'
            },
            {
                name: 'Button has centered content',
                check: (layer) => {
                    const btn = findNode(layer, ['button', 'btn']);
                    return btn?.props?.primaryAxisAlignItems === 'CENTER' &&
                        btn?.props?.counterAxisAlignItems === 'CENTER';
                },
                relatedRule: 'ButtonContentAlignmentCorrection'
            },
            {
                name: 'Text has line height set',
                check: (layer) => {
                    const text = findNode(layer, [], 'TEXT');
                    return text?.props?.lineHeight !== undefined;
                },
                relatedRule: 'LineHeightAutoCorrection'
            }
        ]
    },

    // ==========================================
    // 2. Product Card - Tests CardMinPadding, ShadowOpacity
    // ==========================================
    {
        id: 'product-card',
        name: 'E-commerce Product Card',
        complexity: 'medium',
        prompt: `Create a product card with:
- Product image placeholder (16:9 ratio)
- Product name: "Wireless Headphones"
- Price: "$149.99"
- Add to cart button
- Subtle shadow, white background, rounded corners`,
        expectedChecks: [
            {
                name: 'Card has minimum 16px padding',
                check: (layer) => {
                    const card = findNode(layer, ['card', 'product']);
                    const p = card?.props?.padding;
                    if (!p) return false;
                    if (typeof p === 'number') return p >= 16;
                    return p.top >= 12 && p.right >= 12 && p.bottom >= 12 && p.left >= 12;
                },
                relatedRule: 'CardMinPaddingCorrection'
            },
            {
                name: 'Shadow is subtle (8-15% opacity)',
                check: (layer) => {
                    const card = findNode(layer, ['card', 'product']);
                    const effects = card?.props?.effects;
                    if (!effects || effects.length === 0) return true; // No shadow is ok
                    const shadow = effects.find((e: Effect) => e.type === 'DROP_SHADOW');
                    if (!shadow) return true;
                    // Check opacity: #RRGGBBAA where AA <= 26 (hex) = 15%
                    const color = shadow.color || '';
                    if (color.length === 9) {
                        const opacity = parseInt(color.slice(7, 9), 16);
                        return opacity <= 40; // ~15%
                    }
                    return false; // 6-char hex = 100% opacity = bad
                },
                relatedRule: 'ShadowOpacityFix'
            },
            {
                name: 'Button inside card has correct height',
                check: (layer) => {
                    const btn = findNode(layer, ['button', 'cart', 'add']);
                    if (!btn) return true; // No button is ok for card
                    return btn.props?.height >= 36 && btn.props?.height <= 48;
                },
                relatedRule: 'ButtonHeightCorrection'
            }
        ]
    },

    // ==========================================
    // 3. Top Navigation - Tests FILL layout, spacing
    // ==========================================
    {
        id: 'top-navigation',
        name: 'Header Navigation Bar',
        complexity: 'medium',
        prompt: `Create a top navigation bar with:
- Logo on left: "Acme Co"
- Nav links: Home, Products, About, Contact
- Search input field on right
- CTA button: "Sign Up"
- White background, subtle bottom border`,
        expectedChecks: [
            {
                name: 'Navigation uses HORIZONTAL layout',
                check: (layer) => {
                    const nav = findNode(layer, ['nav', 'header', 'bar']);
                    return nav?.props?.layout === 'HORIZONTAL';
                }
            },
            {
                name: 'Search input has correct height',
                check: (layer) => {
                    const input = findNode(layer, ['search', 'input', 'field']);
                    if (!input) return true;
                    const h = input.props?.height;
                    return h >= 36 && h <= 56;
                },
                relatedRule: 'InputHeightCorrection'
            },
            {
                name: 'CTA button has filled background',
                check: (layer) => {
                    const btn = findNode(layer, ['cta', 'signup', 'sign']);
                    if (!btn) return true;
                    const fills = btn.props?.fills;
                    return fills && fills.length > 0 && fills[0] !== 'transparent';
                }
            }
        ]
    },

    // ==========================================
    // 4. Contact Form - Tests InputHeight, labeled structure
    // ==========================================
    {
        id: 'contact-form',
        name: 'Contact Form with Validation',
        complexity: 'complex',
        prompt: `Create a contact form with:
- Title: "Get in Touch"
- Fields: Name (required), Email (required), Message (textarea)
- Show red asterisk for required fields
- Submit button: "Send Message"
- White card container with shadow`,
        expectedChecks: [
            {
                name: 'All input fields have 44-52px height',
                check: (layer) => {
                    const inputs = findAllNodes(layer, ['input', 'field', 'name', 'email']);
                    if (inputs.length === 0) return false;
                    return inputs.every(inp => {
                        const h = inp.props?.height;
                        return h >= 40 && h <= 56;
                    });
                },
                relatedRule: 'InputHeightCorrection'
            },
            {
                name: 'Form container has proper padding',
                check: (layer) => {
                    const form = findNode(layer, ['form', 'contact', 'card']);
                    const p = form?.props?.padding;
                    if (!p) return false;
                    if (typeof p === 'number') return p >= 16;
                    return p.top >= 16 && p.left >= 16;
                },
                relatedRule: 'CardMinPaddingCorrection'
            },
            {
                name: 'Submit button is full width',
                check: (layer) => {
                    const btn = findNode(layer, ['submit', 'send', 'button']);
                    return btn?.props?.layoutSizingHorizontal === 'FILL';
                }
            },
            {
                name: 'Has required indicator (red asterisk)',
                check: (layer) => {
                    const asterisk = findNode(layer, ['*', 'required']);
                    if (asterisk) return true;
                    // Also check for red text
                    const allText = findAllNodes(layer, [], 'TEXT');
                    return allText.some(t =>
                        t.props?.content === '*' ||
                        (t.props?.color?.toLowerCase().includes('ef') && t.props?.content?.includes('*'))
                    );
                }
            }
        ]
    },

    // ==========================================
    // 5. iOS App Icon - Tests iOSCornerSmoothing
    // ==========================================
    {
        id: 'ios-app-icon',
        name: 'iOS Style App Icon',
        complexity: 'simple',
        prompt: `Create an iOS-style app icon with:
- Size: 120x120px
- Gradient background (blue to purple)
- Centered white icon symbol (placeholder)
- iOS squircle corner style
- Name it "iOS-AppIcon"`,
        expectedChecks: [
            {
                name: 'Has correct dimensions (120x120)',
                check: (layer) => {
                    const icon = findNode(layer, ['ios', 'icon', 'app']);
                    return icon?.props?.width === 120 && icon?.props?.height === 120;
                }
            },
            {
                name: 'Has corner smoothing for iOS style',
                check: (layer) => {
                    const icon = findNode(layer, ['ios', 'icon', 'app']);
                    // Either LLM sets it, or PostProcessor adds it
                    return icon?.props?.cornerSmoothing === 0.6 ||
                        icon?.props?.cornerSmoothing > 0.5;
                },
                relatedRule: 'iOSCornerSmoothing'
            },
            {
                name: 'Has rounded corners',
                check: (layer) => {
                    const icon = findNode(layer, ['ios', 'icon', 'app']);
                    const r = icon?.props?.cornerRadius;
                    return r !== undefined && r >= 20;
                }
            }
        ]
    }
];

// ==========================================
// Helper Functions
// ==========================================

function findNode(layer: NodeLayer, keywords: string[], type?: string): NodeLayer | null {
    if (!layer) return null;

    const name = (layer.props?.name || '').toLowerCase();
    const content = (layer.props?.content || '').toLowerCase();

    const matchesKeywords = keywords.length === 0 ||
        keywords.some(kw => name.includes(kw.toLowerCase()) || content.includes(kw.toLowerCase()));
    const matchesType = !type || layer.type === type;

    if (matchesKeywords && matchesType) {
        return layer;
    }

    if (layer.children) {
        for (const child of layer.children) {
            const found = findNode(child, keywords, type);
            if (found) return found;
        }
    }

    return null;
}

function findAllNodes(layer: NodeLayer, keywords: string[], type?: string): NodeLayer[] {
    const results: NodeLayer[] = [];

    if (!layer) return results;

    const name = (layer.props?.name || '').toLowerCase();
    const content = (layer.props?.content || '').toLowerCase();

    const matchesKeywords = keywords.length === 0 ||
        keywords.some(kw => name.includes(kw.toLowerCase()) || content.includes(kw.toLowerCase()));
    const matchesType = !type || layer.type === type;

    if (matchesKeywords && matchesType) {
        results.push(layer);
    }

    if (layer.children) {
        for (const child of layer.children) {
            results.push(...findAllNodes(child, keywords, type));
        }
    }

    return results;
}

// ==========================================
// Test Runner
// ==========================================

export interface TestCaseResult {
    testCase: TestCase;
    passed: boolean;
    checkResults: {
        name: string;
        passed: boolean;
        relatedRule?: string;
    }[];
    rawJSON: string;
    generationTime: number;
    error?: string;
}

export function validateTestCase(testCase: TestCase, layer: NodeLayer): TestCaseResult['checkResults'] {
    return testCase.expectedChecks.map(check => ({
        name: check.name,
        passed: check.check(layer),
        relatedRule: check.relatedRule
    }));
}

export function summarizeResults(results: TestCaseResult[]): {
    totalTests: number;
    passed: number;
    failed: number;
    ruleEffectiveness: Record<string, { triggered: number; fixed: number }>;
} {
    const ruleStats: Record<string, { triggered: number; fixed: number }> = {};

    let passed = 0;
    let failed = 0;

    for (const result of results) {
        if (result.passed) passed++;
        else failed++;

        for (const check of result.checkResults) {
            if (check.relatedRule) {
                if (!ruleStats[check.relatedRule]) {
                    ruleStats[check.relatedRule] = { triggered: 0, fixed: 0 };
                }
                ruleStats[check.relatedRule].triggered++;
                if (check.passed) {
                    ruleStats[check.relatedRule].fixed++;
                }
            }
        }
    }

    return {
        totalTests: results.length,
        passed,
        failed,
        ruleEffectiveness: ruleStats
    };
}

// ==========================================
// INDUSTRIAL-GRADE TEST PROMPTS
// Copy-paste these into the plugin to test
// ==========================================

/**
 * Industrial-grade prompts for testing LLM + PostProcessor quality
 * Each prompt is designed to stress-test specific aspects:
 * - Complex nested layouts
 * - Multiple responsive containers
 * - Edge cases for fixed widths (320, 375, 390)
 * - Button heights, shadows, avatars
 * - Dark/light contrast
 */

export const INDUSTRIAL_PROMPTS = {
    // ==========================================
    // DESKTOP PROMPTS (1440px width)
    // ==========================================

    desktop: {
        // --- D1: SaaS Dashboard ---
        saas_dashboard: `Create a SaaS analytics dashboard with:
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
- All nested containers MUST use layoutSizingHorizontal: FILL, not fixed widths`,

        // --- D2: E-commerce Product Listing ---
        ecommerce_grid: `Create an e-commerce product grid page:
- Width: 1440px
- Top navigation: Logo, Search bar (FILL width), Cart icon, User avatar (40px circular)
- Filter sidebar (280px left): Category checkboxes, Price range slider, Brand filters
- Product grid (FILL remaining):
  - Section title "Featured Products" with "View All" link (right aligned)
  - 3-column grid of product cards (each card MUST use FILL, not 320px)
  - Each card: Image placeholder (16:9), product name, rating stars, price ($99.99), "Add to Cart" button
  - Button: 44px height, blue background, white text
- Gap between cards: 24px
- Cards have subtle shadow on hover state indicator`,

        // --- D3: Team Collaboration Workspace ---
        team_workspace: `Create a Notion-style workspace:
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
- Dark mode header option (dark bg, white text)`,

        // --- D4: Admin Data Table ---
        admin_table: `Create an admin users table:
- Width: 1440px, white background
- Top toolbar: Search input (FILL), Filter dropdown, "Add User" button (blue, 44px)
- Table container:
  - Header row: Checkbox, Avatar, Name (FILL), Email (FILL), Role, Status, Actions
  - Zebra striped rows (alternating white and #F9FAFB)
  - Avatar: 36px circular
  - Status badges: Active (green), Pending (yellow), Inactive (red)
  - Actions: Edit and Delete icon buttons
- Pagination: Previous/Next buttons, page numbers, items per page dropdown
- All column children MUST stretch responsively`,

        // --- D5: Settings Panel ---
        settings_panel: `Create a settings page with multiple sections:
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
- Section cards: 24px padding, 12px corner radius`,
    },

    // ==========================================
    // MOBILE PROMPTS (375px or 390px width)
    // ==========================================

    mobile: {
        // --- M1: Social Profile Card ---
        profile_card: `Create a mobile social profile card:
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
- Card padding: 24px, corner radius: 16px, subtle shadow`,

        // --- M2: Login Screen ---
        login_screen: `Create a mobile login screen:
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
- All elements perfectly centered, 20px gap between sections`,

        // --- M3: Food Delivery Order Card ---
        food_order: `Create a food delivery order tracking card:
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
- All nested sections use FILL width, subtle shadows on cards`,

        // --- M4: Music Player ---
        music_player: `Create a mobile music player now playing screen:
- Width: 390px, dark background (#1F1F1F)
- Album art: FILL width minus 48px margin, square aspect, 16px corners
- Song info: "Starlight" (22px bold white), "The Weeknd" (16px gray)
- Progress bar: Full width, current time left, total time right
- Control buttons row centered:
  * Shuffle, Previous, Play (larger, 64px circle), Next, Repeat
- Volume slider: Full width
- Bottom row: Heart icon, Add to playlist, Share
- All text MUST be white or light gray for contrast on dark bg`,

        // --- M5: Chat Conversation ---
        chat_screen: `Create a mobile chat conversation screen:
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
- Bubbles: max-width 70%, wrap text properly`,
    },

    // ==========================================
    // STRESS TEST PROMPTS
    // Specifically designed to trigger PostProcessor rules
    // ==========================================

    stress_tests: {
        // --- Fixed Width Bug Test ---
        fixed_width_stress: `Create a card grid that tests responsive layouts:
- Width: 1200px
- 3-column grid of feature cards
- CRITICAL: Each card container MUST NOT have fixed width like 320px or 375px
- Each card: Icon placeholder, title, description, "Learn more" link
- Cards should expand equally using FILL sizing
- Test that no child element has hardcoded mobile viewport widths`,

        // --- Button Height Stress Test ---
        button_height_stress: `Create a form with multiple button styles:
- Submit button (primary)
- Cancel button (secondary)
- Delete button (destructive red)
- Icon-only button
- CRITICAL: ALL buttons MUST be 44-48px height, NEVER 60px
- Test button containers with HUG height`,

        // --- Avatar Grid Stress Test ---
        avatar_grid_stress: `Create a team members grid:
- 8 team member cards in 4x2 grid
- Each card has circular avatar (64px)
- CRITICAL: All avatars MUST have cornerRadius = 32 (half of 64)
- Name and role below avatar
- Social links row`,

        // --- Shadow Opacity Stress Test ---
        shadow_stress: `Create overlapping card layers:
- Background card with shadow
- Floating modal card on top with shadow
- Dropdown menu with shadow
- CRITICAL: All shadows MUST be subtle (8-15% opacity), NEVER pure black
- Test that #000000 shadows are converted to #00000014`,

        // --- Dark Mode Contrast Stress Test ---
        dark_mode_stress: `Create a dark themed dashboard widget:
- Dark background (#1E1E2E)
- Stats with large numbers
- Graph placeholder
- Action buttons
- CRITICAL: All text MUST be white or light colored for readability
- Test that dark backgrounds auto-fix text to white`,
    }
};

// ==========================================
// EDGE CASE PROMPTS
// Designed to expose boundary conditions and ambiguous scenarios
// Each case targets a specific potential failure mode
// ==========================================

export const EDGE_CASE_PROMPTS = {
    // ==========================================
    // SEMANTIC AMBIGUITY
    // Tests isButton, isCard, etc. helper accuracy
    // ==========================================
    semantic: {
        // "Follow" vs "Following" vs "Followers"
        button_vs_stat: `Create a social profile header with:
- "Follow" button (should BE a button)
- "Following" status label (should NOT be a button)
- "1.2K Followers" stat (should NOT be a button)
- "12 Posts" stat (should NOT be a button)
CRITICAL: Only "Follow" should get button styling`,

        // "Line" in different contexts
        line_ambiguity: `Create a UI with these elements:
- A "Divider Line" (1px height, FILL width)
- A "Headline" text (should NOT be 1px height!)
- A "Timeline" component (vertical list, NOT a divider)
- An "Outline" button (button with border, NOT a divider)
CRITICAL: Only "Divider Line" should get line/divider treatment`,

        // Card semantic edge cases
        card_ambiguity: `Create a page with:
- A "Product Card" (should have padding, shadow)
- A "Credit Card" input field (input styling, NOT card padding)
- A "Card Number" label (text, NOT a card component)
CRITICAL: Only "Product Card" should get card styling`,
    },

    // ==========================================
    // EXTREME SIZING
    // Tests behavior with unusual dimensions
    // ==========================================
    sizing: {
        // Very long text
        long_text: `Create a card with:
- Title: "This is an extremely long title that should wrap properly across multiple lines without breaking the layout"
- Description: A 500-character paragraph (generate placeholder text)
- Small container width: 280px
CRITICAL: Text should wrap, not overflow`,

        // Many children
        many_children: `Create a tag cloud with:
- 25 individual tag badges
- Each tag: different lengths ("AI", "Machine Learning", "UX")
- Horizontal wrap layout
CRITICAL: Tags should wrap to new rows, not overflow`,

        // Tiny elements
        tiny_elements: `Create a notification dot badge:
- Size: 8x8px red circle
- Positioned at top-right of an icon
CRITICAL: Should NOT trigger "tiny frame fix" rule`,

        // Zero/undefined sizing
        undefined_sizes: `Create a card where:
- Some elements have explicit sizes
- Some elements should auto-size based on content
- Container uses HUG for height
CRITICAL: Missing height should become HUG, not 0px`,
    },

    // ==========================================
    // NESTED LAYOUT COMPLEXITY
    // Tests rule interactions at deep nesting
    // ==========================================
    nesting: {
        // Deep nesting
        deep_nesting: `Create a page with 5 levels of nesting:
- Page (VERTICAL)
  - Header (HORIZONTAL)
    - Logo area (VERTICAL)
      - Icon + text (HORIZONTAL)
        - Icon (FIXED)
        - Text (FILL)
CRITICAL: Innermost FILL should work correctly`,

        // Conflicting rules
        rule_conflict: `Create a component that could match multiple rules:
- Named "Action Button Container" (matches button? container?)
- Has fixed width 320px (should it become FILL?)
- Inside a HORIZONTAL parent (should it FILL?)
- Is a navigation section (should it HUG?)
CRITICAL: Most specific rule should win`,

        // Mixed layout modes
        mixed_modes: `Create a layout with:
- VERTICAL container
  - HORIZONTAL row 1 (items should FILL)
  - NONE (absolute) positioned element
  - HORIZONTAL row 2 (items should FILL)
CRITICAL: Each nested container uses correct sizing for its parent`,
    },

    // ==========================================
    // TYPOGRAPHY EDGE CASES
    // Tests text handling boundaries
    // ==========================================
    typography: {
        // Font weight variations
        font_weights: `Create text samples with these exact weights:
- Thin (100)
- Light (300)
- Regular (400)
- Medium (500)
- SemiBold (600)
- Bold (700)
- Black (900)
CRITICAL: Each should render with correct font style`,

        // Line height edge cases
        line_heights: `Create text with:
- Single line title (should HUG)
- Multi-line paragraph (should have 150% line height)
- Numeric value display "1,234" (no extra line height)
CRITICAL: Line height should only apply to body text`,

        // Empty text
        empty_text: `Create a component with:
- A text placeholder that shows "Enter text..."
- An empty text node (content: "")
- A text node with only whitespace
CRITICAL: Empty text should not crash renderer`,
    },

    // ==========================================
    // STYLING EDGE CASES
    // Tests color, shadow, effects handling
    // ==========================================
    styling: {
        // Color format variations
        color_formats: `Create elements with these color formats:
- Hex 6-char: #FF5733
- Hex 8-char with alpha: #FF573380
- Variable reference: Variable:brand/primary
- Named color: "blue"
CRITICAL: All formats should parse correctly`,

        // Shadow variations
        shadow_variations: `Create cards with different shadows:
- Subtle shadow (8% opacity)
- Medium shadow (15% opacity)
- Strong shadow (25% opacity)
- Inner shadow
- Multiple stacked shadows
CRITICAL: Opacity should be preserved or capped at 25%`,

        // Gradient edge case
        gradient_attempt: `Create a button with:
- Gradient background (blue to purple)
- If gradients not supported, use solid blue
CRITICAL: Should not crash if gradient parsing fails`,
    },

    // ==========================================
    // COMPONENT EDGE CASES
    // Tests specific component patterns
    // ==========================================
    components: {
        // Avatar group
        avatar_group: `Create an overlapping avatar group:
- 5 avatars (32px each, circular)
- Overlapping by 8px each
- "+3" overflow indicator at end
CRITICAL: All avatars should have cornerRadius = 16`,

        // Toggle/Switch
        toggle_states: `Create toggle switches in different states:
- On state (blue background)
- Off state (gray background)
- Disabled state (faded)
CRITICAL: Switches should be 52x32px or similar, NOT button height`,

        // Tabs
        tab_bar: `Create a tab bar with:
- 4 tabs: Home, Search, Notifications, Profile
- Active tab has blue underline
- Tab labels (NOT buttons - different height)
CRITICAL: Tab heights should be 44-48px, but NOT apply button rules`,

        // Empty state
        empty_state: `Create an empty state illustration:
- Large icon or illustration placeholder (120x120)
- Title: "No results found"
- Description: "Try adjusting your search"
- "Clear filters" button
CRITICAL: Container should center all content`,
    }
};

// Edge case test runner
export interface EdgeCaseTest {
    category: string;
    name: string;
    prompt: string;
    criticalCheck: string;
}

export function getEdgeCaseTests(): EdgeCaseTest[] {
    const tests: EdgeCaseTest[] = [];

    for (const [category, prompts] of Object.entries(EDGE_CASE_PROMPTS)) {
        for (const [name, prompt] of Object.entries(prompts)) {
            // Extract CRITICAL check from prompt
            const criticalMatch = prompt.match(/CRITICAL: (.+)$/m);
            tests.push({
                category,
                name,
                prompt,
                criticalCheck: criticalMatch ? criticalMatch[1] : 'Manual verification required'
            });
        }
    }

    return tests;
}

// ==========================================
// Quick Copy Helper
// ==========================================

export function getPromptsList(): { category: string; name: string; prompt: string }[] {
    const list: { category: string; name: string; prompt: string }[] = [];

    for (const [cat, prompts] of Object.entries(INDUSTRIAL_PROMPTS)) {
        for (const [name, prompt] of Object.entries(prompts)) {
            list.push({ category: cat, name, prompt });
        }
    }

    return list;
}

export function printAllPrompts(): void {
    console.log('\n=== INDUSTRIAL TEST PROMPTS ===\n');

    for (const item of getPromptsList()) {
        console.log(`📋 [${item.category.toUpperCase()}] ${item.name}`);
        console.log('-'.repeat(50));
        console.log(item.prompt);
        console.log('\n');
    }
}

