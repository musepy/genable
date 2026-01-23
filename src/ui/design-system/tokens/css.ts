/**
 * @file css.ts
 * @description Global CSS custom properties (variables) definition
 */

export const cssTokens = `
  :root {
    /* Radix Gray Scale - Light Mode */
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
    --gray-12: #202020;

    /* P3: Radix Gray Alpha Scale - Light Mode (transparent overlays) */
    --gray-a1: rgba(0, 0, 0, 0.01);
    --gray-a2: rgba(0, 0, 0, 0.024);
    --gray-a3: rgba(0, 0, 0, 0.055);
    --gray-a4: rgba(0, 0, 0, 0.078);
    --gray-a5: rgba(0, 0, 0, 0.106);
    --gray-a6: rgba(0, 0, 0, 0.133);
    --gray-a7: rgba(0, 0, 0, 0.176);
    --gray-a8: rgba(0, 0, 0, 0.255);
    --gray-a9: rgba(0, 0, 0, 0.420);
    --gray-a10: rgba(0, 0, 0, 0.475);
    --gray-a11: rgba(0, 0, 0, 0.565);
    --gray-a12: rgba(0, 0, 0, 0.910);

    /* Radix Blue Scale - Light Mode */
    --blue-1: #fdfdfe;
    --blue-2: #f8faff;
    --blue-3: #f0f4ff;
    --blue-4: #e6edfe;
    --blue-5: #dbe6fe;
    --blue-6: #cce0ff;
    --blue-7: #b3d1ff;
    --blue-8: #84b7ff;
    --blue-9: #0091ff;
    --blue-10: #0081f1;
    --blue-11: #006adc;
    --blue-12: #002577;

    /* Radix Green Scale - Light Mode */
    --green-1: #fbfdfc;
    --green-2: #f2fcf5;
    --green-3: #e9f9ee;
    --green-4: #ddf3e4;
    --green-5: #ccebd7;
    --green-6: #b4dfc4;
    --green-7: #92ceac;
    --green-8: #5bb98c;
    --green-9: #30a46c;
    --green-10: #299764;
    --green-11: #18794e;
    --green-12: #153226;

    /* Radix Amber Scale - Light Mode */
    --amber-1: #fefdfb;
    --amber-2: #fff9ed;
    --amber-3: #fff4d5;
    --amber-4: #ffecbc;
    --amber-5: #ffe3a2;
    --amber-6: #ffd386;
    --amber-7: #f3ba63;
    --amber-8: #ee9d2b;
    --amber-9: #ffb224;
    --amber-10: #ffa01c;
    --amber-11: #ad5700;
    --amber-12: #4e2009;

    /* Radix Red Scale - Light Mode */
    --red-1: #fffcfc;
    --red-2: #fff8f8;
    --red-3: #ffefef;
    --red-4: #ffe5e5;
    --red-5: #fdd8d8;
    --red-6: #f9c6c6;
    --red-7: #f3aeaf;
    --red-8: #eb9091;
    --red-9: #e5484d;
    --red-1: #dc3d43;
    --red-11: #cd2b31;
    --red-12: #381010;
    
    /* Semantic mappings - Base (defaults to Light) */
    --background: var(--gray-1);
    --foreground: var(--gray-12);
    --card: #ffffff;
    --card-foreground: var(--gray-12);
    --card-shadow: 0 2px 3px 2px rgba(0,0,0,0.02);
    --muted: var(--gray-3);
    --muted-foreground: var(--gray-11);
    --border: var(--gray-6);
    --border-subtle: var(--gray-4);
    --border-strong: var(--gray-8);
    --solid: var(--gray-12);
    --solid-foreground: var(--gray-1);
    
    --primary: var(--blue-9);
    --primary-foreground: #ffffff;
    --primary-muted: var(--blue-3);
    --primary-border: var(--blue-6);
    
    --secondary: var(--gray-3);
    --secondary-foreground: var(--gray-12);
    
    --success: var(--green-9);
    --success-muted: var(--green-3);
    --success-border: var(--green-6);
    
    --warning: var(--amber-9);
    --warning-muted: var(--amber-3);
    --warning-border: var(--amber-6);
    
    --destructive: var(--red-9);
    --destructive-muted: var(--red-3);
    --destructive-border: var(--red-6);

    --accent: var(--blue-9);
    --ring: var(--gray-8);
    
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    --radius-2xl: 24px;
    --radius-full: 9999px;
    
    /* Radix Space Scale (1-9) */
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;
    --space-7: 40px;
    --space-8: 48px;
    --space-9: 64px;
    
    /* Radix Radius Scale (1-6) */
    --radius-1: 3px;
    --radius-2: 4px;
    --radius-3: 6px;
    --radius-4: 8px;
    --radius-5: 12px;
    --radius-6: 16px;
    
    /* Radix Font Size Scale (1-9) */
    --font-size-1: 12px;
    --font-size-2: 14px;
    --font-size-3: 16px;
    --font-size-4: 18px;
    --font-size-5: 20px;
    --font-size-6: 24px;
    --font-size-7: 28px;
    --font-size-8: 35px;
    --font-size-9: 60px;
    
    /* iOS Continuous Corners (Squircle) */
    --corner-shape: squircle;
    
    /* Transition tokens (Motion system) */
    --transition-instant: 0ms;
    --transition-crisp: 150ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-smooth: 300ms cubic-bezier(0.4, 0, 0.2, 1);
    
    /* Duration tokens (分级) */
    --duration-fast: 100ms;
    --duration-normal: 150ms;
    --duration-slow: 250ms;
    
    /* Easing tokens (语义化) */
    --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-enter: cubic-bezier(0.0, 0, 0.2, 1);
    --ease-exit: cubic-bezier(0.4, 0, 1, 1);
    --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
    
    /* Font family */
    --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  /* Page color transition for smooth theme switching */
  *, *::before, *::after {
    transition: background-color 150ms ease-out, 
                border-color 150ms ease-out,
                box-shadow 150ms ease-out;
  }

  /* Theme: Dark (Prefers or Attribute) */
  @media (prefers-color-scheme: dark) {
    :root {
      /* Radix Gray Scale - Dark Mode */
      --gray-1: #111111;
      --gray-2: #191919;
      --gray-3: #222222;
      --gray-4: #2a2a2a;
      --gray-5: #313131;
      --gray-6: #3a3a3a;
      --gray-7: #484848;
      --gray-8: #606060;
      --gray-9: #6e6e6e;
      --gray-10: #7b7b7b;
      --gray-11: #b4b4b4;
      --gray-12: #eeeeee;

      /* Radix Blue Scale - Dark Mode */
      --blue-1: #0d1520;
      --blue-2: #111927;
      --blue-3: #132745;
      --blue-4: #172b54;
      --blue-5: #1c3d7a;
      --blue-6: #1e4d9c;
      --blue-7: #265ebf;
      --blue-8: #357dec;
      --blue-9: #0091ff;
      --blue-10: #199cff;
      --blue-11: #70b8ff;
      --blue-12: #c2e0ff;

      /* Radix Green Scale - Dark Mode */
      --green-1: #0c0f0d;
      --green-2: #111412;
      --green-3: #13211b;
      --green-4: #152d24;
      --green-5: #183d2e;
      --green-6: #1d4f3b;
      --green-7: #24684d;
      --green-8: #2f8e67;
      --green-9: #30a46c;
      --green-10: #37b67a;
      --green-11: #3dd68c;
      --green-12: #b1f1cb;

      /* Radix Amber Scale - Dark Mode */
      --amber-1: #110e0a;
      --amber-2: #17120d;
      --amber-3: #261a0f;
      --amber-4: #332213;
      --amber-5: #472f1a;
      --amber-6: #5e4024;
      --amber-7: #855b33;
      --amber-8: #b37e46;
      --amber-9: #ffb224;
      --amber-10: #ffc241;
      --amber-11: #ffcc5d;
      --amber-12: #ffebbc;

      /* Radix Red Scale - Dark Mode */
      --red-1: #110c0d;
      --red-2: #151111;
      --red-3: #221517;
      --red-4: #2d191c;
      --red-5: #3c1e23;
      --red-6: #4f232a;
      --red-7: #6e2d37;
      --red-8: #a13d49;
      --red-9: #e5484d;
      --red-10: #f2555a;
      --red-11: #ff6369;
      --red-12: #ffd1d4;
      
      /* Semantic mappings - Dark Mode */
      --background: var(--gray-1);
      --foreground: var(--gray-12);
      --card: var(--gray-2);
      --card-foreground: var(--gray-12);
      --card-shadow: 0 2px 3px 2px rgba(0,0,0,0.2);
      --muted: var(--gray-3);
      --muted-foreground: var(--gray-11);
      --border: var(--gray-6);
      --border-subtle: var(--gray-4);
      --border-strong: var(--gray-8);
      --solid: var(--gray-12);
      --solid-foreground: var(--gray-1);
      
      --primary: var(--blue-9);
      --primary-foreground: var(--gray-1);
      --primary-muted: var(--blue-3);
      --primary-border: var(--blue-6);
      
      --secondary: var(--gray-3);
      --secondary-foreground: var(--gray-12);
      
      --success: var(--green-9);
      --success-muted: var(--green-3);
      --success-border: var(--green-6);
      
      --warning: var(--amber-9);
      --warning-muted: var(--amber-3);
      --warning-border: var(--amber-6);
      
      --destructive: var(--red-9);
      --destructive-muted: var(--red-3);
      --destructive-border: var(--red-6);

      --ring: var(--gray-8);
    }
  }

  /* Manual theme override via data-theme attribute - Ensure full symmetry */
  :root[data-theme="light"] {
    /* Gray */
    --gray-1: #fcfcfc; --gray-2: #f9f9f9; --gray-3: #f0f0f0; --gray-4: #e8e8e8;
    --gray-5: #e0e0e0; --gray-6: #d9d9d9; --gray-7: #cecece; --gray-8: #bbbbbb;
    --gray-9: #8d8d8d; --gray-10: #838383; --gray-11: #646464; --gray-12: #202020;
    /* Blue */
    --blue-1: #fdfdfe; --blue-2: #f8faff; --blue-3: #f0f4ff; --blue-4: #e6edfe;
    --blue-5: #dbe6fe; --blue-6: #cce0ff; --blue-7: #b3d1ff; --blue-8: #84b7ff;
    --blue-9: #0091ff; --blue-10: #0081f1; --blue-11: #006adc; --blue-12: #002577;
    /* Green */
    --green-1: #fbfdfc; --green-2: #f2fcf5; --green-3: #e9f9ee; --green-4: #ddf3e4;
    --green-5: #ccebd7; --green-6: #b4dfc4; --green-7: #92ceac; --green-8: #5bb98c;
    --green-9: #30a46c; --green-10: #299764; --green-11: #18794e; --green-12: #153226;
    /* Amber */
    --amber-1: #fefdfb; --amber-2: #fff9ed; --amber-3: #fff4d5; --amber-4: #ffecbc;
    --amber-5: #ffe3a2; --amber-6: #ffd386; --amber-7: #f3ba63; --amber-8: #ee9d2b;
    --amber-9: #ffb224; --amber-10: #ffa01c; --amber-11: #ad5700; --amber-12: #4e2009;
    /* Red */
    --red-1: #fffcfc; --red-2: #fff8f8; --red-3: #ffefef; --red-4: #ffe5e5;
    --red-5: #fdd8d8; --red-6: #f9c6c6; --red-7: #f3aeaf; --red-8: #eb9091;
    --red-9: #e5484d; --red-10: #dc3d43; --red-11: #cd2b31; --red-12: #381010;

    --background: var(--gray-1);
    --foreground: var(--gray-12);
    --card: #ffffff;
    --card-foreground: var(--gray-12);
    --card-shadow: 0 2px 3px 2px rgba(0,0,0,0.02);
    --muted: var(--gray-3);
    --muted-foreground: var(--gray-11);
    --border: var(--gray-6);
    --border-subtle: var(--gray-4);
    --border-strong: var(--gray-8);
    --solid: var(--gray-12);
    --solid-foreground: var(--gray-1);
    
    --primary: var(--blue-9);
    --primary-foreground: #ffffff;
    --primary-muted: var(--blue-3);
    --primary-border: var(--blue-6);
    
    --secondary: var(--gray-3);
    --secondary-foreground: var(--gray-12);
    
    --success: var(--green-9);
    --success-muted: var(--green-3);
    --success-border: var(--green-6);
    
    --warning: var(--amber-9);
    --warning-muted: var(--amber-3);
    --warning-border: var(--amber-6);
    
    --destructive: var(--red-9);
    --destructive-muted: var(--red-3);
    --destructive-border: var(--red-6);

    --ring: var(--gray-8);
  }

  :root[data-theme="dark"] {
    /* Gray */
    --gray-1: #111111; --gray-2: #191919; --gray-3: #222222; --gray-4: #2a2a2a;
    --gray-5: #313131; --gray-6: #3a3a3a; --gray-7: #484848; --gray-8: #606060;
    --gray-9: #6e6e6e; --gray-10: #7b7b7b; --gray-11: #b4b4b4; --gray-12: #eeeeee;
    /* Blue */
    --blue-1: #0d1520; --blue-2: #111927; --blue-3: #132745; --blue-4: #172b54;
    --blue-5: #1c3d7a; --blue-6: #1e4d9c; --blue-7: #265ebf; --blue-8: #357dec;
    --blue-9: #0091ff; --blue-10: #199cff; --blue-11: #70b8ff; --blue-12: #c2e0ff;
    /* Green */
    --green-1: #0c0f0d; --green-2: #111412; --green-3: #13211b; --green-4: #152d24;
    --green-5: #183d2e; --green-6: #1d4f3b; --green-7: #24684d; --green-8: #2f8e67;
    --green-9: #30a46c; --green-10: #37b67a; --green-11: #3dd68c; --green-12: #b1f1cb;
    /* Amber */
    --amber-1: #110e0a; --amber-2: #17120d; --amber-3: #261a0f; --amber-4: #332213;
    --amber-5: #472f1a; --amber-6: #5e4024; --amber-7: #855b33; --amber-8: #b37e46;
    --amber-9: #ffb224; --amber-10: #ffc241; --amber-11: #ffcc5d; --amber-12: #ffebbc;
    /* Red */
    --red-1: #110c0d; --red-2: #151111; --red-3: #221517; --red-4: #2d191c;
    --red-5: #3c1e23; --red-6: #4f232a; --red-7: #6e2d37; --red-8: #a13d49;
    --red-9: #e5484d; --red-10: #f2555a; --red-11: #ff6369; --red-12: #ffd1d4;

    /* P3: Radix Gray Alpha Scale - Dark Mode (white-based transparent overlays) */
    --gray-a1: rgba(255, 255, 255, 0.01);
    --gray-a2: rgba(255, 255, 255, 0.034);
    --gray-a3: rgba(255, 255, 255, 0.071);
    --gray-a4: rgba(255, 255, 255, 0.105);
    --gray-a5: rgba(255, 255, 255, 0.134);
    --gray-a6: rgba(255, 255, 255, 0.172);
    --gray-a7: rgba(255, 255, 255, 0.231);
    --gray-a8: rgba(255, 255, 255, 0.330);
    --gray-a9: rgba(255, 255, 255, 0.395);
    --gray-a10: rgba(255, 255, 255, 0.450);
    --gray-a11: rgba(255, 255, 255, 0.685);
    --gray-a12: rgba(255, 255, 255, 0.925);

    --background: var(--gray-1);
    --foreground: var(--gray-12);
    --card: var(--gray-2);
    --card-foreground: var(--gray-12);
    --card-shadow: 0 2px 3px 2px rgba(0,0,0,0.2);
    --muted: var(--gray-3);
    --muted-foreground: var(--gray-11);
    --border: var(--gray-6);
    --border-subtle: var(--gray-4);
    --border-strong: var(--gray-8);
    --solid: var(--gray-12);
    --solid-foreground: var(--gray-1);
    
    --primary: var(--blue-9);
    --primary-foreground: var(--gray-1);
    --primary-muted: var(--blue-3);
    --primary-border: var(--blue-6);
    
    --secondary: var(--gray-3);
    --secondary-foreground: var(--gray-12);
    
    --success: var(--green-9);
    --success-muted: var(--green-3);
    --success-border: var(--green-6);
    
    --warning: var(--amber-9);
    --warning-muted: var(--amber-3);
    --warning-border: var(--amber-6);
    
    --destructive: var(--red-9);
    --destructive-muted: var(--red-3);
    --destructive-border: var(--red-6);

    --ring: var(--gray-8);
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Exit animations - 物理一致性：入场的反向 */
  @keyframes fadeOutDown {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(8px); }
  }

  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  /* Popover animation - 快、精准、清爽 */
  @keyframes popoverIn {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .popover-content {
    animation: popoverIn 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .popover-content-exit {
    animation: popoverOut 100ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  @keyframes popoverOut {
    from { opacity: 1; transform: scale(1); }
    to { opacity: 0; transform: scale(0.96); }
  }

  /* Selection tag hover */
  .selection-tag {
    transition: var(--transition-crisp);
  }
  .selection-tag:hover {
    filter: brightness(0.95);
    border-color: currentColor;
  }

  .popover-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .popover-item {
    transition: background 100ms ease;
  }

  .popover-item:hover {
    background: var(--muted);
  }

  .message-bubble {
    animation: fadeInUp 0.25s ease-out;
  }

  /* P2: Message Entry Animation - for new messages */
  .message-enter {
    animation: fadeInUp 0.4s var(--ease-spring);
  }

  /* Ghost Button - subtle, stable, no layout shift */
  .ghost-btn {
    background: transparent;
    transition: var(--transition-crisp);
  }

  .ghost-btn:hover {
    opacity: 0.6;
  }

  .ghost-btn:active {
    opacity: 0.4;
  }

  /* Icon Button - 28x28 统一尺寸按钮 (P1) */
  .icon-btn {
    transition: var(--transition-crisp);
  }
  .icon-btn:hover { opacity: 0.6; }
  .icon-btn:active { opacity: 0.4; }
  .icon-btn.disabled { opacity: 0.4; pointer-events: none; cursor: default; }
  .icon-btn.hidden { opacity: 0; pointer-events: none; }

  @keyframes dotPulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  .loading-dots {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }

  .loading-dots span {
    width: 6px;
    height: 6px;
    background: var(--muted-foreground);
    border-radius: 50%;
    animation: dotPulse 1.4s infinite ease-in-out;
  }

  .loading-dots span:nth-child(1) { animation-delay: 0s; }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

  /* Interactive States - subtle, no vertical movement */
  .interactive {
    transition: all 150ms ease;
  }

  .interactive:hover {
    opacity: 0.85;
  }

  .interactive:active {
    opacity: 0.7;
  }

  /* Focus Ring - 移除默认 outline，容器边框作为视觉指示 */
  .focusable:focus {
    outline: none;
  }

  /* Card Hover */
  .card-interactive:hover {
    border-color: var(--border-strong);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }

  /* Submit Button Active - solid style, spatially stable hover */
  .submit-btn-active {
    transition: box-shadow 150ms ease, filter 150ms ease !important;
  }
  .submit-btn-active:hover {
    box-shadow: 0 4px 12px var(--gray-a5) !important;
    filter: brightness(1.1) !important;
  }
  .submit-btn-active:active {
    filter: brightness(0.95) !important;
  }

  /* Submit Button Disabled - visible but dimmed */
  .submit-btn-disabled {
    transition: border-color 150ms ease !important;
  }
  .submit-btn-disabled:hover {
    border-color: var(--border-strong) !important;
  }

  /* Chip Hover */
  .chip:hover {
    background: var(--secondary);
    border-color: var(--border-strong);
  }

  .chip.active {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
  }

  /* Toggle Track States - subtle hover feedback */
  .toggle-track {
    transition: all 150ms ease;
  }
  .toggle-track:hover {
    border-color: var(--border-strong) !important;
  }
  .toggle-track:hover .toggle-thumb {
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }

  /* Hide scrollbar for horizontal scroll containers */
  .scroll-hide-scrollbar::-webkit-scrollbar {
    display: none;
  }

  /* Marquee animation for prompt chips */
  @keyframes marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  @keyframes marquee-reverse {
    0% { transform: translateX(-50%); }
    100% { transform: translateX(0); }
  }

  .marquee-row {
    display: flex;
    gap: 8px;
    animation: marquee 20s linear infinite;
    width: max-content;
  }

  .marquee-row-reverse {
    display: flex;
    gap: 8px;
    animation: marquee-reverse 25s linear infinite;
    width: max-content;
  }

  .marquee-container {
    overflow: hidden;
    width: 100%;
  }

  .marquee-container:hover .marquee-row,
  .marquee-container:hover .marquee-row-reverse {
    animation-play-state: paused;
  }

  /* Accessibility: Reduce motion support */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }

  /* iOS Continuous Corners (Squircle) */
  /* Applied globally to all rounded elements in Figma plugin */
  .card, .popover-content, .chip, .message-bubble {
    corner-shape: var(--corner-shape);
  }
  
  /* Utility class for iOS corners */
  .ios-radius {
    corner-shape: squircle;
  }

  /* Error Banner Component */
  .error-banner {
    background: var(--destructive-muted);
    border: 1px solid var(--destructive-border);
    border-radius: var(--radius-4);
    padding: var(--space-3) var(--space-4);
    margin: 0 var(--space-3) var(--space-3);
    animation: fadeInUp 150ms var(--ease-enter);
  }

  .error-banner-exit {
    animation: fadeOutDown 100ms var(--ease-exit) forwards;
  }

  .error-banner-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }

  .error-banner-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-2);
    font-weight: 500;
    color: var(--foreground);
  }

  .error-banner-icon {
    color: var(--destructive);
    flex-shrink: 0;
  }

  .error-banner-hint {
    font-size: var(--font-size-1);
    color: var(--muted-foreground);
    margin: 0 0 var(--space-3);
    line-height: 1.4;
  }

  .error-banner-actions {
    display: flex;
    gap: var(--space-2);
  }
`;
