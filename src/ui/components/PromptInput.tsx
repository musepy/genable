/**
 * @file PromptInput.tsx
 * @description Input area component — matches Figma design (node 57:571)
 *
 * Layout:
 * ┌──────────────────────────────────────────┐
 * │ [ContextTag] [ContextTag]                │  ← Context Tags (optional)
 * │ Describe your task...                    │  ← Textarea
 * │ [+]  [Model ↑]                      [▶] │  ← Footer Row
 * └──────────────────────────────────────────┘
 *
 * - contextTags slot for ContextTag components
 * - leftElement slot for ModelPopover
 * - IME input compatible (CJK languages)
 */

import { h, ComponentChildren } from 'preact';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { ActionPopover } from './ActionPopover';
import { tokens } from '../design-system/tokens';
import { t } from '../i18n';

const submitButtonBase = {
  position: 'absolute' as const,
  right: tokens.space[1],
  bottom: tokens.space[1],
  width: tokens.size.button.md,
  height: tokens.size.button.md,
  borderRadius: '50%',
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  transition: 'var(--transition-crisp, all 150ms ease)',
};
const submitButtonActive = {
  background: 'var(--accent-9)',
  border: '1.5px solid var(--accent-9)',
  cursor: 'pointer',
};
const submitButtonDisabled = {
  background: 'var(--gray-a4)',
  border: 'none',
  cursor: 'default',
};

const inputAreaContainer = {
  position: 'relative' as const,
  background: tokens.colors.surface,
  border: 'none',
  borderRadius: 'var(--radius-5)',
  boxShadow: `inset 0 0 0 0.5px var(--gray-a4), ${tokens.colors.shadowFocus}`,
};
const inputAreaTextarea = {
  width: '100%',
  minHeight: tokens.space[6] + tokens.space[5],
  maxHeight: tokens.space[9] + tokens.space[6] + tokens.space[5],
  paddingTop: tokens.space[2],
  paddingBottom: tokens.space[2],
  paddingLeft: tokens.grid.blockPad,   // text at scrollPad(12) + blockPad(10) = 22
  paddingRight: tokens.grid.blockPad,
  fontSize: tokens.fontSize[1],
  background: 'transparent',
  color: 'var(--gray-12)',
  border: 'none',
  outline: 'none',
  resize: 'none' as const,
  fontFamily: tokens.font.sans,
  lineHeight: tokens.lineHeight[2],
  boxSizing: 'border-box' as const,
  transition: 'height 200ms cubic-bezier(0, 0, 0.2, 1)',
};

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  canSubmit?: boolean;
  loading?: boolean;

  /** Slot for context tag pills above textarea */
  contextTags?: ComponentChildren;
  /** Slot for ModelPopover / extra controls */
  leftElement?: ComponentChildren;
  /** Callback for the plus (+) button */
  onPlusClick?: () => void;
  /** Callback when a skill is selected from action popover */
  onSkillSelect?: (skillId: string) => void;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = t.placeholder,
  disabled = false,
  canSubmit = false,
  loading = false,
  contextTags,
  leftElement,
  onPlusClick,
  onSkillSelect,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleInput = (e: Event) => {
    if (disabled) return;
    const textarea = e.currentTarget as HTMLTextAreaElement;
    onChange(textarea.value);
    autoResize(textarea);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // IME composition check: ignore Enter during IME input (CJK languages)
    if (e.isComposing || e.keyCode === 229) return;

    // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to submit
    const isSubmitShortcut = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
    if (isSubmitShortcut && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  // Auto-resize when value updates (e.g. from prompt chips or reset)
  useLayoutEffect(() => {
    if (textareaRef.current) {
      autoResize(textareaRef.current);
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [value]);

  return (
    <div style={inputAreaContainer}>
      {/* Context Tags row */}
      {contextTags && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap' as const,
          gap: tokens.space[3],
          padding: `${tokens.space[3]}px ${tokens.space[3]}px 0`,
        }}>
          {contextTags}
        </div>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        className="focusable"
        style={inputAreaTextarea as h.JSX.CSSProperties}
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-disabled={disabled}
        readOnly={disabled}
      />

      {/* Footer Row: [+] [Model ↑] ... [▶] */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${tokens.space[3]}px`,
      }}>
        {/* Left: Action Popover (+) */}
        <ActionPopover 
          onSerializeSelection={onPlusClick || (() => {})} 
          onInsertSkill={onSkillSelect}
          disabled={disabled}
        />

        {/* Right: Model Selector + Submit */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: tokens.space[3], 
          minWidth: 0, 
          flex: 1, 
          justifyContent: 'flex-end' 
        }}>
          <div style={{ minWidth: 0, flexShrink: 1 }}>
            {leftElement}
          </div>

          {/* Submit button — rounded square per Figma */}
          <button
            className={canSubmit ? 'submit-btn-active' : 'submit-btn-disabled'}
            style={{
              ...submitButtonBase,
              ...(canSubmit ? submitButtonActive : submitButtonDisabled),
              position: 'relative',
              right: 'auto',
              bottom: 'auto',
              borderRadius: 'var(--radius-5)',
              flexShrink: 0,
            } as h.JSX.CSSProperties}
            onClick={() => canSubmit && onSubmit()}
            aria-disabled={!canSubmit}
            aria-busy={loading}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={canSubmit ? tokens.colors.accentContrast : tokens.colors.surface}
              strokeWidth="3"
            >
               <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
