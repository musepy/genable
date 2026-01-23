import { h, Fragment as PreactFragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Sparkles, ChevronDown, AlertCircle } from 'lucide-preact' // Added AlertCircle
import { tokens } from '../../ui/design-system/tokens'
import {
  derivePluginState,
  getElementState,
} from '../../ui/index'
import { PromptChips } from '../../ui/components/PromptChips'
import { PromptInput } from '../../ui/components/PromptInput'
import { ThinkingCard } from '../../ui/components/ThinkingCard'
import { MessageRenderer } from '../../ui/components/MessageRenderer'
import { ThinkingStream } from '../../ui/components/ThinkingStream'
import { RawOutputPanel } from '../../ui/components/RawOutputPanel'
import { ModelPopover } from '../../ui/components/ModelPopover'
import { Button } from '../../ui/components/Button' // Added Button
import type { PluginState } from '../../ui/index'

import { useChat, UseChatProps } from './useChat'
import { useSmartScroll } from '../../hooks/useSmartScroll'
import { t } from '../../ui/i18n'
import { categorizeError } from '../../engine/llm-client/errorCategorizer'
import type { ErrorActionType } from '../../config/errorPatterns'

// Inline styles
const messagesContainerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
  padding: tokens.space[4],
  gap: tokens.space[2],
};

const messageBubbleUserStyle = {
  background: tokens.colors.surface,
  color: tokens.colors.textPrimary,
  borderRadius: 'var(--radius-5)',
  padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
  alignSelf: 'flex-end' as const,
  maxWidth: '80%',
};

const messageBubbleModelStyle = {
  background: tokens.colors.bg2,
  border: `1px solid ${tokens.colors.border}`,
  borderRadius: 'var(--radius-5)',
  padding: tokens.space[4],
  alignSelf: 'flex-start' as const,
  maxWidth: '100%',
};

// ------------------------------------------------------------------
// Error Handling System (Type-Safe & HIG Compliant)
// ------------------------------------------------------------------

// 1. Action Types (Logic) - Imported from errorPatterns


// 2. Config Structure
interface ErrorConfig {
  i18nKey: keyof typeof t.errors;
  handler: ErrorActionType;
}

// 3. Error Parser & Config Mapper (Delegated to Service)
function getErrorConfig(errorMsg: string): ErrorConfig {
  return categorizeError(errorMsg) as ErrorConfig;
}

