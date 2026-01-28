/**
 * @file PromptInput.tsx
 * @description P4 重构：输入区域组件
 * 
 * 布局：
 * ┌──────────────────────────────────────────┐
 * │ Type to generate...                      │  ← Textarea（上）
 * │ [Model ↑]                           [✓]  │  ← Footer Row（下）
 * └──────────────────────────────────────────┘
 * 
 * 语义化架构：
 * - leftElement slot 用于放置 ModelPopover
 * - 使用 componentStyles.inputArea / submitButton
 * - IME 输入法兼容（中日韩语言）
 */

import { h, ComponentChildren } from 'preact';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { tokens, componentStyles } from '../design-system/tokens';
import { t } from '../i18n';

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  canSubmit?: boolean;
  loading?: boolean;
  
  // P4: Slot for ModelPopover
  leftElement?: ComponentChildren;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = t.placeholder,
  disabled = false,
  canSubmit = false,
  loading = false,
  leftElement,
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
  // Also scroll to bottom so user sees cursor/latest content
  useLayoutEffect(() => {
    if (textareaRef.current) {
      autoResize(textareaRef.current);
      // Scroll to bottom to show latest content
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [value]);

  return (
    <div style={{
      ...componentStyles.inputArea.container,
      borderRadius: tokens.radii['2xl'], // 24px - Use token instead of hardcode
      background: tokens.colors.surface, // Migrated from colors.card
      border: `1px solid ${tokens.colors.grayBorder}`,
      boxShadow: tokens.colors.shadow, // Replaced rgba(0,0,0,0.08)
      // Note: Removed overflow: hidden to allow Popovers to float above
      // Note: margin removed - parent container controls spacing (隔离式原则)
    }}>
      {/* Textarea - 上方 */}
      <textarea
        ref={textareaRef}
        className="focusable"
        style={{
          ...componentStyles.inputArea.textarea,
          background: 'transparent', // Transparent to let card bg show
          paddingBottom: tokens.space[1], // 4px
          paddingTop: tokens.space[3],    // 12px
          paddingLeft: tokens.space[4],   // 16px
          paddingRight: tokens.space[4],  // 16px
        } as h.JSX.CSSProperties}
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-disabled={disabled}
        readOnly={disabled}
      />
      
      {/* Footer Row - 下方: [Model ↑] ... [✓] */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `${tokens.space[2]}px ${tokens.space[4]}px ${tokens.space[4]}px ${tokens.space[4]}px`, // Use tokens
      }}>
        {/* Left: Model Selector slot */}
        <div>
          {leftElement}
        </div>
        
        {/* Right: Submit button */}
        <button
          className={canSubmit ? 'submit-btn-active' : 'submit-btn-disabled'}
          style={{
            ...componentStyles.submitButton.base,
            ...(canSubmit ? componentStyles.submitButton.active : componentStyles.submitButton.disabled),
            position: 'relative', // 覆盖 absolute
            right: 'auto',
            bottom: 'auto',
            borderRadius: 'var(--radius-full)', // was 999
          } as h.JSX.CSSProperties}
          onClick={() => canSubmit && onSubmit()}
          aria-disabled={!canSubmit}
          aria-busy={loading}
        >
          {/* Replaced Checkmark with Send Arrow (Icon Refresh Phase 3 - early partial apply) */}
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke={canSubmit ? tokens.colors.accentContrast : tokens.colors.surface} // Migrated from colors.card 
            strokeWidth="2.5"
          >
             <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
