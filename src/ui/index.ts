/**
 * @file index.ts
 * @description UI module exports
 */

export { tokens, cssTokens } from './design-system/tokens';
export type { Tokens } from './design-system/tokens';

export { SettingsPanel } from './SettingsPanel';
export type { SettingsPanelProps } from './SettingsPanel';

// Interaction States - semantic state management
export {
  derivePluginState,
  getElementState,
  isVisible,
  isEnabled,
  deriveButtonState,
  getAriaProps,
  getSubmitAriaProps,
  ELEMENT_STATES,
} from './interactionStates';
export type {
  PluginState,
  ElementState,
  ButtonState,
} from './interactionStates';

// P2: 语义化组件
export { Header } from './components/Header';
export type { HeaderProps } from './components/Header';

export { PromptInput } from './components/PromptInput';
export type { PromptInputProps } from './components/PromptInput';

export { PromptChips } from './components/PromptChips';
export type { PromptChipsProps, PromptSuggestion } from './components/PromptChips';
