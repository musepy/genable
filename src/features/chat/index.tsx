import { h, Fragment as PreactFragment, Fragment } from 'preact'
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
import { ToolExecutionPanel } from '../../ui/components/ToolExecutionPanel'
import { IterationCard } from '../../ui/components/IterationCard'
import { RawOutputPanel } from '../../ui/components/RawOutputPanel'
import { ModelPopover } from '../../ui/components/ModelPopover'
import { Button } from '../../ui/components/Button'
import { Copy, Code } from 'lucide-preact'
import { on, emit } from '@create-figma-plugin/utilities'
import { SendSerializedSelectionHandler, SerializeSelectionHandler } from '../../types'
import { useClipboard } from '../../ui/hooks/useClipboard'
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
  background: tokens.colors.alpha[2],
  color: tokens.colors.textPrimary,
  borderRadius: 'var(--radius-6)',
  padding: `${tokens.space[3]}px ${tokens.space[5]}px`,
  alignSelf: 'flex-start' as const,
  maxWidth: '100%',
};

const messageBubbleModelStyle = {
  borderRadius: 'var(--radius-6)',
  padding: `${tokens.space[4]}px ${tokens.space[5]}px`,
  alignSelf: 'flex-start' as const,
  maxWidth: '100%',
};

const messageBubbleResultStyle = {
  background: tokens.colors.accentAlpha[2],
  borderRadius: 'var(--radius-6)',
  padding: `${tokens.space[4]}px ${tokens.space[5]}px`,
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

function ErrorBanner({ error, errorActions }: { 
  error: string | null; 
  errorActions: Record<ErrorActionType, () => void> 
}) {
  if (!error) return null;
  const config = getErrorConfig(error);
  const content = t.errors[config.i18nKey];
  if (!content) return null;

  return (
    <div className="message-enter" style={{
      background: tokens.colors.errorMuted,
      border: `1px solid ${tokens.colors.errorBorder}`,
      borderRadius: 'var(--radius-3)',
      padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
      margin: `0 ${tokens.space[4]}px`,
      marginBottom: tokens.space[2],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokens.space[3],
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], flex: 1, minWidth: 0 }}>
        <AlertCircle size={14} color={tokens.colors.error} style={{ flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], overflow: 'hidden' }}>
          <span style={{ fontSize: tokens.fontSize[1], fontWeight: 500, color: tokens.colors.error, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {content.title}
          </span>
          <span style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {content.message}
          </span>
        </div>
      </div>
      <button
        onClick={errorActions[config.handler]}
        style={{ background: 'none', border: 'none', padding: 0, color: tokens.colors.error, fontSize: tokens.fontSize[1], fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
      >
        {content.action}
      </button>
    </div>
  );
}

function MessageList({ history, expandedRawIds, toggleRaw, currentToolCalls, iterations, loading, anchorRef }: {
  history: any[];
  expandedRawIds: Set<number>;
  toggleRaw: (id: number) => void;
  currentToolCalls: any[];
  iterations: any[];
  loading: boolean;
  anchorRef: any;
}) {
  const isEmpty = history.length === 0 && !loading;

  if (isEmpty) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', flex: 1, gap: tokens.space[2], color: tokens.colors.textSecondary, textAlign: 'center', paddingTop: tokens.space[5] }}>
        <Sparkles size={24} strokeWidth={1.5} style={{ color: tokens.colors.accent }} />
        <span style={{ fontSize: tokens.fontSize[2] }}>{t.emptyStateHint}</span>
        {/* Chips are handled in the parent for now to access setPrompt */}
      </div>
    );
  }

  return (
    <Fragment>
      {history.map((msg, i) => {
        const isUserMessage = msg.role === 'user';
        const prevRole = i > 0 ? history[i - 1].role : null;
        const isCrossRole = prevRole !== null && prevRole !== msg.role;
        const marginTop = i === 0 ? 0 : (isCrossRole ? tokens.space[5] : tokens.space[1]);

        if (!isUserMessage && msg.thinking) {
          const isRawExpanded = expandedRawIds.has(i);
          return (
            <div key={i} style={{ marginTop, maxWidth: '100%' }}>
              <ThinkingCard summary={msg.text} thinking={msg.thinking} />
              {msg.rawOutput && (
                <Fragment>
                  <button onClick={() => toggleRaw(i)} className="ghost-btn" style={{ marginTop: tokens.space[1], padding: `${tokens.space[1]}px ${tokens.space[2]}px`, background: 'transparent', border: 'none', color: tokens.colors.textSecondary, fontSize: tokens.fontSize[1], cursor: 'pointer' }}>
                    {isRawExpanded ? t.hideRaw : t.showRaw}
                  </button>
                  <RawOutputPanel content={msg.rawOutput} isExpanded={isRawExpanded} onToggle={() => toggleRaw(i)} />
                </Fragment>
              )}
            </div>
          );
        }

        const hasToolCalls = !isUserMessage && msg.toolCalls && msg.toolCalls.length > 0;
        const bubbleStyle = isUserMessage
          ? messageBubbleUserStyle
          : (hasToolCalls ? messageBubbleResultStyle : messageBubbleModelStyle);

        return (
          <div key={i} className="message-enter" style={{ ...bubbleStyle as any, marginTop }}>
            {isUserMessage ? (
              <span style={{ fontSize: tokens.fontSize[2], wordBreak: 'break-word', lineHeight: 'var(--typography-line-height-3)' }}>{msg.text}</span>
            ) : (
              <Fragment>
                {hasToolCalls && <ToolExecutionPanel toolCalls={msg.toolCalls} />}
                <MessageRenderer content={msg.text} level="L3" />
                {msg.iterations && msg.iterations.length > 0 && (
                  <div style={{ marginTop: tokens.space[2], borderTop: `1px solid ${tokens.colors.grayBorder}`, paddingTop: tokens.space[2] }}>
                    {msg.iterations.map((it: any, idx: number) => <IterationCard key={idx} iteration={it} />)}
                  </div>
                )}
              </Fragment>
            )}
          </div>
        );
      })}

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
          {iterations.map((it, idx) => (
            <IterationCard key={idx} iteration={it} isStreaming={idx === iterations.length - 1} />
          ))}
          <ToolExecutionPanel toolCalls={currentToolCalls} />
        </div>
      )}
      <div ref={anchorRef} />
    </Fragment>
  );
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
    providerName, // [NEW]
    tokenUsage, // [NEW]
    currentToolCalls, // [NEW]
    iterations // [NEW]
  } = useChat(props)

  const { copy } = useClipboard()

  useEffect(() => {
    return on<SendSerializedSelectionHandler>('SEND_SERIALIZED_SELECTION', (data) => {
      copy(data.jsonString);
      // Optional: also put it in the prompt to show it works
      setPrompt(data.jsonString);
    });
  }, [copy, setPrompt]);

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
      <div style={messagesContainerStyle} ref={containerRef}>
        <MessageList 
          history={history}
          expandedRawIds={expandedRawIds}
          toggleRaw={(id) => setExpandedRawIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          currentToolCalls={currentToolCalls}
          iterations={iterations}
          loading={loading}
          anchorRef={anchorRef}
        />

        {isEmpty && chipsState.visible && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: tokens.space[2] }}>
            <PromptChips
              suggestions={t.promptSuggestions}
              onSelect={selectSavedPrompt}
              visible={chipsState.visible}
              enabled={chipsState.enabled}
            />
          </div>
        )}
        
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
              background: tokens.colors.accent,
              color: tokens.colors.accentContrast,
              fontSize: tokens.fontSize[1],
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[1],
              border: 'none',
              cursor: 'pointer',
              boxShadow: tokens.colors.shadow,
              zIndex: 10,
            }}
          >
            <span>{t.newMessages}</span>
            <ChevronDown size={12} />
          </button>
        )}
      </div>

      {/* Input Area — floating with backdrop blur */}
      <div style={{
        position: 'sticky' as const,
        bottom: 0,
        padding: `${tokens.space[6]}px ${tokens.space[2]}px ${tokens.space[4]}px`,
        background: 'linear-gradient(to top, var(--color-background) 0%, rgba(255,255,255,0.8) 50%, transparent 100%)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        zIndex: 10,
      }}>
        {tokenUsage && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: tokens.space[2], padding: `0 ${tokens.space[2]}px`, gap: tokens.space[3], fontSize: tokens.fontSize.xs, color: tokens.colors.textSecondary }}>
            <span>Input: {tokenUsage.promptTokens}</span>
            <span>Output: {tokenUsage.completionTokens}</span>
            <span>Total: {tokenUsage.totalTokens}</span>
          </div>
        )}

        <ErrorBanner error={error} errorActions={errorActions} />
        
        <PromptInput
          value={prompt}
          onChange={(v) => setPrompt(v)}
          onSubmit={generate}
          loading={loading}
          disabled={!textareaState.enabled}
          placeholder={t.placeholder}
          canSubmit={canSubmit}
          leftElement={
            <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[1] }}>
              <ModelPopover
                currentModel={modelName}
                apiKey={apiKey}
                availableModels={suggestedModels}
                onSelectModel={setModelName || (() => {})}
                onApiKeyChange={setApiKey || (() => {})}
                onOpenSettings={onOpenSettings}
                placement="top"
                variant="ghost"
                providerName={providerName} // [NEW]
              />
              <button
                className="ghost-btn"
                onClick={() => emit<SerializeSelectionHandler>('SERIALIZE_SELECTION')}
                title="Serialize Selection to DSL (Dogfood)"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: tokens.space[1],
                  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
                  background: 'transparent',
                  border: 'none',
                  color: tokens.colors.textSecondary,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-1)',
                  transition: 'var(--transition-crisp)',
                }}
                onMouseEnter={(e) => {
                   e.currentTarget.style.color = tokens.colors.textPrimary;
                   e.currentTarget.style.background = tokens.colors.surface;
                }}
                onMouseLeave={(e) => {
                   e.currentTarget.style.color = tokens.colors.textSecondary;
                   e.currentTarget.style.background = 'transparent';
                }}
              >
                <Code size={14} />
              </button>
            </div>
          }
        />
      </div>
    </div>
  )
}
