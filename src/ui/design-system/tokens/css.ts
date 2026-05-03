/**
 * @file css.ts
 * @description Global CSS custom properties (variables) definition - Radix Standards
 *
 * Only the 5 color scales actually referenced are included:
 *   gray (neutral), blue (accent), green (success), crimson (error), amber (warning)
 */

const lightModeTokens = `
  :root {
    /* --- Radix Scales (Used) --- */
    /* Gray (Neutral) - Light Mode */
    --gray-1: #fcfcfc;
    --gray-2: #f9f9f9;
    --gray-3: #f0f0f0;
    --gray-4: #e8e8e8;
    --gray-5: #e0e0e0;
    --gray-6: #d9d9d9;
    --gray-7: #cecece;
    --gray-8: #bbbbbb;
    --gray-9: #8d8d8d;
    --gray-10: #838383;
    --gray-11: #646464;
    --gray-12: #171717;

    --gray-a1: rgba(0, 0, 0, 0.012);
    --gray-a2: rgba(0, 0, 0, 0.024);
    --gray-a3: rgba(0, 0, 0, 0.059);
    --gray-a4: rgba(0, 0, 0, 0.09);
    --gray-a5: rgba(0, 0, 0, 0.118);
    --gray-a6: rgba(0, 0, 0, 0.149);
    --gray-a7: rgba(0, 0, 0, 0.192);
    --gray-a8: rgba(0, 0, 0, 0.267);
    --gray-a9: rgba(0, 0, 0, 0.447);
    --gray-a10: rgba(0, 0, 0, 0.486);
    --gray-a11: rgba(0, 0, 0, 0.608);
    --gray-a12: rgba(0, 0, 0, 0.875);

    /* Amber (Warning) */
    --amber-1: #FEFDFB;
    --amber-2: #FEFBE9;
    --amber-3: #FFF7C2;
    --amber-4: #FFEE9C;
    --amber-5: #FBE577;
    --amber-6: #F3D673;
    --amber-7: #E9C162;
    --amber-8: #E2A336;
    --amber-9: #FFC53D;
    --amber-10: #FFBA18;
    --amber-11: #AB6400;
    --amber-12: #4F3422;
    --amber-a1: rgba(192, 128, 0, 0.016);
    --amber-a2: rgba(244, 209, 0, 0.086);
    --amber-a3: rgba(255, 222, 0, 0.239);
    --amber-a4: rgba(255, 212, 0, 0.388);
    --amber-a5: rgba(248, 207, 0, 0.533);
    --amber-a6: rgba(234, 181, 0, 0.549);
    --amber-a7: rgba(220, 155, 0, 0.616);
    --amber-a8: rgba(218, 138, 0, 0.788);
    --amber-a9: rgba(255, 179, 0, 0.761);
    --amber-a10: rgba(255, 179, 0, 0.906);
    --amber-a11: #AB6400;
    --amber-a12: rgba(52, 21, 0, 0.867);

    /* Blue (Accent) */
    --blue-1: #FBFDFF;
    --blue-2: #F4FAFF;
    --blue-3: #E6F4FE;
    --blue-4: #D5EFFF;
    --blue-5: #C2E5FF;
    --blue-6: #ACD8FC;
    --blue-7: #8EC8F6;
    --blue-8: #5EB1EF;
    --blue-9: #0090FF;
    --blue-10: #0588F0;
    --blue-11: #0D74CE;
    --blue-12: #113264;
    --blue-a1: rgba(0, 128, 255, 0.016);
    --blue-a2: rgba(0, 140, 255, 0.043);
    --blue-a3: rgba(0, 143, 245, 0.098);
    --blue-a4: rgba(0, 158, 255, 0.165);
    --blue-a5: rgba(0, 147, 255, 0.239);
    --blue-a6: rgba(0, 136, 246, 0.325);
    --blue-a7: rgba(0, 131, 235, 0.443);
    --blue-a8: rgba(0, 132, 230, 0.631);
    --blue-a9: #0090FF;
    --blue-a10: rgba(0, 134, 240, 0.98);
    --blue-a11: rgba(0, 109, 203, 0.949);
    --blue-a12: rgba(91, 92, 93, 0.933);

    /* Crimson (Error) */
    --crimson-1: #FFFCFD;
    --crimson-2: #FEF7F9;
    --crimson-3: #FFE9F0;
    --crimson-4: #FEDCE7;
    --crimson-5: #FACEDD;
    --crimson-6: #F3BED1;
    --crimson-7: #EAACC3;
    --crimson-8: #E093B2;
    --crimson-9: #E93D82;
    --crimson-10: #DF3478;
    --crimson-11: #CB1D63;
    --crimson-12: #621639;
    --crimson-a1: rgba(255, 0, 85, 0.012);
    --crimson-a2: rgba(224, 0, 64, 0.031);
    --crimson-a3: rgba(255, 0, 82, 0.086);
    --crimson-a4: rgba(248, 0, 81, 0.137);
    --crimson-a5: rgba(229, 0, 79, 0.192);
    --crimson-a6: rgba(208, 0, 75, 0.255);
    --crimson-a7: rgba(191, 0, 71, 0.325);
    --crimson-a8: rgba(182, 0, 74, 0.424);
    --crimson-a9: rgba(226, 0, 91, 0.761);
    --crimson-a10: rgba(215, 0, 86, 0.796);
    --crimson-a11: rgba(196, 0, 79, 0.886);
    --crimson-a12: rgba(83, 0, 38, 0.914);

    /* Green (Success) */
    --green-1: #FBFEFC;
    --green-2: #F4FBF6;
    --green-3: #E6F6EB;
    --green-4: #D6F1DF;
    --green-5: #C4E8D1;
    --green-6: #ADDDC0;
    --green-7: #8ECEAA;
    --green-8: #5BB98B;
    --green-9: #30A46C;
    --green-10: #2B9A66;
    --green-11: #218358;
    --green-12: #193B2D;
    --green-a1: rgba(0, 192, 64, 0.016);
    --green-a2: rgba(0, 163, 47, 0.043);
    --green-a3: rgba(0, 164, 51, 0.098);
    --green-a4: rgba(0, 168, 56, 0.161);
    --green-a5: rgba(1, 156, 57, 0.231);
    --green-a6: rgba(0, 150, 60, 0.322);
    --green-a7: rgba(0, 145, 64, 0.443);
    --green-a8: rgba(0, 146, 75, 0.643);
    --green-a9: rgba(0, 143, 74, 0.812);
    --green-a10: rgba(0, 134, 71, 0.831);
    --green-a11: rgba(0, 113, 63, 0.871);
    --green-a12: rgba(0, 38, 22, 0.902);

    /* --- Semantic Aliases --- */

    /* Success / Green */
    --success-1: var(--green-1);
    --success-2: var(--green-2);
    --success-3: var(--green-3);
    --success-4: var(--green-4);
    --success-5: var(--green-5);
    --success-6: var(--green-6);
    --success-7: var(--green-7);
    --success-8: var(--green-8);
    --success-9: var(--green-9);
    --success-10: var(--green-10);
    --success-11: var(--green-11);
    --success-12: var(--green-12);
    --success-a1: var(--green-a1);
    --success-a2: var(--green-a2);
    --success-a3: var(--green-a3);
    --success-a4: var(--green-a4);
    --success-a5: var(--green-a5);
    --success-a6: var(--green-a6);
    --success-a7: var(--green-a7);
    --success-a8: var(--green-a8);
    --success-a9: var(--green-a9);
    --success-a10: var(--green-a10);
    --success-a11: var(--green-a11);
    --success-a12: var(--green-a12);

    /* Error / Crimson */
    --error-1: var(--crimson-1);
    --error-2: var(--crimson-2);
    --error-3: var(--crimson-3);
    --error-4: var(--crimson-4);
    --error-5: var(--crimson-5);
    --error-6: var(--crimson-6);
    --error-7: var(--crimson-7);
    --error-8: var(--crimson-8);
    --error-9: var(--crimson-9);
    --error-10: var(--crimson-10);
    --error-11: var(--crimson-11);
    --error-12: var(--crimson-12);
    --error-a1: var(--crimson-a1);
    --error-a2: var(--crimson-a2);
    --error-a3: var(--crimson-a3);
    --error-a4: var(--crimson-a4);
    --error-a5: var(--crimson-a5);
    --error-a6: var(--crimson-a6);
    --error-a7: var(--crimson-a7);
    --error-a8: var(--crimson-a8);
    --error-a9: var(--crimson-a9);
    --error-a10: var(--crimson-a10);
    --error-a11: var(--crimson-a11);
    --error-a12: var(--crimson-a12);

    /* Warning / Amber */
    --warning-1: var(--amber-1);
    --warning-2: var(--amber-2);
    --warning-3: var(--amber-3);
    --warning-4: var(--amber-4);
    --warning-5: var(--amber-5);
    --warning-6: var(--amber-6);
    --warning-7: var(--amber-7);
    --warning-8: var(--amber-8);
    --warning-9: var(--amber-9);
    --warning-10: var(--amber-10);
    --warning-11: var(--amber-11);
    --warning-12: var(--amber-12);
    --warning-a1: var(--amber-a1);
    --warning-a2: var(--amber-a2);
    --warning-a3: var(--amber-a3);
    --warning-a4: var(--amber-a4);
    --warning-a5: var(--amber-a5);
    --warning-a6: var(--amber-a6);
    --warning-a7: var(--amber-a7);
    --warning-a8: var(--amber-a8);
    --warning-a9: var(--amber-a9);
    --warning-a10: var(--amber-a10);
    --warning-a11: var(--amber-a11);
    --warning-a12: var(--amber-a12);

    /* --- Semantic Color Aliases --- */
    --color-background: #fcfcfc;
    --color-surface: #ffffff;
    --color-panel: #ffffff;

    /* Segmented control (Theme switcher etc.) — track + sliding thumb.
       Light mode: track = light gray, thumb = white (one shade brighter than track).
       Dark mode: track = gray-3, thumb = gray-5 (one+ shade brighter than track). */
    --seg-pill-track: var(--gray-2);
    --seg-pill-thumb: #ffffff;
    --color-overlay: rgba(0, 8, 48, 0.275);
    --color-shadow: rgba(0, 0, 0, 0.08);
    --shadow-sm: var(--color-shadow);
    --shadow-md: 0 4px 16px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.08);
    --shadow-lg: 0 8px 24px var(--gray-a4);
    --shadow-focus: 0px 0px 0px 0px var(--color-shadow), 0px 8px 32px 0px var(--color-shadow);
    --text-primary: var(--gray-12);
    --text-secondary: var(--gray-11);

    /* Accent Scale (Blue) */
    --accent-1: var(--blue-1); --accent-2: var(--blue-2); --accent-3: var(--blue-3);
    --accent-4: var(--blue-4); --accent-5: var(--blue-5); --accent-6: var(--blue-6);
    --accent-7: var(--blue-7); --accent-8: var(--blue-8); --accent-9: var(--blue-9);
    --accent-10: var(--blue-10); --accent-11: var(--blue-11); --accent-12: var(--blue-12);
    --accent-a1: var(--blue-a1); --accent-a2: var(--blue-a2); --accent-a3: var(--blue-a3);
    --accent-a4: var(--blue-a4); --accent-a5: var(--blue-a5); --accent-a6: var(--blue-a6);
    --accent-a7: var(--blue-a7); --accent-a8: var(--blue-a8); --accent-a9: var(--blue-a9);
    --accent-a10: var(--blue-a10); --accent-a11: var(--blue-a11); --accent-a12: var(--blue-a12);
    --accent-surface: var(--blue-a2);
    --accent-contrast: #ffffff;

    /* --- Component Constants --- */
    --header-height: 52px;
    --toggle-width: 44px;
    --toggle-height: 24px;
    --toggle-thumb-size: 20px;
    --header-icon-size: 32px;
    --border-default: 1px solid var(--gray-6);
    --border-subtle: 0.5px solid var(--gray-a4);

    --header-bg: var(--color-surface);
    --header-border: var(--gray-a4);

    --panel-default: rgba(255, 255, 255, 0.8);
    --panel-solid: rgba(255, 255, 255, 1);
    --panel-translucent: rgba(255, 255, 255, 0.8);

    /* Figma component/instance purple — used by ContextTag component variant */
    --component-fg: #7c3aed;
    --component-bg: rgba(151, 71, 255, 0.08);
    --component-border: rgba(151, 71, 255, 0.22);
    --component-hover: rgba(151, 71, 255, 0.40);

    /* Radius */
    --radius-1: 3px; --radius-1-max: 3px;
    --radius-2: 4px; --radius-2-max: 4px;
    --radius-3: 6px; --radius-3-max: 6px;
    --radius-4: 8px; --radius-4-max: 8px;
    --radius-5: 12px; --radius-5-max: 12px;
    --radius-6: 16px; --radius-6-max: 16px;
    --radius-full: 9999px;

    /* Spacing */
    --space-1: 4px; --space-2: 8px; --space-3: 12px;
    --space-4: 16px; --space-5: 24px; --space-6: 32px;
    --space-7: 40px; --space-8: 48px; --space-9: 64px;

    /* Typography */
    --typography-font-family-code: 'Inter Mono', 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
    --typography-font-family-emphasis: 'Georgia', 'Times New Roman', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
    --typography-font-family-quote: 'Georgia', 'Garamond', serif;
    --typography-font-family-text: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    --typography-font-size-1: 12px;
    --typography-font-size-2: 14px;
    --typography-font-size-3: 16px;
    --typography-font-size-4: 18px;
    --typography-font-size-5: 20px;
    --typography-font-size-6: 24px;
    --typography-font-size-7: 28px;
    --typography-font-size-8: 35px;
    --typography-font-size-9: 60px;
    --typography-font-weight-bold: Bold;
    --typography-font-weight-light: Light;
    --typography-font-weight-medium: Medium;
    --typography-font-weight-regular: Regular;
    --typography-letter-spacing-1: 0.03999999910593033;
    --typography-letter-spacing-2: 0;
    --typography-letter-spacing-3: 0;
    --typography-letter-spacing-4: -0.03999999910593033;
    --typography-letter-spacing-5: -0.07999999821186066;
    --typography-letter-spacing-6: -0.10000000149011612;
    --typography-letter-spacing-7: -0.11999999731779099;
    --typography-letter-spacing-8: -0.1599999964237213;
    --typography-letter-spacing-9: -0.4000000059604645;
    --typography-line-height-1: 16px;
    --typography-line-height-2: 20px;
    --typography-line-height-3: 24px;
    --typography-line-height-4: 26px;
    --typography-line-height-5: 28px;
    --typography-line-height-6: 30px;
    --typography-line-height-7: 36px;
    --typography-line-height-8: 40px;
    --typography-line-height-9: 60px;

    /* Short-form font-size aliases (used by components) */
    --font-size-1: 12px; --font-size-2: 14px; --font-size-3: 16px; --font-size-4: 18px;
    --font-size-5: 20px; --font-size-6: 24px; --font-size-7: 28px; --font-size-8: 35px; --font-size-9: 60px;

    /* Animation Easing */
    --ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-exit: cubic-bezier(0.4, 0, 1, 1);
    --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

    --corner-shape: squircle;
    --transition-crisp: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-normal: all 200ms ease;
    --transition-slow: all 300ms ease;
  }
`; // End lightModeTokens