export function ChatFeature(props: UseChatProps) {
  const {
    prompt,
    setPrompt,
    history,
    loading,
    loadingStatus,
    error,
    setError,
    thinkingText,
    isThinkingStreaming,
    generate,
    setHistory,
    modelName,
    setModelName,
    apiKey,
    setApiKey,
    suggestedModels,
    onOpenSettings,
  } = useChat(props)

  const messagesEndRef = { current: null as HTMLDivElement | null };
  
  const {
    shouldAutoScroll,
    containerRef,
    anchorRef,
    showNewMessagesIndicator,
    scrollToBottom,
  } = useSmartScroll(history, { threshold: 100 });
  
  const [expandedRawIds, setExpandedRawIds] = useState<Set<number>>(new Set())
  
  // No longer using Toast for errors
  
  // Conditional scroll
  useEffect(() => {
    if (shouldAutoScroll) {
      anchorRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [history, thinkingText, shouldAutoScroll])

  const selectSavedPrompt = (title: string) => {
    const suggestion = t.promptSuggestions.find(s => s.title === title)
    if (suggestion) {
      setPrompt(suggestion.description)
    }
  }

  const pluginState: PluginState = derivePluginState({
    historyLength: history.length,
    loading,
    hasInput: !!prompt.trim(),
  });
  
  const chipsState = getElementState('promptChips', pluginState);
  const submitState = getElementState('submitButton', pluginState);
  const textareaState = getElementState('textarea', pluginState);
  
  const isEmpty = pluginState === 'EMPTY' || pluginState === 'TYPING';
  const canSubmit = submitState.enabled && !!prompt.trim();

  // Resolve Error Config
  const errorConfig = error ? getErrorConfig(error) : null;
  const errorContent = errorConfig ? t.errors[errorConfig.i18nKey] : null;

  // Action Handlers
  const errorActions: Record<ErrorActionType, () => void> = {
    openModelSelector: () => {
      // Logic to open model selector is typically via the Popover trigger, 
      // but here we might prompt user or just dismiss error so they can click it.
      // For now, simpler to just dismiss error and focus attention (or let user click).
      // Actually, we can't programmatically open the popover easily without context.
      // So we'll dismiss error to unblock UI. Ideally we'd trigger the popover.
      setError(null);
    },
    openSettings: () => {
      setError(null);
      onOpenSettings?.();
    },
    retry: () => {
      setError(null);
      generate();
    },
    dismiss: () => setError(null),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Messages Area */}
      <div style={messagesContainerStyle}>
        
        {/* Empty State */}
        {isEmpty && (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'flex-start', 
            flex: 1,
            gap: tokens.space[2],
            color: tokens.colors.textSecondary,
            textAlign: 'center',
            paddingTop: tokens.space[5],
          }}>
            <Sparkles size={24} strokeWidth={1.5} style={{ color: tokens.colors.primary }} />
            <span style={{ fontSize: tokens.fontSize[2] }}>{t.emptyStateHint}</span>
            
            <PromptChips
              suggestions={t.promptSuggestions}
              onSelect={selectSavedPrompt}
              visible={chipsState.visible}
              enabled={chipsState.enabled}
            />
          </div>
        )}

        {/* Message Loop */}
        {!isEmpty && history.map((msg, i) => {
          const isUserMessage = msg.role === 'user';
          
          const prevRole = i > 0 ? history[i - 1].role : null;
          const isCrossRole = prevRole !== null && prevRole !== msg.role;
          const marginTop = i === 0 ? 0 : (isCrossRole ? tokens.space[5] : tokens.space[1]);
          
          if (!isUserMessage && msg.thinking) {
            const isRawExpanded = expandedRawIds.has(i);
            const toggleRaw = () => {
              setExpandedRawIds(prev => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              });
            };
            
            return (
              <div key={i} style={{ marginTop, maxWidth: '100%' }}>
                <ThinkingCard 
                  summary={msg.text} 
                  thinking={msg.thinking} 
                />
                
                {msg.rawOutput && (
                  <PreactFragment>
                    <button
                      onClick={toggleRaw}
                      className="ghost-btn"
                      style={{
                        marginTop: tokens.space[1],
                        padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
                        background: 'transparent',
                        border: 'none',
                        color: tokens.colors.textSecondary,
                        fontSize: tokens.fontSize[1],
                        cursor: 'pointer',
                      }}
                    >
                      {isRawExpanded ? t.hideRaw : t.showRaw}
                    </button>
                    <RawOutputPanel 
                      content={msg.rawOutput}
                      isExpanded={isRawExpanded}
                      onToggle={toggleRaw}
                    />
                  </PreactFragment>
                )}
              </div>
            );
          }
          
          const bubbleStyle = isUserMessage 
            ? messageBubbleUserStyle 
            : messageBubbleModelStyle;
          
          return (
            <div 
              key={i} 
              className="message-enter"
              style={{ ...bubbleStyle as any, marginTop }}
            >
              {isUserMessage ? (
                <span style={{ fontSize: tokens.fontSize[1], wordBreak: 'break-word', lineHeight: '1.4' }}>{msg.text}</span>
              ) : (
                <MessageRenderer content={msg.text} level="L3" />
              )}
            </div>
          );
        })}

        {/* Thinking Stream */}
        {loading && (
          <ThinkingStream
            status={loadingStatus}
            isStreaming={isThinkingStreaming}
            onSkip={() => {}}
          />
        )}
        
        <div ref={(el) => { anchorRef.current = el }} />
        
        {/* New Messages Indicator */}
        {showNewMessagesIndicator && (
          <button
            className="ghost-btn"
            onClick={scrollToBottom}
            style={{
              position: 'sticky',
              bottom: tokens.space[2],
              left: '50%',
              transform: 'translateX(-50%)',
              padding: `${tokens.space[1]}px ${tokens.space[3]}px`,
              borderRadius: 'var(--radius-full)',
              background: tokens.colors.solid,
              color: tokens.colors.solidForeground,
              fontSize: tokens.fontSize[1],
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[1],
              border: 'none',
              cursor: 'pointer',
              boxShadow: tokens.colors.shadow, // Replaced rgba(0,0,0,0.15)
              zIndex: 10,
            }}
          >
            <span>{t.newMessages}</span>
            <ChevronDown size={12} />
          </button>
        )}
      </div>

      {/* Input Area - Parent controls spacing (隔离式原则) */}
      <div style={{ padding: `0 ${tokens.space[2]}px ${tokens.space[2]}px ${tokens.space[2]}px` }}>
        {/* Inline Error Banner - Refined UI */}
        {error && errorConfig && errorContent && (
           <div className="message-enter" style={{
             background: tokens.colors.errorMuted,
             border: `1px solid ${tokens.colors.errorBorder}`,
             borderRadius: 'var(--radius-3)',
             padding: `${tokens.space[2]}px ${tokens.space[3]}px`, // Reduced padding
             margin: `0 ${tokens.space[4]}px`,
             marginBottom: tokens.space[2], // Detached from input, proper spacing
             display: 'flex',
             alignItems: 'center', // Strict vertical centering
             justifyContent: 'space-between',
             gap: tokens.space[3],
           }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], flex: 1, minWidth: 0 }}>
               <AlertCircle size={14} color={tokens.colors.error} style={{ flexShrink: 0 }} />
               <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], overflow: 'hidden' }}>
                 <span style={{ 
                   fontSize: tokens.fontSize[1], 
                   fontWeight: 500, // Reduced from 600
                   color: tokens.colors.error,
                   whiteSpace: 'nowrap',
                   flexShrink: 0
                 }}>
                   {errorContent.title}
                 </span>
                 <span style={{ 
                   fontSize: tokens.fontSize[1], // Same size as title
                   color: tokens.colors.textSecondary,
                   overflow: 'hidden', 
                   textOverflow: 'ellipsis', 
                   whiteSpace: 'nowrap'
                 }}>
                   {errorContent.message}
                 </span>
               </div>
             </div>
             
             {/* Text-only button (Apple style inline action) */}
             <button
               onClick={errorActions[errorConfig.handler]}
               style={{ 
                 background: 'none',
                 border: 'none',
                 padding: 0,
                 color: tokens.colors.error, // Use error color or primary? Error color usually for destructive, maybe Standard Blue? 
                 // HIG: "Use a color that harmonizes...". Usually actions in red alerts are red or black. 
                 // Let's use standard text color or system blue.
                 // Actually, for an error banner, typically the action is semantic.
                 fontSize: tokens.fontSize[1],
                 fontWeight: 600,
                 cursor: 'pointer',
                 flexShrink: 0,
               }}
             >
               {errorContent.action}
             </button>
           </div>
        )}
        
        <PromptInput
          value={prompt}
          onChange={(v) => setPrompt(v)}
          onSubmit={generate}
          loading={loading}
          disabled={!textareaState.enabled}
          placeholder={t.placeholder}
          canSubmit={canSubmit}
          leftElement={
            <ModelPopover
              currentModel={modelName}
              apiKey={apiKey}
              availableModels={suggestedModels}
              onSelectModel={setModelName || (() => {})}
              onApiKeyChange={setApiKey || (() => {})}
              onOpenSettings={onOpenSettings}
              placement="top"
              variant="ghost"
            />
          }
        />
      </div>
    </div>
  )
}
