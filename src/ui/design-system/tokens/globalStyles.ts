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
    color: var(--color-background);
    border: 1.5px solid var(--gray-12);
    cursor: pointer;
  }
  .submit-btn-active:hover {
    filter: brightness(1.1);
  }
  .submit-btn-disabled {
    background: var(--gray-a4);
    color: var(--color-background);
    border: none;
    cursor: default;
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
    box-shadow: 0 0 0 3px var(--accent-a2);
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

  .settings-footer {
    padding: var(--space-6) var(--space-4) var(--space-4);
    text-align: center;
    font-size: 12px;
    color: var(--gray-9);
    display: flex;
    flex-direction: column;
    gap: 4px;
    opacity: 0.8;
  }

  .settings-footer a {
    color: var(--gray-11);
    text-decoration: none;
    transition: color 150ms ease;
  }

  .settings-footer a:hover {
    color: var(--gray-12);
    text-decoration: underline;
  }
`;
