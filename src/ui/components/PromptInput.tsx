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
import { useRef, useLayoutEffect, useState } from 'preact/hooks';
import { ArrowUp } from 'lucide-preact';
import { ActionPopover } from './ActionPopover';
import { tokens } from '../design-system/tokens';
import { t } from '../i18n';

const inputAreaContainer = {
  position: 'relative' as const,
  background: tokens.colors.surface,
  // Real 1px border in default state — same width as activeBorder so swapping
  // doesn't shift layout AND avoids "two strokes" (inset shadow + transparent border gap).
  border: '1px solid var(--gray-a4)',
  borderRadius: 'var(--radius-5)',
  boxShadow: `${tokens.colors.shadowFocus}`,
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
  transition: 'height 260ms cubic-bezier(0.32, 0.72, 0, 1)',
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
  const [isFocused, setIsFocused] = useState(false);

  const autoResize = (el: HTMLTextAreaElement) => {
    const prev = el.style.height;
    el.style.height = 'auto';
    const target = Math.min(el.scrollHeight, 120);
    el.style.height = prev;
    requestAnimationFrame(() => {
      el.style.height = `${target}px`;
    });
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

  const activeBorder = (loading || isFocused) ? {
    border: '1px solid transparent',
    boxShadow: '0 0 0 2px var(--accent-a2), 0 0 12px var(--accent-a3)',
    background: 'linear-gradient(var(--color-surface), var(--color-surface)) padding-box, conic-gradient(from var(--angle), var(--accent-a2) 0%, var(--accent-a3) 10%, var(--accent-a5) 20%, var(--accent-a3) 30%, var(--accent-a2) 50%, var(--accent-a3) 60%, var(--accent-a5) 70%, var(--accent-a3) 80%, var(--accent-a2) 100%) border-box',
    animation: 'spin-border 4s linear infinite',
  } : undefined;

  return (
    <div style={{ ...inputAreaContainer, ...activeBorder } as h.JSX.CSSProperties}>
      {/* Context Tags row */}
      {contextTags && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap' as const,
          gap: 4,
          padding: `${tokens.space[3]}px ${tokens.grid.blockPad}px 0`,
        }}>
          {contextTags}
        </div>
      )}

      {/* Textarea (with gradient mask above when context tags are present) */}
      <div style={{ position: 'relative' }}>
        {contextTags && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 16,
            background: 'linear-gradient(to bottom, var(--color-surface) 0%, var(--color-surface) 40%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: 1,
          }} />
        )}
        <textarea
          ref={textareaRef}
          className="focusable"
          style={inputAreaTextarea as h.JSX.CSSProperties}
          value={value}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          aria-disabled={disabled}
          readOnly={disabled}
        />
      </div>

      {/* Footer Row: [+] [Model v] [▶] */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[2]}px ${tokens.grid.blockPad}px`,
      }}>
        <ActionPopover
          onSerializeSelection={onPlusClick || (() => {})}
          onInsertSkill={onSkillSelect}
          disabled={disabled}
        />

        <div style={{ marginLeft: 'auto', minWidth: 0 }}>
          {leftElement}
        </div>

        <button
          className={`icon-btn ${canSubmit ? 'submit-btn-active' : 'submit-btn-disabled'}`}
          style={{ borderRadius: 'var(--radius-5)' } as h.JSX.CSSProperties}
          onClick={() => canSubmit && onSubmit()}
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          aria-busy={loading}
        >
          <ArrowUp
            size={16}
            strokeWidth={2}
            color={canSubmit ? tokens.colors.accentContrast : tokens.colors.surface}
          />
        </button>
      </div>
    </div>
  );
}
