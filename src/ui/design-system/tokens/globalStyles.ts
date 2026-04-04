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
  .header-chip:hover:not(.disabled),
  .header-chip.is-hover:not(.disabled) {
    background: var(--gray-a2);
    border-color: var(--gray-a5);
  }
  .header-chip:active:not(.disabled),
  .header-chip.is-pressed:not(.disabled) {
    background: var(--gray-a4);
  }
  .header-chip.disabled,
  .header-chip.is-disabled {
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
  .header-icon-btn:hover,
  .header-icon-btn.is-hover {
    background: var(--gray-a2);
    color: var(--text-primary);
  }
  .header-icon-btn:active,
  .header-icon-btn.is-pressed {
    background: var(--gray-a4);
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
  .chip.active {
    background: var(--accent-9);
    color: var(--accent-contrast);
    border-color: var(--accent-9);
  }

  .submit-btn-active {
    background: var(--gray-12);
    color: var(--color-background);
  }
  .submit-btn-active:hover {
    filter: brightness(1.1);
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

  /* iOS Continuous Corners */
  .popover-content, .popover-item, .chip, .header-icon-btn, .header-chip, .submit-btn-active, .submit-btn-disabled {
    corner-shape: var(--corner-shape);
  }

  /* --- Motion & Animations --- */
  @keyframes tool-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
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
