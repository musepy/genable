/**
 * @file index.ts
 * @description UI module exports
 */

export { tokens, cssTokens, motionTokens, interactionTokens, layoutTokens, componentStyles } from './design-system/tokens';
export type { Tokens, MotionTokens, InteractionTokens, LayoutTokens, ComponentStyles } from './design-system/tokens';

export {
  containerStyle,
  headerStyle,
  cardStyle,
  btnPrimaryStyle,
} from './styles';

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

// ExperimentTab kept but not actively exported to main UI
// export { ExperimentTab } from './ExperimentTab';
// export type { ExperimentTabProps } from './ExperimentTab';

// P2: 语义化组件
export { Header } from './components/Header';
export type { HeaderProps } from './components/Header';

export { PromptInput } from './components/PromptInput';
export type { PromptInputProps } from './components/PromptInput';

export { PromptChips } from './components/PromptChips';
export type { PromptChipsProps, PromptSuggestion } from './components/PromptChips';
