
/**
 * @file merge_css.ts
 * @description Merges generated CSS parts into the final css.ts file.
 */

import * as fs from 'fs';
import * as path from 'path';

const radixPath = 'temp_radix_primitives.css';
const themePath = 'temp_theme_a.css';
const targetPath = 'src/ui/design-system/tokens/css.ts';

const radixContent = fs.existsSync(radixPath) ? fs.readFileSync(radixPath, 'utf8') : '';
const themeContent = fs.existsSync(themePath) ? fs.readFileSync(themePath, 'utf8') : '';

const header = `/**
 * @file css.ts
 * @description Global CSS custom properties (variables) definition - Radix Standards
 */

export const cssTokens = \`
`;

const rootBlock = `  :root {
${radixContent}
${themeContent}
    /* Animation Easing */
    --ease-enter: cubic-bezier(0.4, 0, 0.2, 1);
    --ease-exit: cubic-bezier(0.4, 0, 1, 1);
    --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

    --font-size-1: 12px; --font-size-2: 14px; --font-size-3: 16px; --font-size-4: 18px;
    --font-size-5: 20px; --font-size-6: 24px; --font-size-7: 28px; --font-size-8: 35px; --font-size-9: 60px;

    --corner-shape: squircle;
    --transition-crisp: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }
`;

const darkBlock = `
  /* --- Dark Mode Configuration --- */
  @media (prefers-color-scheme: dark) {
    :root {
      --gray-1: #111111; --gray-2: #191919; --gray-3: #222222; --gray-4: #2a2a2a;
      --gray-5: #313131; --gray-6: #3a3a3a; --gray-7: #484848; --gray-8: #606060;
      --gray-9: #6e6e6e; --gray-10: #7b7b7b; --gray-11: #b4b4b4; --gray-12: #eeeeee;

      --gray-a1: rgba(255, 255, 255, 0.010); --gray-a2: rgba(255, 255, 255, 0.024); --gray-a3: rgba(255, 255, 255, 0.057);
      --gray-a4: rgba(255, 255, 255, 0.074); --gray-a5: rgba(255, 255, 255, 0.103); --gray-a6: rgba(255, 255, 255, 0.133);
      --gray-a7: rgba(255, 255, 255, 0.176); --gray-a8: rgba(255, 255, 255, 0.255); --gray-a9: rgba(255, 255, 255, 0.420);
      --gray-a10: rgba(255, 255, 255, 0.475); --gray-a11: rgba(255, 255, 255, 0.565); --gray-a12: rgba(255, 255, 255, 0.910);

      /* Dark mode overrides for other scales if needed - currently sticking to defaults or Theme A mappings? */
      /* Theme A doesn't seem to have explicit Dark Mode in the JSON file we saw. Use standard Radix mapping logic if needed. */
      
      --color-background: var(--gray-1);
      --color-surface: var(--gray-2);
      --color-panel: var(--gray-2);
      --color-overlay: rgba(0, 0, 0, 0.7);
      --color-shadow: rgba(0, 0, 0, 0.3);
      
      --accent-surface: rgba(0, 145, 255, 0.15);
    }
  }

  /* Attribute-based themes */
  [data-theme="dark"] {
      --color-background: var(--gray-1);
      --color-surface: var(--gray-2);
      --color-panel: var(--gray-2);
      --gray-1: #111111; --gray-12: #eeeeee;
  }
`;

const globalStyles = `
  /* --- Global Styles --- */
  * { box-sizing: border-box; }
  body { 
    margin: 0; 
    font-family: var(--font-sans, Inter, system-ui, sans-serif); 
    background-color: var(--color-background);
    color: var(--gray-12);
  }

  /* --- Component Standard Classes --- */
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
\`;
`;

const fileContent = header + rootBlock + darkBlock + globalStyles;

fs.writeFileSync(targetPath, fileContent);
console.log(`Successfully merged CSS to ${targetPath}`);
