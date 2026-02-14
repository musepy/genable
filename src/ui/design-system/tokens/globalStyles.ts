/**
 * @file globals.css.ts
 * @description Global CSS styles and component classes
 */

export const globalStyles = `
  /* --- Global Styles --- */
  * { box-sizing: border-box; }
  :root {
    --border-main: 0.5px solid var(--gray-a4);
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
    padding: 0 var(--space-3);
    height: 32px;
    background: transparent;
    color: var(--gray-11);
    border: 0.5px solid var(--gray-a4);
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

  .header-spacer {
    flex: 1;
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

  .card {
    background: var(--color-surface);
    border-radius: var(--radius-5);
    box-shadow: var(--color-shadow);
  }

  .chip {
    background: transparent;
    color: var(--gray-11);
    border: 0.5px solid var(--gray-a4);
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

  /* Button pressed states - Figma design sync */
  .btn-primary:active,
  .btn-primary.is-pressed {
    filter: brightness(0.9);
    transform: scale(0.98);
  }
  .btn-outline:active,
  .btn-outline.is-pressed {
    background: var(--gray-a3);
    border-color: var(--gray-8);
  }
  .btn-ghost:active,
  .btn-ghost.is-pressed {
    background: var(--gray-a4);
  }

  /* --- Masking & Fading --- */
  .messages-mask {
    -webkit-mask-image: linear-gradient(to bottom, 
      transparent 0%, 
      black 16px, 
      black calc(100% - 16px), 
      transparent 100%
    );
    mask-image: linear-gradient(to bottom, 
      transparent 0%, 
      black 16px, 
      black calc(100% - 16px), 
      transparent 100%
    );
    /* Ensure the mask doesn't hide the scrollbar if possible in this environment, 
       though Chrome usually masks everything. Adjusting padding can help. */
  }

  .error-banner {
    background: var(--error-1);
    border: 0.5px solid var(--error-6);
    border-radius: var(--radius-5);
    color: var(--error-11);
  }

  .popover-content {
    background: var(--color-surface);
    border-radius: var(--radius-6); /* Outer radius 16px to support nested 12px + 4px margin */
    border: 0.5px solid var(--gray-a4);
    box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.08);
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
  .card, .popover-content, .popover-item, .chip, .message-bubble, .header-icon-btn, .header-chip, .submit-btn-active, .submit-btn-disabled {
    corner-shape: var(--corner-shape);
  }

  /* --- Motion & Animations --- */
  @keyframes slideInFromRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  @keyframes slideOutToRight {
    from { transform: translateX(0); }
    to { transform: translateX(100%); }
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

  .slide-in-right {
    animation: slideInFromRight 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .slide-out-right {
    animation: slideOutToRight 250ms cubic-bezier(0.7, 0, 0.84, 0) forwards;
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

  .api-stack-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3); /* Standard 12px margin from edge */
  }

  .api-module-box {
    border: var(--border-main);
    border-radius: var(--radius-5);
    background: transparent; /* Seamless with container */
    overflow: hidden;
    transition: border-color 200ms ease;
  }

  .api-module-box.is-selected {
    /* Border remains standard per user request */
  }

  .api-module-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2); /* 8px left/right inner */
    cursor: pointer;
    background: transparent;
    transition: background 150ms ease;
  }

  .api-module-header:hover {
    background: var(--gray-a2);
  }

  .api-module-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--gray-12);
    display: flex;
    align-items: center;
  }

  .api-module-content {
    background: transparent; /* No internal color fill */
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 300ms cubic-bezier(0.16, 1, 0.3, 1), 
                opacity 300ms ease;
    opacity: 0;
    overflow: hidden; /* Ensure content is hidden when collapsed */
  }

  .api-module-box.is-expanded .api-module-content {
    grid-template-rows: 1fr;
    opacity: 1;
    /* Removed border-top separator */
  }

  .api-expand-inner {
    min-height: 0; 
    overflow: hidden;
    padding: var(--space-1) var(--space-2) var(--space-3) var(--space-2); /* 8px horizontal alignment */
    /* Removed scale effect from here */
  }

  .api-module-box.is-expanded .api-expand-inner {
    transform: scale(1);
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
