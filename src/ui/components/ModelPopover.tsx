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
import { Settings, ChevronRight } from 'lucide-preact';
import { tokens, componentStyles } from '../design-system/tokens';
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
  
  // P4: Layout variants
  placement?: 'bottom' | 'top';  // Popover 弹出方向
  variant?: 'chip' | 'ghost';    // 触发器样式
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
}: ModelPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [localApiKey, setLocalApiKey] = useState(apiKey);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (!isOpen || isClosing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  // Smooth close with exit animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 100); // Match popoverOut duration
  };

  // Use dynamic models from props
  const sortedModels = sortModels(availableModels.length > 0 ? availableModels : SUPPORTED_MODELS, currentModel);
  const hasApiKey = !!apiKey;

  const handleSelect = (modelName: string) => {
    onSelectModel(modelName);
    handleClose();
  };

  const handleApiKeySubmit = () => {
    if (localApiKey.length >= 20) {
      onApiKeyChange(localApiKey);
    }
  };

  // Determine thinking level label for Gemini 3.0+ models using SSOT utility
  const isGemini3 = isGemini3Family(currentModel);
  const levelLabel = isGemini3 
    ? (thinkingLevel === 'high' ? ' (High)' : thinkingLevel === 'low' ? ' (Low)' : ' (Min)')
    : '';
  const baseText = displayName || currentModel.split('/').pop()?.replace(/-/g, ' ') || 'Select Model';
  const chipText = baseText + levelLabel;

  // Trigger styles based on variant
  const triggerStyle = variant === 'ghost' 
    ? {
        ...componentStyles.modelSelector.ghost,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }
    : {
        display: 'inline-flex',
        alignItems: 'center',
        gap: tokens.space[1],
        padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
        background: tokens.colors.bg2, // Migrated from colors.card
        color: tokens.colors.textPrimary,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: 'var(--radius-full)',
        fontSize: tokens.fontSize[1],
        fontWeight: tokens.fontWeight.medium,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'var(--transition-crisp)',
      };
  
  // Popover position based on placement
  const popoverPositionStyle = placement === 'top'
    ? { bottom: `calc(100% + ${tokens.space[2]}px)`, top: 'auto', left: 0 }
    : { top: `calc(100% + ${tokens.space[2]}px)`, bottom: 'auto', left: 0 };

  // Arrow direction based on placement
  const arrowIcon = placement === 'top' 
    ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>;

  return (
    <div ref={popoverRef} style={{ position: 'relative' }}>
      {/* Trigger - variant based style */}
      <button
        className={variant === 'ghost' ? 'ghost-btn' : 'chip'}
        style={triggerStyle as h.JSX.CSSProperties}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onMouseEnter={(e) => {
          if (disabled) return;
          if (variant === 'chip') {
            e.currentTarget.style.borderColor = tokens.colors.borderHover;
          }
        }}
        onMouseLeave={(e) => {
          if (variant === 'chip') {
            e.currentTarget.style.borderColor = tokens.colors.border;
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {chipText}
        {arrowIcon}
      </button>

      {/* Popover Content */}
      {isOpen && (
        <div
          className={isClosing ? 'popover-content-exit' : 'popover-content'}
          style={{
            position: 'absolute',
            ...popoverPositionStyle,
            width: 'min(260px, calc(100vw - 32px))', // Responsive: max 260px, respects container
            minWidth: 200,
            background: tokens.colors.bg2, // Migrated from colors.card
            borderRadius: 'var(--radius-5)',
            boxShadow: tokens.colors.shadow, // Replaced rgba(0,0,0,0.12)
            zIndex: 50,
            overflow: 'hidden',
          }}
        >
          {/* Model List - instant display using hardcoded SUPPORTED_MODELS */}
          {hasApiKey && (
            <div role="listbox" aria-label="Select model" style={{ padding: tokens.space[1] }}>
              {sortedModels.map((model, index) => {
                // Extremely robust normalization: remove all non-alphanumeric, and treat "30" same as "3"
                const normalize = (name: string) => name.toLowerCase().replace(/models\//, '').replace(/[^a-z0-9]/g, '');
                const isSelected = normalize(currentModel) === normalize(model.name);
                
                // Fallback: If it's the first model and we have NO matches yet, show it as selected
                // (This helps if the saved model name is completely corrupted or incompatible)
                const shouldHighlight = isSelected || (index === 0 && !sortedModels.some(m => normalize(currentModel) === normalize(m.name)));
                
                return (
                  <div
                    key={model.name}
                    role="option"
                    aria-selected={isSelected}
                    className="popover-item"
                    onClick={() => handleSelect(model.name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: `0 ${tokens.space[2]}px`, // Radix space[2] (8px) horizontal
                      height: tokens.space[6],          // Radix space[6] (32px)
                      borderRadius: 'var(--radius-2)',
                      margin: '2px 0', // Optical: list item separation
                      cursor: 'pointer',
                      background: shouldHighlight ? tokens.colors.surfaceHover : 'transparent',
                    }}
                  >
                    <span style={{ 
                      fontSize: tokens.fontSize[1],     // Same as trigger (12px)
                      color: tokens.colors.textPrimary, // Unified color
                      fontWeight: tokens.fontWeight.normal,
                    }}>
                      {model.displayName || model.name}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Settings Section (Apple HIG: settings at bottom) */}
          <div style={{ 
            padding: tokens.space[1],
            borderTop: hasApiKey ? `1px solid ${tokens.colors.borderLight}` : 'none',
          }}>
            {hasApiKey ? (
              // API Key Settings link
              <div 
                className="popover-item"
                onClick={() => { handleClose(); onOpenSettings?.(); }}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: tokens.space[2],           // Radix space[2] (8px)
                  padding: `0 ${tokens.space[2]}px`, // Horizontal padding only
                  height: tokens.space[6],        // Radix space[6] (32px)
                  borderRadius: 'var(--radius-2)',
                  cursor: 'pointer',
                  color: tokens.colors.textPrimary, // Unified with list items
                  fontSize: tokens.fontSize[1],   // Same as trigger (12px)
                }}
              >
                <Settings size={14} strokeWidth={2} />
                <span>API Key Settings</span>
                <ChevronRight size={10} strokeWidth={2} style={{ marginLeft: 'auto' }} />
              </div>
            ) : (
              // API Key Input (if not configured)
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], padding: tokens.space[1] }}>
                <span style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
                  Enter API Key to start
                </span>
                <div style={{ display: 'flex', gap: tokens.space[1] }}>
                  <input
                    type="password"
                    value={localApiKey}
                    onInput={(e) => setLocalApiKey((e.target as HTMLInputElement).value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                    placeholder="Gemini API Key"
                    style={{
                      flex: 1,
                      padding: tokens.space[1],
                      fontSize: tokens.fontSize[1],
                      background: tokens.colors.bg1, // Migrated from colors.background
                      border: `1px solid ${tokens.colors.border}`,
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
                      background: localApiKey.length >= 20 ? tokens.colors.solid : tokens.colors.surface,
                      color: localApiKey.length >= 20 ? tokens.colors.solidForeground : tokens.colors.textSecondary,
                      border: 'none',
                      borderRadius: 'var(--radius-4)',
                      fontSize: tokens.fontSize[1],
                      cursor: localApiKey.length >= 20 ? 'pointer' : 'default',
                    }}
                  >
                    Save
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
