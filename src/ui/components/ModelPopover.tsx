/**
 * @file ModelPopover.tsx
 * @description Model selector popover - uses hardcoded model list for instant display
 * 
 * Design: 快 (instant), 精准 (select = save), 清爽 (light chip, no heavy borders)
 * Apple HIG: Primary content first, settings at bottom
 * Optimistic UI: No loading, no fetch - we know exactly what models we support
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Settings, ChevronRight, ChevronDown, Check } from 'lucide-preact';
import { usePopover } from '../hooks/usePopover';
import { tokens } from '../design-system/tokens';
import { useTranslations } from '../i18n';

const modelSelectorGhost = {
  opacity: 1,
  height: tokens.size.button.md,
};
const modelSelectorChip = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: tokens.space[1],
  padding: `0 ${tokens.space[2]}px`,
  height: tokens.size.button.md,
  // background left to .chip class so :hover works
  color: tokens.colors.textPrimary,
  border: 'none',
  borderRadius: 'var(--radius-5)',
  fontSize: tokens.fontSize[1],
  fontWeight: tokens.fontWeight.regular,
  lineHeight: tokens.lineHeight[1],
  cursor: 'pointer',
  transition: 'var(--transition-crisp)',
};
import { SUPPORTED_MODELS, sortModels } from '../constants/models';
import { isGemini3Family } from '../../engine/llm-client/modelEngine';

interface ModelPopoverProps {
  // Trigger
  currentModel: string;
  displayName?: string;
  disabled?: boolean;
  
  // Data
  apiKey: string;
  availableModels: { name: string; displayName: string }[];
  /** Thinking level for display (Gemini 3.0+) */
  thinkingLevel?: 'minimal' | 'low' | 'high';
  
  // Actions
  onSelectModel: (modelName: string) => void;
  onApiKeyChange: (key: string) => void;
  onOpenSettings?: () => void;
  providerName?: 'gemini' | 'openrouter' | 'dashscope' | 'claude';
  
  // P4: Layout variants
  placement?: 'bottom' | 'top';  // Popover 弹出方向
  variant?: 'chip' | 'ghost';    // 触发器样式
  align?: 'start' | 'end';       // Popover 对齐方式
}

