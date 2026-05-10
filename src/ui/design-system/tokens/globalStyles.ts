/**
 * @file globals.css.ts
 * @description Global CSS styles and component classes
 *
 * CONVENTION: CSS classes are ONLY for things inline styles can't do:
 *   - Pseudo-states (:hover, :active, :focus)
 *   - Pseudo-elements (::after for skeleton shimmer)
 *   - Animations (@keyframes)
 *   - State variants (.is-closing, .disabled, .is-selected)
 *
 * Everything else → inline style with `tokens` object.
 */

export const globalStyles = `
  /* --- Global Styles --- */
  * { box-sizing: border-box; }
  :root {
    --border-main: var(--border-subtle);
  }

  html, body, #create-figma-plugin {
    height: 100%;
    margin: 0;
    overflow: hidden;
  }

  body { 
    margin: 0; 
    font-family: var(--font-sans, Inter, system-ui, sans-serif); 
    background-color: var(--color-background);
    color: var(--gray-12);
    font-size: 14px; /* Default unified size */
  }

  ::placeholder {
    color: var(--gray-a9); /* Subtle contrast */
    opacity: 1; /* Ensure consistency across browsers */
  }

  /* --- Component Standard Classes --- */

  /* --- Component Styles --- */
  .header-container {
    display: flex;
    align-items: center;
    position: relative;
    height: var(--header-height);
    background: transparent; /* Consistently match body */
    padding: 0 var(--space-3);
    box-sizing: border-box;
  }

  .header-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 10px; /* 10px padding aligns text to 22px when container pad is 12px */
    height: 32px;
    background: transparent;
    color: var(--gray-11);
    border: var(--border-subtle);
    border-radius: var(--radius-5); /* Standardized to 12px */
    font-size: var(--typography-font-size-1); /* Unified from 13px */
    font-weight: var(--font-weight-regular);
    line-height: var(--typography-line-height-1);
    cursor: pointer;
    transition: background 150ms ease, border-color 150ms ease;
  }
  .header-chip:hover:not(.disabled) {
    background: var(--gray-a2);
    border-color: var(--gray-a5);
  }
  .header-chip:active:not(.disabled) {
    background: var(--gray-a4);
  }
  .header-chip.disabled {
    opacity: 0.5;
    cursor: default;
  }

  .header-icon-btn {
    width: var(--header-icon-size);
    height: var(--header-icon-size);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-secondary);
    border: none;
    border-radius: var(--radius-5);
    cursor: pointer;
    transition: var(--transition-crisp);
  }
  .header-icon-btn:hover {
    background: var(--gray-a2);
    color: var(--text-primary);
  }
  .header-icon-btn:active {
    background: var(--gray-a4);
  }
  .header-icon-btn.is-active {
    background: var(--gray-a2);
    color: var(--text-primary);
  }

  .chip {
    background: transparent;
    color: var(--gray-11);
    border: var(--border-subtle);
    transition: background 150ms ease, border-color 150ms ease;
  }
  .chip:hover {
    background: var(--gray-a2);
    border-color: var(--gray-a5);
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    background: transparent;
    color: var(--gray-11);
    border: none;
    border-radius: var(--radius-5);
    font-size: var(--typography-font-size-1);
    font-weight: var(--font-weight-regular);
    line-height: var(--typography-line-height-1);
    cursor: pointer;
    transition: var(--transition-crisp);
    white-space: nowrap;
  }
  .ghost-btn:hover:not(:disabled) {
    background: var(--gray-a2);
    color: var(--text-primary);
  }
  .ghost-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .card-interactive {
    transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
  }
  .card-interactive:hover {
    background: var(--gray-a2);
    border-color: var(--gray-a5);
  }
  .card-interactive:active {
    background: var(--gray-a3);
  }

  .model-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
    padding: var(--space-1) 10px;
    border-radius: var(--radius-4);
    cursor: pointer;
    background: transparent;
    transition: var(--transition-crisp);
    gap: var(--space-2);
    color: var(--gray-11);
  }
  .model-item:hover {
    background: var(--gray-a2);
  }
  .model-item.is-selected {
    color: var(--text-primary);
  }

  .focusable {
    outline: none;
  }
  .focusable-input {
    box-shadow: inset 0 0 0 0.5px var(--gray-a4);
    transition: box-shadow 150ms ease, background 150ms ease;
  }
  .focusable-input:focus,
  .focusable-input:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent-a8), 0 0 0 3px var(--accent-a2);
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: var(--transition-crisp);
    flex-shrink: 0;
  }

  .submit-btn-active {
    background: var(--gray-12);
    /* color-background flips with theme: ≈white in light, ≈black in dark.
       Was literal 'white' which read as white-on-white in dark mode (gray-12
       is near-white in dark). */
    color: var(--color-background);
    border: none;
    cursor: pointer;
  }
  .submit-btn-active:hover {
    filter: brightness(1.1);
  }
  /* Untyped: ghost (transparent + opaque faint icon). Hover shows button shape, icon color unchanged → still feels disabled.
     Icon color must be OPAQUE (gray-9) not alpha — alpha causes lucide vector overlap visible at stroke joints. */
  .submit-btn-disabled {
    background: transparent;
    color: var(--gray-9);
    border: none;
    cursor: not-allowed;
  }
  .submit-btn-disabled:hover {
    background: var(--gray-a4);
  }

  /* Inline text action — StatusBlock Continue/Stop/Interrupt */
  .text-action {
    display: inline-flex;
    align-items: center;
    padding: 2px var(--space-2);
    border-radius: var(--radius-3);
    font-size: var(--typography-font-size-1);
    font-weight: var(--font-weight-regular);
    cursor: pointer;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    transition: var(--transition-crisp);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .text-action:hover {
    background: var(--gray-a2);
  }
  .text-action.danger {
    color: var(--error-11);
  }
  .text-action.danger:hover {
    background: var(--error-3);
  }

  /* Settings provider tab */
  .tab-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1) 0;
    background: transparent;
    border: none;
    font-size: var(--typography-font-size-1);
    font-weight: var(--font-weight-regular);
    cursor: pointer;
    color: var(--gray-9);
    transition: var(--transition-crisp);
    position: relative;
  }
  .tab-btn.active {
    color: var(--gray-12);
  }

  /* --- Masking & Fading --- */
  .messages-mask {
    /* mask removed: it fades out bottom content and blocks text selection */
  }

  .popover-content {
    background: var(--color-surface);
    border-radius: var(--radius-6); /* Outer radius 16px to support nested 12px + 4px margin */
    border: var(--border-subtle);
    box-shadow: var(--shadow-md);
    zIndex: 100;
    overflow: hidden;
    opacity: 1;
    transform: translateY(0);
    transition: opacity 150ms var(--ease-in-out), transform 150ms var(--ease-in-out);
  }

  .popover-content-exit {
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 150ms var(--ease-in-out), transform 150ms var(--ease-in-out);
  }

  .popover-item {
    display: flex;
    align-items: center;
    padding: 0 var(--space-2);
    height: 36px;
    border-radius: var(--radius-5); /* Inner radius 12px (Unified) */
    cursor: pointer;
    color: var(--gray-11);
    font-size: 12px;
    font-weight: var(--font-weight-regular);
    line-height: var(--typography-line-height-1);
    transition: var(--transition-crisp);
    gap: var(--space-2);
  }

  .popover-item.is-selected {
    background: transparent;
    color: var(--text-primary);
  }

  .popover-item:hover {
    background: var(--gray-a2); /* Sync with + button and Header */
  }

  .popover-item-multi {
    width: 100%;
    height: auto;
    min-height: 34px;
    justify-content: flex-start;
    background: transparent;
    border: none;
    text-align: left;
    padding-top: 6px;
    padding-bottom: 6px;
  }

  /* Neutral gray focus ring for buttons/chips — accent-a2 (blue) reads as "pressed/selected" on icon buttons */
  .header-chip:focus-visible,
  .header-icon-btn:focus-visible,
  .icon-btn:focus-visible,
  .chip:focus-visible,
  .ghost-btn:focus-visible,
  .card-interactive:focus-visible,
  .model-item:focus-visible,
  .popover-item:focus-visible,
  .text-action:focus-visible,
  .tab-btn:focus-visible {
    box-shadow: 0 0 0 2px var(--gray-a5);
  }

  /* iOS Continuous Corners */
  .popover-content, .popover-item, .popover-item-multi, .chip, .ghost-btn, .card-interactive, .model-item, .header-icon-btn, .header-chip, .icon-btn, .submit-btn-active, .submit-btn-disabled, .focusable-input, .text-action, .tab-btn {
    corner-shape: var(--corner-shape);
  }

  /* --- Spin Border (conic-gradient rotating ring for focus + loading) --- */
  @property --angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  @keyframes spin-border {
    to { --angle: 360deg; }
  }

  /* --- Thinking Shimmer (moved from ThinkingStream.tsx) --- */
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  .thinking-shimmer {
    background: linear-gradient(90deg, var(--accent-11), var(--accent-8), var(--accent-11));
    background-size: 200% 100%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 2s ease-in-out infinite;
    font-size: 12px;
    font-weight: 500;
    font-family: 'Inter', var(--font-sans, system-ui, sans-serif);
  }

  /* --- Motion & Animations --- */
  @keyframes tool-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  /* Context chip entrance — harmonized with textarea grow curve */
  @keyframes chip-enter {
    from { opacity: 0; transform: translateY(-2px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes chip-exit {
    from { opacity: 1; transform: translateY(0) scale(1); }
    to   { opacity: 0; transform: translateY(-2px) scale(0.96); }
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  @keyframes skeleton-shimmer {
    0% { left: -100%; }
    100% { left: 100%; }
  }

  .skeleton-item {
    position: relative;
    overflow: hidden;
  }

  .skeleton-item::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      var(--gray-a4), /* Slightly more visible than a3 */
      transparent
    );
    animation: skeleton-shimmer 1.5s infinite;
  }

  /* --- Settings Specific Styles --- */
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(8px) scale(0.98); } /* Pronounced entry */
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideOut {
    from { opacity: 1; transform: translateY(0) scale(1); }
    to { opacity: 0; transform: translateY(8px) scale(0.98); } /* Pronounced exit */
  }

  .settings-container {
    position: absolute;
    top: var(--header-height);
    right: 0;
    bottom: 0;
    left: 0;
    background: var(--color-background);
    z-index: 100;
    display: flex;
    flex-direction: column;
    animation: slideIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    will-change: transform, opacity;
  }

  .settings-container.is-closing {
    animation: slideOut 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
    pointer-events: none;
  }

  /* ============================================================
   *  Settings Panel — B-side mock translated to runtime CSS.
   *  Scoped under .settings-body to avoid bleeding into ChatFeature.
   *  Source: tools/ui-preview/settings-ab.html (B column, lines 1557-1779)
   *  ============================================================ */
  .settings-body {
    padding: 16px 0 8px;
    display: flex;
    flex-direction: column;
  }
  .settings-subhead {
    display: flex;
    align-items: center;
    padding: 0 12px;
    margin-bottom: 12px;
  }
  .settings-subhead h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--gray-12);
  }
  .settings-subhead .close-x {
    margin-left: auto;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--gray-a11);
    border-radius: 6px;
    cursor: pointer;
    background: transparent;
    border: none;
    transition: background 120ms ease, color 120ms ease;
  }
  .settings-subhead .close-x:hover { background: var(--gray-a3); color: var(--gray-12); }

  .settings-body .row-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 22px;
    margin-bottom: 8px;
  }
  .settings-body .row-label .lhs { font-size: 11px; font-weight: 400; color: var(--gray-a11); }
  .settings-body .row-label .rhs-link { font-size: 11px; color: var(--gray-a11); text-decoration: none; }

  /* --- Connections list (bordered card with concentric inner radius) --- */
  .conn-list {
    margin: 0 12px;
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--color-surface);
    border: 1px solid var(--gray-a4);
    border-radius: 8px;
    padding: 4px;
  }
  .conn-row, .conn-add {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 5px;
    height: 32px;
    cursor: pointer;
    position: relative;
  }
  .conn-row::after, .conn-add::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 4px;
    z-index: 0;
    pointer-events: none;
    transition: background 120ms ease;
  }
  .conn-row > *, .conn-add > * { position: relative; z-index: 1; }
  .conn-row:hover::after { background: var(--gray-a3); }
  .conn-add::after { background: transparent; }
  .conn-add:hover::after { background: var(--gray-a3); }
  .conn-add { color: var(--gray-a11); font-size: 11px; }
  .conn-add:hover { color: var(--gray-12); }
  /* Hairline divider between siblings — sits in the 4px sibling-gap zone. */
  .conn-row + .conn-expand + .conn-row::before,
  .conn-row + .conn-expand + .conn-add::before {
    content: '';
    position: absolute;
    top: -2.5px;
    left: 5px;
    right: 5px;
    height: 1px;
    background: var(--gray-a4);
    pointer-events: none;
    z-index: 0;
  }
  .conn-row + .conn-expand + .conn-row,
  .conn-row + .conn-expand + .conn-add { margin-top: 4px; }

  .conn-row .name { font-size: 11px; font-weight: 400; color: var(--gray-12); }
  .conn-row .meta-line {
    margin-left: auto;
    font-size: 11px;
    color: var(--gray-a11);
  }
  .conn-row.is-active .meta-line { color: var(--gray-12); }
  .conn-row .meta-line.is-error { color: #b91c1c; }
  .conn-row .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  /* Radio: hollow gray-a4 default, filled gray-12 when active.
     Inner dot ALWAYS rendered (transitions in/out via opacity+scale). */
  .conn-row .radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--gray-a4);
    background: var(--color-surface);
    cursor: pointer;
    position: relative;
    flex-shrink: 0;
    transition: border-color 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .conn-row .radio.checked { border-color: var(--gray-12); }
  .conn-row .radio::after {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background: var(--gray-12);
    opacity: 0;
    transform: scale(0.4);
    transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1),
                transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
  }
  .conn-row .radio.checked::after { opacity: 1; transform: scale(1); }
  .conn-row .radio.disabled { border-color: var(--gray-a3); cursor: not-allowed; }

  /* --- Conn-expand: CSS Grid 0fr↔1fr disclosure animation --- */
  .conn-expand {
    margin: 0;
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 220ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .conn-row.is-open + .conn-expand,
  .conn-add.is-open + .conn-expand {
    grid-template-rows: 1fr;
  }
  .conn-expand[hidden] { display: none; }
  .conn-expand-inner { overflow: hidden; min-height: 0; }
  .conn-expand-body {
    padding: 5px;
    background: transparent;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .conn-expand .key-row {
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;
  }
  .conn-expand .key-input {
    flex: 1;
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
    font-family: var(--font-mono, SFMono-Regular, "SF Mono", Menlo, monospace);
    color: var(--gray-12);
    background: var(--color-surface);
    border: none;
    outline: none;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px var(--gray-a4);
    transition: box-shadow 120ms ease;
  }
  .conn-expand .key-input::placeholder { color: var(--gray-a11); }
  .conn-expand .key-input:not(:placeholder-shown) { box-shadow: inset 0 0 0 1px var(--gray-a6); }
  .conn-expand .key-input:focus { box-shadow: inset 0 0 0 1px var(--gray-a8); }

  /* Two-step destructive delete: X morphs to Remove pill; Cancel slides out. */
  .conn-expand-body .delete-x {
    position: relative;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--gray-a11);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    overflow: hidden;
    box-shadow: inset 0 0 0 1px var(--gray-a4);
    transition: width 320ms cubic-bezier(0.4, 0, 0.2, 1),
                background 240ms ease,
                color 240ms ease,
                box-shadow 240ms ease;
    font-size: 11px;
    font-family: inherit;
    line-height: 1;
  }
  .conn-expand-body .delete-x .x-icon,
  .conn-expand-body .delete-x .rm-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 200ms ease;
    pointer-events: none;
    white-space: nowrap;
  }
  .conn-expand-body .delete-x .rm-label { opacity: 0; }
  .conn-expand-body .delete-x .x-icon { opacity: 1; }
  .conn-expand .key-input:not(:placeholder-shown) ~ .delete-x { box-shadow: inset 0 0 0 1px var(--gray-a6); }
  .conn-expand .key-input:focus ~ .delete-x { box-shadow: inset 0 0 0 1px var(--gray-a8); }
  .conn-expand .key-input ~ .delete-x:hover {
    background: rgba(220, 38, 38, 0.10);
    color: #b91c1c;
    box-shadow: inset 0 0 0 1px rgba(220, 38, 38, 0.25);
  }
  .conn-row.is-confirming + .conn-expand .delete-x:hover {
    background: #991b1b;
    color: white;
    box-shadow: none;
  }
  .conn-row.is-confirming + .conn-expand .delete-x .rm-label { transition: opacity 240ms ease 80ms; }
  .conn-row.is-confirming + .conn-expand .delete-x .x-icon { transition: opacity 160ms ease; }

  .key-row .cancel-btn {
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--gray-a11);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    flex-shrink: 0;
    max-width: 0;
    padding: 0;
    opacity: 0;
    transition: max-width 320ms cubic-bezier(0.4, 0, 0.2, 1),
                padding 320ms cubic-bezier(0.4, 0, 0.2, 1),
                opacity 240ms ease 80ms;
  }
  .key-row .cancel-btn:hover { background: var(--gray-a3); color: var(--gray-12); }
  .conn-row.is-confirming + .conn-expand .cancel-btn {
    max-width: 64px;
    padding: 0 8px;
    opacity: 1;
  }
  .conn-row.is-confirming + .conn-expand .delete-x {
    width: 64px;
    background: #b91c1c;
    color: white;
    box-shadow: none;
  }
  .conn-row.is-confirming + .conn-expand .delete-x .x-icon { opacity: 0; }
  .conn-row.is-confirming + .conn-expand .delete-x .rm-label { opacity: 1; }

  /* Row exit animation. */
  .conn-row.is-removing,
  .conn-add.is-removing {
    height: 0 !important;
    padding: 0 !important;
    opacity: 0;
    overflow: hidden;
    transition: height 280ms cubic-bezier(0.4, 0, 0.2, 1),
                padding 280ms cubic-bezier(0.4, 0, 0.2, 1),
                opacity 200ms ease;
  }
  .conn-expand.is-removing {
    grid-template-rows: 0fr !important;
    opacity: 0;
    transition: grid-template-rows 280ms cubic-bezier(0.4, 0, 0.2, 1),
                opacity 200ms ease;
  }

  .conn-expand .help-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--gray-a11);
  }
  .conn-expand .help-row a { color: var(--gray-a11); text-decoration: none; }
  .conn-expand .help-row a:hover { color: var(--gray-12); }
  .conn-expand .help-row .status { margin-left: auto; }
  .conn-expand .help-row .status.is-error { color: #b91c1c; }

  /* --- Test/Save primary button (dark fill) --- */
  .test-btn {
    height: 28px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 400;
    background: var(--gray-12);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    line-height: 1;
    overflow: hidden;
    white-space: nowrap;
    transition: background 200ms ease, color 200ms ease;
  }
  .test-btn:hover:not(.is-disabled):not(.testing) { filter: brightness(1.15); }
  .test-btn.testing { background: var(--gray-3); color: var(--gray-a11); }
  .test-btn.is-disabled {
    background: var(--gray-3);
    color: white;
    box-shadow: none;
    cursor: not-allowed;
  }
  .conn-expand .key-row .test-btn {
    max-width: 200px;
    transition: max-width 320ms cubic-bezier(0.4, 0, 0.2, 1),
                padding 320ms cubic-bezier(0.4, 0, 0.2, 1),
                margin 320ms cubic-bezier(0.4, 0, 0.2, 1),
                opacity 200ms ease,
                background 200ms ease,
                color 200ms ease;
  }
  .conn-row.is-confirming + .conn-expand .key-row .test-btn {
    max-width: 0;
    padding: 0;
    margin: 0;
    opacity: 0;
  }
  .test-btn-result {
    font-size: 11px;
    margin-top: 4px;
    padding-left: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #15803d;
  }
  .test-btn-result[data-state="success"] { color: #15803d; }
  .test-btn-result[data-state="error"] { color: #b91c1c; }
  .test-btn-result[data-state="info"] { color: var(--gray-a11); }
  .test-btn-result svg { flex-shrink: 0; }

  /* --- Active model card --- */
  .active-model-wrap {
    margin: 8px 12px 0;
    background: var(--color-surface);
    border: 1px solid var(--gray-a4);
    border-radius: 8px;
    padding: 4px;
    position: relative;
  }
  .active-model {
    height: 32px;
    padding: 0 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    border-radius: 4px;
  }
  .active-model::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 4px;
    z-index: 0;
    pointer-events: none;
    transition: background 120ms ease;
  }
  .active-model:hover::after { background: var(--gray-a3); }
  .active-model > * { position: relative; z-index: 1; }
  .active-model .model-info { flex: 1; min-width: 0; }
  .active-model .model-name {
    font-size: 11px;
    font-weight: 400;
    color: var(--gray-12);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: opacity 160ms ease;
  }
  .active-model .model-name.is-swapping { opacity: 0.4; }
  .active-model .chev {
    color: var(--gray-a11);
    flex-shrink: 0;
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .active-model.is-open .chev { transform: rotate(180deg); }

  /* --- Pref-group (Theme + Language) --- */
  .pref-group {
    margin: 8px 12px 0;
    border: 1px solid var(--gray-a4);
    border-radius: 8px;
    background: var(--color-surface);
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .pref-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 32px;
    padding: 0 5px;
    border-radius: 4px;
    position: relative;
    cursor: default;
  }
  .pref-row + .pref-row { margin-top: 8px; }
  .pref-row .lhs { font-size: 11px; color: var(--gray-a11); cursor: default; }
  .pref-row .rhs {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 0 0 8px;
    margin: 0 -5px 0 0;
    font-size: 11px;
    color: var(--gray-a11);
    border-radius: 4px;
    transition: background 120ms ease, color 120ms ease;
  }
  .pref-row .rhs[data-lang-trigger] { cursor: pointer; outline: none; }
  .pref-row .rhs[data-lang-trigger]:hover { background: var(--gray-a3); color: var(--gray-12); }
  .pref-row-lang .rhs .chev { transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1); }
  .pref-row-lang .rhs.is-open .chev { transform: rotate(180deg); }

  /* --- Seg-pill (Theme switcher) --- */
  .seg-pill {
    display: inline-flex;
    align-items: center;
    height: 32px;
    background: var(--seg-pill-track);
    border-radius: 8px;
    padding: 2px;
    gap: 0;
    position: relative;
    overflow: hidden;
  }
  .pref-row > .seg-pill { margin-right: -5px; }
  .seg-pill::after {
    content: '';
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: var(--seg-x, 2px);
    width: var(--seg-w, 0px);
    background: var(--seg-pill-thumb);
    border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    transition: left 220ms cubic-bezier(0.4, 0, 0.2, 1),
                width 220ms cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
    z-index: 0;
  }
  .seg-pill .seg {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    height: 28px;
    font-size: 11px;
    padding: 0 10px;
    border-radius: 6px;
    color: var(--gray-a11);
    cursor: pointer;
    line-height: 1;
    background: transparent !important;
    box-shadow: none !important;
    transition: color 200ms cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    user-select: none;
  }
  .seg-pill .seg.active { color: var(--gray-12); }
  .seg-pill .seg:not(.active):hover { color: var(--gray-12); }

  /* --- Hoisted popovers (active-model + language) --- */
  .model-popover {
    position: absolute;
    background: var(--color-surface);
    border-radius: 8px;
    box-shadow: inset 0 0 0 0.5px var(--gray-a4), 0 4px 12px rgba(0,0,0,0.08);
    z-index: 100;
    overflow: hidden;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .model-popover[hidden] { display: none; }
  .pop-filter { position: relative; margin: 0; padding: 0; }
  .pop-filter input {
    width: 100%;
    height: 28px;
    padding: 0 24px 0 8px;
    font-size: 11px;
    border: none;
    outline: none;
    background: var(--color-surface);
    border-radius: 6px;
    color: var(--gray-12);
    font-family: inherit;
    box-shadow: inset 0 0 0 1px var(--gray-a4);
    transition: box-shadow 120ms ease;
  }
  .pop-filter input::placeholder { color: var(--gray-a11); }
  .pop-filter input:not(:placeholder-shown) { box-shadow: inset 0 0 0 1px var(--gray-a6); }
  .pop-filter input:focus { box-shadow: inset 0 0 0 1px var(--gray-a8); }
  .pop-filter .pf-clear {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    display: none;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--gray-a11);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
  }
  .pop-filter .pf-clear:hover { background: var(--gray-a3); color: var(--gray-12); }
  .pop-filter[data-typed="true"] .pf-clear { display: inline-flex; }

  .pop-list {
    flex: 1 1 auto;
    min-height: 0;
    max-height: 240px;
    overflow-y: auto;
    padding: 0;
  }
  .pop-filter ~ .pop-list { margin-top: 4px; }
  .pop-item {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .pop-item:hover { background: var(--gray-a3); }
  .pop-item .pi-name {
    font-size: 11px;
    font-weight: 400;
    color: var(--gray-12);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop-item .pi-check { color: var(--gray-12); flex-shrink: 0; }
  .pop-empty {
    padding: 16px 8px;
    font-size: 11px;
    color: var(--gray-a11);
    text-align: center;
  }
  .pop-footer {
    position: relative;
    margin-top: 4px;
    padding: 0;
  }
  .pop-footer::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--gray-a4);
    pointer-events: none;
  }
  .pop-footer .pop-footer-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0 0;
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 11px;
    color: var(--gray-a11);
    cursor: pointer;
  }
  .pop-footer .pop-footer-row:hover { background: var(--gray-a3); color: var(--gray-12); }

  /* --- Custom-endpoint form (collapsed for C-A; CSS kept for future use) --- */
  .custom-endpoint-form { gap: 8px; }
  .custom-endpoint-form .cef-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .custom-endpoint-form .cef-label {
    font-size: 11px;
    color: var(--gray-a11);
    padding-left: 10px;
  }
  .custom-endpoint-form .cef-required { color: #b91c1c; margin-left: 2px; font-weight: 500; }
  .custom-endpoint-form .cef-optional {
    color: var(--gray-a8);
    font-size: 10px;
    font-weight: 400;
    margin-left: 4px;
  }
  .custom-endpoint-form .cef-control { margin: 0; align-self: stretch; }
  .custom-endpoint-form > .test-btn { align-self: stretch; }
  .input-pw {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
    font-family: var(--font-mono, SFMono-Regular, "SF Mono", Menlo, monospace);
    color: var(--gray-12);
    background: var(--color-surface);
    border: none;
    outline: none;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1px var(--gray-a4);
    transition: box-shadow 120ms ease;
  }
  .input-pw::placeholder { color: var(--gray-a11); }
  .input-pw:not(:placeholder-shown) { box-shadow: inset 0 0 0 1px var(--gray-a6); }
  .input-pw:focus { box-shadow: inset 0 0 0 1px var(--gray-a8); }

  /* --- Footer-b (sponsor links + copy) --- */
  .footer-b {
    flex-shrink: 0;
    background: var(--color-surface);
    padding: 20px 12px 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    position: relative;
  }
  .footer-b::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 16px;
    background: linear-gradient(to bottom, transparent, var(--color-surface));
    pointer-events: none;
  }
  .footer-b .links {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .footer-b .links a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    color: var(--gray-a11);
    text-decoration: none;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .footer-b .links a:hover {
    background: var(--gray-a3);
    color: var(--gray-12);
  }
  .footer-b .links .heart { color: #db2777; }
  .footer-b .copy { font-size: 10px; color: var(--gray-a11); }

  /* Ghost danger button — destructive action with restraint.
     Used by Sign out in Settings → Account. */
  .ghost-danger-btn {
    height: 24px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 400;
    background: transparent;
    color: var(--error-11);
    border: 1px solid var(--gray-a4);
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    line-height: 1;
    transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
  }
  .ghost-danger-btn:hover {
    background: var(--error-9);
    color: white;
    border-color: var(--error-9);
  }

  /* Generic spinning icon (used by Refresh model list) */
  @keyframes settings-spin {
    to { transform: rotate(360deg); }
  }
  .is-spinning { animation: settings-spin 1s linear infinite; }

  /* ============================================================
   *  Settings Panel V2 — protocol-based provider list (Phase 7)
   *  Source mock: tools/ui-preview/settings-ab-v2-protocol.html §2 + §3
   *  ============================================================ */

  /* Validation banner palette — added once, reused by .vbanner.* */
  :root {
    --green-bg: #f0fdf4;
    --green-fg: #15803d;
    --green-border: #bbf7d0;
    --amber-bg: #fffbeb;
    --amber-fg: #b45309;
    --amber-border: #fde68a;
    --red-bg: #fef2f2;
    --red-fg: #b91c1c;
    --red-border: #fecaca;
  }
  [data-theme="dark"] {
    --green-bg: rgba(34, 197, 94, 0.10);
    --green-fg: #4ade80;
    --green-border: rgba(34, 197, 94, 0.30);
    --amber-bg: rgba(217, 119, 6, 0.10);
    --amber-fg: #fbbf24;
    --amber-border: rgba(217, 119, 6, 0.30);
    --red-bg: rgba(220, 38, 38, 0.10);
    --red-fg: #f87171;
    --red-border: rgba(220, 38, 38, 0.30);
  }

  /* Provider list (replaces .conn-list for V2) */
  .settings-body .provider-list {
    margin: 0 12px;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--gray-a4);
    border-radius: 8px;
    padding: 4px;
  }

  .provider-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    position: relative;
  }
  .provider-row:hover {
    background: var(--gray-a2);
  }
  .provider-row .radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--gray-a7);
    background: var(--color-surface);
    flex-shrink: 0;
    position: relative;
    margin-top: 2px;
    transition: border-color 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .provider-row.active .radio {
    border-color: var(--gray-12);
  }
  .provider-row.active .radio::after {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background: var(--gray-12);
  }
  .provider-row-body {
    flex: 1;
    min-width: 0;
  }
  .provider-row-name {
    font-size: 11px;
    font-weight: 500;
    color: var(--gray-12);
    line-height: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .provider-row.active .provider-row-name {
    font-weight: 600;
  }
  .provider-row-meta {
    font-size: 10px;
    color: var(--gray-a11);
    margin-top: 2px;
    line-height: 14px;
    font-family: var(--font-mono, SFMono-Regular, "SF Mono", Menlo, monospace);
    word-break: break-all;
    overflow-wrap: anywhere;
  }
  .provider-row-meta-host {
    display: block;
  }
  .provider-row-meta-model {
    display: block;
    color: var(--gray-12);
    margin-top: 1px;
  }

  /* Trailing chevron (drill-in affordance, hidden until hover/active) */
  .provider-row .row-chevron {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--gray-a11);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    opacity: 0;
    padding: 0;
    margin-top: -2px;
    transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
  }
  .provider-row:hover .row-chevron,
  .provider-row.active .row-chevron,
  .provider-row:focus-within .row-chevron {
    opacity: 1;
  }
  .provider-row .row-chevron:hover {
    background: var(--gray-a4);
    color: var(--gray-12);
  }

  /* Add Provider — last row of provider-list card. "+" aligns with radio column. */
  .provider-list .add-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    color: var(--gray-a11);
    background: transparent;
    border: none;
    font-family: inherit;
    font-size: 11px;
    font-weight: 500;
    width: 100%;
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .provider-list .add-row:hover {
    background: var(--gray-a2);
    color: var(--gray-12);
  }
  .provider-list .add-row .add-row-plus {
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* ─── height-grow primitive (heuristic #5) ─────────────────────────
   * Two-element wrapper: outer grid 0fr↔1fr, inner overflow-hidden.
   * Animate by toggling .is-hidden on .grow-wrap.
   */
  .grow-wrap {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .grow-wrap.is-hidden {
    grid-template-rows: 0fr;
  }
  .grow-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* ─── Add Provider picker (in-card, ModelPopover aesthetic) ────────
   * Lives inside .provider-list as the last child(ren). Single 11px font.
   * 8px four-side padding on every interactive row.
   */
  .add-picker {
    display: flex;
    flex-direction: column;
  }
  .add-picker-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--gray-a11);
  }
  .add-picker-close {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--gray-a11);
    border-radius: 4px;
    cursor: pointer;
    padding: 0;
    transition: background 120ms ease, color 120ms ease;
  }
  .add-picker-close:hover {
    background: var(--gray-a3);
    color: var(--gray-12);
  }

  /* Preset row inside .add-picker — same aesthetic as ProviderRow */
  .pop-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    font-family: inherit;
    font-size: 11px;
    color: var(--gray-12);
    transition: background 120ms ease;
  }
  .pop-row:hover {
    background: var(--gray-a2);
  }
  .pop-row .pop-name {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop-row .pop-meta {
    font-size: 10px;
    color: var(--gray-a11);
    font-family: var(--font-mono, SFMono-Regular, "SF Mono", Menlo, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  }
  .pop-row .pop-chevron {
    color: var(--gray-a11);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* Stage 2 — preset picked, key entry. Header already names the preset, so
     this row only shows the baseURL (truncates with ellipsis) + Change button. */
  .picked-preset {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 4px;
    min-width: 0;
  }
  .picked-preset .pop-meta {
    flex: 1;
    min-width: 0;
    font-size: 10px;
    color: var(--gray-a11);
    font-family: var(--font-mono, SFMono-Regular, "SF Mono", Menlo, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picked-preset .change-btn {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--gray-a11);
    background: transparent;
    border: none;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: background 120ms ease, color 120ms ease;
  }
  .picked-preset .change-btn:hover {
    background: var(--gray-a3);
    color: var(--gray-12);
  }

  .key-input-row {
    display: flex;
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .key-input {
    flex: 1;
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
    font-family: var(--font-mono, SFMono-Regular, "SF Mono", Menlo, monospace);
    color: var(--gray-12);
    background: var(--color-surface);
    border: none;
    outline: none;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px var(--gray-a4);
    transition: box-shadow 120ms ease;
    min-width: 0;
  }
  .key-input::placeholder { color: var(--gray-a11); }
  .key-input:focus { box-shadow: inset 0 0 0 1px var(--gray-a8); }

  .key-save {
    height: 28px;
    padding: 0 12px;
    border-radius: 4px;
    border: none;
    background: var(--gray-12);
    color: var(--color-surface);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    flex-shrink: 0;
    transition: filter 120ms ease, opacity 120ms ease;
  }
  .key-save:hover:not(:disabled) { filter: brightness(1.15); }
  .key-save:disabled { opacity: 0.5; cursor: not-allowed; }

  .key-remove {
    height: 28px;
    width: 28px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--red-fg);
    box-shadow: inset 0 0 0 1px var(--gray-a4);
    cursor: pointer;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease, box-shadow 120ms ease;
  }
  .key-remove:hover {
    background: var(--red-bg);
    box-shadow: inset 0 0 0 1px var(--red-border);
  }

  .key-help {
    font-size: 10px;
    color: var(--gray-a11);
    padding: 0 8px 8px;
    line-height: 1.5;
  }
  .key-help a {
    color: var(--gray-a11);
    text-decoration: underline;
  }
  .key-help a:hover { color: var(--gray-12); }

  /* ValidationBanner inside picker — pull margins to align with key-input-row */
  .add-picker .vbanner {
    margin: 4px 8px 8px;
  }

  /* Validation banner */
  .vbanner {
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 11px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    line-height: 1.5;
  }
  .vbanner .ico {
    flex-shrink: 0;
    font-size: 13px;
    line-height: 1.2;
  }
  .vbanner-body {
    flex: 1;
    min-width: 0;
  }
  .vbanner-caption {
    margin-top: 2px;
    opacity: 0.9;
    word-break: break-word;
  }
  .vbanner.success {
    background: var(--green-bg);
    color: var(--green-fg);
    border: 1px solid var(--green-border);
  }
  .vbanner.warn {
    background: var(--amber-bg);
    color: var(--amber-fg);
    border: 1px solid var(--amber-border);
  }
  .vbanner.error {
    background: var(--red-bg);
    color: var(--red-fg);
    border: 1px solid var(--red-border);
  }
  .vbanner.pending {
    background: var(--gray-2, var(--gray-a2));
    color: var(--gray-a11);
    border: 1px solid var(--gray-a4);
  }
  .vbanner a {
    color: inherit;
    font-weight: 600;
    text-decoration: underline;
  }

  /* Pulsing dot used in pending banner */
  .vbanner .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent-9, #3b82f6);
    animation: vbanner-pulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
    margin-top: 2px;
  }
  @keyframes vbanner-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
`;