const darkModeTokens = `
    /* Gray (Neutral) - Dark Mode Overrides */
    --gray-1: #111111; --gray-2: #191919; --gray-3: #222222; --gray-4: #2a2a2a;
    --gray-5: #313131; --gray-6: #3a3a3a; --gray-7: #484848; --gray-8: #606060;
    --gray-9: #6e6e6e; --gray-10: #7b7b7b; --gray-11: #b4b4b4; --gray-12: #eeeeee;

    /* Gray Alpha - Dark Mode */
    --gray-a1: rgba(255, 255, 255, 0.010); --gray-a2: rgba(255, 255, 255, 0.024); --gray-a3: rgba(255, 255, 255, 0.057);
    --gray-a4: rgba(255, 255, 255, 0.074); --gray-a5: rgba(255, 255, 255, 0.103); --gray-a6: rgba(255, 255, 255, 0.133);
    --gray-a7: rgba(255, 255, 255, 0.176); --gray-a8: rgba(255, 255, 255, 0.255); --gray-a9: rgba(255, 255, 255, 0.420);
    --gray-a10: rgba(255, 255, 255, 0.475); --gray-a11: rgba(255, 255, 255, 0.565); --gray-a12: rgba(255, 255, 255, 0.910);

    /* Green (Success) - Dark Mode */
    --green-1: #0e1f17; --green-2: #12281d; --green-3: #163625; --green-4: #19442c;
    --green-5: #1d5234; --green-6: #23633e; --green-7: #2a7949; --green-8: #329257;
    --green-9: #30a46c; --green-10: #36b576; --green-11: #4cc38a; --green-12: #e5fbe9;

    /* Crimson (Error) - Dark Mode */
    --crimson-1: #1f1315; --crimson-2: #29141a; --crimson-3: #3c1925; --crimson-4: #4d1c2d;
    --crimson-5: #5d2236; --crimson-6: #702a41; --crimson-7: #8a3551; --crimson-8: #b44065;
    --crimson-9: #e93d82; --crimson-10: #ee5b94; --crimson-11: #f47ea9; --crimson-12: #fee7ef;

    /* Amber (Warning) - Dark Mode */
    --amber-1: #16120c; --amber-2: #1d1810; --amber-3: #2d2416; --amber-4: #3c2f1a;
    --amber-5: #4b3b1f; --amber-6: #5b4823; --amber-7: #6e5829; --amber-8: #876d31;
    --amber-9: #ffc53d; --amber-10: #ffd60a; --amber-11: #ffca16; --amber-12: #ffe7b3;

    /* Blue (Accent) - Dark Mode */
    --blue-1: #0f1720; --blue-2: #101b26; --blue-3: #11253a; --blue-4: #13304e;
    --blue-5: #153b61; --blue-6: #184a7d; --blue-7: #1c5d9e; --blue-8: #2176c7;
    --blue-9: #0090ff; --blue-10: #52a9ff; --blue-11: #8bc8ff; --blue-12: #eaf6ff;

    /* Semantic Re-map */
    --color-background: var(--gray-1);
    --color-surface: var(--gray-2);
    --color-panel: var(--gray-2);

    /* Segmented control — track must contrast against surface (gray-2),
       thumb must contrast against track. */
    --seg-pill-track: var(--gray-3);
    --seg-pill-thumb: var(--gray-5);
    --color-overlay: rgba(0, 0, 0, 0.7);
    --color-shadow: rgba(0, 0, 0, 0.5);
    --text-primary: var(--gray-12);
    --text-secondary: var(--gray-11);

    /* Accent Scale (Blue) - Dark Mode */
    --accent-1: var(--blue-1); --accent-2: var(--blue-2); --accent-3: var(--blue-3);
    --accent-4: var(--blue-4); --accent-5: var(--blue-5); --accent-6: var(--blue-6);
    --accent-7: var(--blue-7); --accent-8: var(--blue-8); --accent-9: var(--blue-9);
    --accent-10: var(--blue-10); --accent-11: var(--blue-11); --accent-12: var(--blue-12);
    --accent-a1: var(--blue-a1); --accent-a2: var(--blue-a2); --accent-a3: var(--blue-a3);
    --accent-a4: var(--blue-a4); --accent-a5: var(--blue-a5); --accent-a6: var(--blue-a6);
    --accent-a7: var(--blue-a7); --accent-a8: var(--blue-a8); --accent-a9: var(--blue-a9);
    --accent-a10: var(--blue-a10); --accent-a11: var(--blue-a11); --accent-a12: var(--blue-a12);
    --accent-surface: rgba(0, 144, 255, 0.15);
    --accent-contrast: #ffffff;

    --panel-default: rgba(30, 30, 30, 0.8);
    --panel-solid: var(--gray-2);
    --panel-translucent: rgba(25, 25, 25, 0.8);

    /* Figma component/instance purple — slightly brighter in dark mode */
    --component-fg: #a78bfa;
    --component-bg: rgba(151, 71, 255, 0.14);
    --component-border: rgba(151, 71, 255, 0.30);
    --component-hover: rgba(151, 71, 255, 0.55);
`;

export const cssTokens = lightModeTokens + `
  /* Force light mode when explicitly set */
  [data-theme="light"] {
    color-scheme: light;
  }

  /* Dark Mode Configuration - Only applies when NOT explicitly light */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      ${darkModeTokens}
    }
  }

  /* Attribute-based themes (Fallback/Force) */
  [data-theme="dark"] {
    color-scheme: dark;
    ${darkModeTokens}
  }
`;