export function ModelPopover({
  currentModel,
  displayName,
  disabled,
  apiKey,
  availableModels,
  thinkingLevel = 'high',
  onSelectModel,
  onApiKeyChange,
  onOpenSettings,
  placement = 'bottom',
  variant = 'chip',
  align = 'start',
  providerName = 'gemini', // [NEW]
}: ModelPopoverProps) {
  const t = useTranslations();
  const { isOpen, isClosing, ref, close, toggle, popoverClass } = usePopover();
  const [localApiKey, setLocalApiKey] = useState(apiKey);

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  // Scroll the currently-selected model into view when popover opens, so the
  // user can locate the active model without scrolling through the full list.
  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isOpen) {
      selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen]);

  // Use dynamic models from props
  const sortedModels = sortModels(availableModels.length > 0 ? availableModels : (SUPPORTED_MODELS[providerName] || SUPPORTED_MODELS.gemini), currentModel);
  const hasApiKey = !!apiKey;

  const handleSelect = (modelName: string) => {
    onSelectModel(modelName);
    close();
  };

  const handleApiKeySubmit = () => {
    if (localApiKey.length >= 20) {
      onApiKeyChange(localApiKey);
    }
  };

  // Determine thinking level label for Gemini 3.0+ models using SSOT utility
  const isGemini3 = isGemini3Family(currentModel);
  const baseText = displayName || currentModel.split('/').pop()?.replace(/-/g, ' ') || t.selectModel;
  
  // Concise naming override for Gemini 3.0 Flash
  const conciseBaseText = baseText.toLowerCase().includes('gemini 3.0 flash') ? 'gemini 3.0 flash' : baseText;
  
  const levelLabel = isGemini3 
    ? (thinkingLevel === 'high' ? ' (High)' : thinkingLevel === 'low' ? ' (Low)' : ' (Min)')
    : '';
  const chipText = conciseBaseText + levelLabel;

  // Trigger styles based on variant
  const triggerBaseStyle = variant === 'ghost'
    ? modelSelectorGhost
    : modelSelectorChip;
  const triggerStyle = {
    ...triggerBaseStyle,
    opacity: disabled ? 0.5 : 1,
  };
  
  // Popover position based on placement
  const popoverPositionStyle = placement === 'top'
    ? { bottom: `calc(100% + ${tokens.space[2]}px)`, top: 'auto' }
    : { top: `calc(100% + ${tokens.space[2]}px)`, bottom: 'auto' };
  const popoverAlignStyle = align === 'end'
    ? { right: 0, left: 'auto' }
    : { left: 0, right: 'auto' };

  const arrowIcon = (
    <ChevronDown
      size={14}
      strokeWidth={1.5}
      style={{
        transition: 'var(--transition-normal)',
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    />
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger - variant based style */}
      <button
        className={variant === 'ghost' ? 'ghost-btn' : 'chip'}
        style={triggerStyle as h.JSX.CSSProperties}
        onClick={() => !disabled && toggle()}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span style={{ 
          maxWidth: 200, 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap' 
        }}>
          {chipText}
        </span>
        {arrowIcon}
      </button>

      {/* Popover Content */}
      {isOpen && (
        <div
          className={popoverClass}
          style={{
            position: 'absolute',
            ...popoverPositionStyle,
            ...popoverAlignStyle,
            width: 240,
            minWidth: 220,
            maxWidth: 'calc(100vw - 24px)',
            zIndex: tokens.zIndex.popover,
            maxHeight: 'min(410px, calc(100vh - 60px))',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Model List - instant display using hardcoded SUPPORTED_MODELS */}
          {hasApiKey && (
            <div
              role="listbox"
              aria-label={t.selectModel}
              style={{
                padding: tokens.space[1],
                overflowY: 'auto',
                minHeight: 0,
                flex: 1,
              }}
            >
              {sortedModels.map((model, index) => {
                const normalize = (name: string) => name.toLowerCase().replace(/models\//, '').replace(/[^a-z0-9]/g, '');
                const isSelected = normalize(currentModel) === normalize(model.name);
                const shouldHighlight = isSelected || (index === 0 && !sortedModels.some(m => normalize(currentModel) === normalize(m.name)));
                
                return (
                  <div
                    key={model.name}
                    ref={shouldHighlight ? selectedRowRef : undefined}
                    role="option"
                    aria-selected={isSelected}
                    className={`popover-item ${shouldHighlight ? 'is-selected' : ''}`}
                    onClick={() => handleSelect(model.name)}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: tokens.space[1], flex: 1 }}>
                      <span style={{
                        fontSize: tokens.fontSize[1],
                        color: tokens.colors.textPrimary,
                        fontWeight: tokens.fontWeight.regular,
                        lineHeight: 'var(--typography-line-height-1)',
                      }}>
                        {model.displayName || model.name}
                      </span>
                      {isGemini3Family(model.name) && (
                      <span style={{ 
                        fontSize: tokens.fontSize[1],
                        color: tokens.colors.gray[9],
                        marginLeft: tokens.space[1] 
                      }}>
                          High
                        </span>
                      )}
                    </div>
                    {shouldHighlight && (
                      <Check size={14} strokeWidth={2.5} style={{ marginLeft: 'auto', color: tokens.colors.textPrimary }} />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {hasApiKey && (
            <div style={{
              height: 1,
              background: 'var(--gray-a4)',
              margin: '0 12px',
            }} />
          )}

          {/* Settings Section (Apple HIG: settings at bottom) */}
          <div style={{
            padding: tokens.space[1],
          }}>
            {hasApiKey ? (
              // API Key Settings link
              <div
                className="popover-item"
                onClick={() => { close(); onOpenSettings?.(); }}
              >
                <Settings
                  size={14}
                  strokeWidth={1.5}
                  style={{ color: tokens.colors.textSecondary, flexShrink: 0 }}
                />
                <span style={{
                  color: tokens.colors.textPrimary,
                  fontSize: tokens.fontSize[1],
                  fontWeight: tokens.fontWeight.regular,
                  flex: 1,
                }}>
                  {t.apiKeySettings}
                </span>
                <ChevronRight
                  size={14}
                  strokeWidth={1.5}
                  style={{ marginLeft: 'auto', color: tokens.colors.textSecondary, flexShrink: 0 }}
                />
              </div>
            ) : (
              // API Key Input (if not configured)
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], padding: tokens.space[1] }}>
                <span style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
                  {t.enterApiKeyToStart}
                </span>
                <div style={{ display: 'flex', gap: tokens.space[1] }}>
                  <input
                    type="password"
                    value={localApiKey}
                    onInput={(e) => setLocalApiKey((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                    placeholder={t.enterApiKey(providerName)}
                    style={{
                      flex: 1,
                      padding: tokens.space[1],
                      fontSize: tokens.fontSize[1],
                      background: tokens.colors.background, // Migrated from colors.background
                      border: 'var(--border-subtle)',
                      borderRadius: 'var(--radius-4)',
                      outline: 'none',
                      color: tokens.colors.textPrimary,
                    }}
                  />
                  <button
                    onClick={handleApiKeySubmit}
                    disabled={localApiKey.length < 20}
                    style={{
                      padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
                      background: localApiKey.length >= 20 ? tokens.colors.accent : tokens.colors.surface,
                      color: localApiKey.length >= 20 ? tokens.colors.accentContrast : tokens.colors.textSecondary,
                      border: 'none',
                      borderRadius: 'var(--radius-4)',
                      fontSize: tokens.fontSize[1],
                      cursor: localApiKey.length >= 20 ? 'pointer' : 'default',
                    }}
                  >
                    {t.save}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
