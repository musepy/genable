import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Sparkles, ChevronDown, AlertCircle } from 'lucide-preact' // Added AlertCircle
import { tokens } from '../../ui/design-system/tokens'
import {
  derivePluginState,
  getElementState,
} from '../../ui/index'
import { PromptChips } from '../../ui/components/PromptChips'
import { PromptInput } from '../../ui/components/PromptInput'
import { MessageRenderer } from '../../ui/components/MessageRenderer'
import { ToolExecutionPanel } from '../../ui/components/ToolExecutionPanel'
import { RawOutputPanel } from '../../ui/components/RawOutputPanel'
import { ModelPopover } from '../../ui/components/ModelPopover'
import { Button } from '../../ui/components/Button'
import { Copy, Code } from 'lucide-preact'
import { on, emit } from '@create-figma-plugin/utilities'
import { SendSerializedSelectionHandler, SerializeSelectionHandler, SelectNodeHandler } from '../../types'
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
  padding: `${tokens.space[3]}px ${tokens.space[3]}px`,
  paddingBottom: tokens.space[1], 
  gap: tokens.space[1],
};

const messageBubbleUserStyle = {
  background: tokens.colors.alpha[2],
  color: tokens.colors.textPrimary,
  borderRadius: 'var(--radius-4)',
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  width: '100%',
};

const messageBubbleModelStyle = {
  borderRadius: 'var(--radius-4)',
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  width: '100%',
};

const messageBubbleResultStyle = {
  background: tokens.colors.accentAlpha[2],
  borderRadius: 'var(--radius-4)',
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  width: '100%',
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
        style={{ background: 'none', border: 'none', padding: 0, color: tokens.colors.error, fontSize: tokens.fontSize[1], fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}
      >
        {content.action}
      </button>
    </div>
  );
}

function MessageList({ history, expandedRawIds, toggleRaw, currentToolCalls, iterations, loading, loadingStatus, anchorRef }: {
  history: any[];
  expandedRawIds: Set<number>;
  toggleRaw: (id: number) => void;
  currentToolCalls: any[];
  iterations: any[];
  loading: boolean;
  loadingStatus?: string;
  anchorRef: any;
}) {
  const isEmpty = history.length === 0 && !loading;

  if (isEmpty) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', flex: 1, gap: tokens.space[2], color: tokens.colors.textSecondary, textAlign: 'center', paddingTop: tokens.space[5] }}>
        <Sparkles size={24} strokeWidth={1.5} style={{ color: tokens.colors.accent }} />
        <span style={{ 
          fontSize: tokens.fontSize[2],
          lineHeight: 'var(--typography-line-height-2)',
        }}>{t.emptyStateHint}</span>
        {/* Chips are handled in the parent for now to access setPrompt */}
      </div>
    );
  }

  return (
    <Fragment>
      {history.filter(msg => !msg.id?.startsWith('recovery_')).map((msg, i) => {
        const isUserMessage = msg.role === 'user';
        const prevRole = i > 0 ? history[i - 1].role : null;
        const isCrossRole = prevRole !== null && prevRole !== msg.role;
        const marginTop = i === 0 ? 0 : (isCrossRole ? tokens.space[5] : tokens.space[1]);

        const hasToolCalls = !isUserMessage && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
        const bubbleStyle = isUserMessage
          ? messageBubbleUserStyle
          : (hasToolCalls ? messageBubbleResultStyle : messageBubbleModelStyle);

        const safeText = typeof msg.text === 'string' ? msg.text : String(msg.text ?? '');

        const lastIteration = msg.iterations?.[msg.iterations.length - 1];
        const thinkingDetail = lastIteration?.thinking?.trim();
        const thinkingStatus = msg.streaming ? (loadingStatus || 'Thinking...') : undefined;

        const shouldShowToolGroup = !isUserMessage && (
          (msg.toolCalls && msg.toolCalls.length > 0) ||
          !!thinkingDetail ||
          !!thinkingStatus
        );

        return (
          <div key={msg.id || `msg-${i}`} className="message-enter" style={{ ...bubbleStyle as any, marginTop }}>
            {isUserMessage ? (
              <span style={{ fontSize: tokens.fontSize[1], wordBreak: 'break-word', lineHeight: 'var(--typography-line-height-3)' }}>
                {safeText}
              </span>
            ) : (
              <Fragment>
                {shouldShowToolGroup && (
                  <div style={{ marginBottom: tokens.space[3] }}>
                    <ToolExecutionPanel
                      toolCalls={msg.toolCalls}
                      thinkingStatus={thinkingStatus}
                      thinkingDetail={thinkingDetail}
                      onSelectNode={(nodeId) => {
                        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
                        emit<SelectNodeHandler>('SELECT_NODE', { nodeId, smooth: !reduce, durationMs: 250 });
                      }}
                    />
                  </div>
                )}

                {safeText ? <MessageRenderer content={safeText} level="L3" /> : <div />}

                {msg.rawOutput && (
                  <div style={{ marginTop: tokens.space[2] }}>
                    <button
                      onClick={() => toggleRaw(i)}
                      className="ghost-btn"
                      style={{ padding: `0 ${tokens.space[2]}px`, background: 'transparent', border: 'none', color: tokens.colors.textSecondary, fontSize: tokens.fontSize[1], cursor: 'pointer' }}
                    >
                      {expandedRawIds.has(i) ? t.hideRaw : t.showRaw}
                    </button>
                    <RawOutputPanel content={msg.rawOutput} isExpanded={expandedRawIds.has(i)} onToggle={() => toggleRaw(i)} />
                  </div>
                )}
              </Fragment>
            )}
          </div>
        );
      })}

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
          loadingStatus={loadingStatus}
          anchorRef={anchorRef}
        />

        {isEmpty && chipsState.visible && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 0 }}>
            <PromptChips
              suggestions={t.promptSuggestions}
              onSelect={selectSavedPrompt}
              visible={chipsState.visible}
              enabled={chipsState.enabled}
            />
          </div>
        )}

        {/* Scroll anchor for bottom */}
      </div>

      {/* Input Area — floating with backdrop blur */}
      <div style={{
        position: 'sticky' as const,
        bottom: 0,
        padding: tokens.space[3],
        background: 'linear-gradient(to top, var(--color-background) 0%, var(--color-background) 80%, transparent 100%)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        zIndex: 10,
      }}>
        {tokenUsage && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: tokens.space[2], padding: `0 ${tokens.space[2]}px`, gap: tokens.space[3], fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
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
            <ModelPopover
              currentModel={modelName}
              apiKey={apiKey}
              availableModels={suggestedModels}
              onSelectModel={setModelName || (() => {})}
              onApiKeyChange={setApiKey || (() => {})}
              onOpenSettings={onOpenSettings}
              placement="top"
              variant="ghost"
              align="end"
              providerName={providerName} // [NEW]
            />
          }
          onPlusClick={() => emit<SerializeSelectionHandler>('SERIALIZE_SELECTION')}
        />
      </div>
    </div>
  )
}
