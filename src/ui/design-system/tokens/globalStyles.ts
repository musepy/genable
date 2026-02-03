/**
 * @file globals.css.ts
 * @description Global CSS styles and component classes
 */

export const globalStyles = `
  /* --- Global Styles --- */
  * { box-sizing: border-box; }
  body { 
    margin: 0; 
    font-family: var(--font-sans, Inter, system-ui, sans-serif); 
    background-color: var(--color-background);
    color: var(--gray-12);
  }

  /* --- Component Standard Classes --- */

  /* --- Component Styles --- */
  .header-container {
    display: flex;
    align-items: center;
    height: var(--header-height);
    background: var(--header-bg);
    /* border-bottom removed per design update */
    padding: 0 var(--space-3); /* 对齐设计稿的紧凑感 */
    box-sizing: border-box;
  }

  .header-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-4);
    height: 40px;
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--gray-6);
    border-radius: 6px; /* Figma design: --medium/3 = 6px */
    font-size: 13px; /* Figma design spec */
    font-weight: var(--font-weight-regular);
    cursor: pointer;
    transition: var(--transition-crisp);
  }
  .header-chip:hover:not(.disabled),
  .header-chip.is-hover:not(.disabled) {
    background: var(--gray-a3);
    border-color: var(--gray-7);
  }
  .header-chip:active:not(.disabled),
  .header-chip.is-pressed:not(.disabled) {
    background: var(--gray-a4);
    transform: scale(0.98);
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
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: var(--transition-crisp);
  }
  .header-icon-btn:hover,
  .header-icon-btn.is-hover {
    background: var(--gray-a3);
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
    background: var(--gray-3);
    color: var(--gray-11);
    border: 1px solid var(--gray-6);
    transition: all 150ms ease;
  }
  .chip:hover {
    background: var(--gray-4);
    border-color: var(--gray-8);
  }
  .chip.active {
    background: var(--accent-9);
    color: white;
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

  .error-banner {
    background: var(--error-1);
    border: 1px solid var(--error-6);
    border-radius: var(--radius-4);
    color: var(--error-11);
  }

  /* iOS Continuous Corners */
  .card, .popover-content, .chip, .message-bubble {
    corner-shape: var(--corner-shape);
  }
`;
