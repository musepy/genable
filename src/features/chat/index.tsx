import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Sparkles, AlertCircle } from 'lucide-preact'
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
import { FileText } from 'lucide-preact'
import { generateLogDigest } from './logDigest'
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
  minHeight: 0, // CRITICAL for shrinking
  overflowY: 'auto' as const,
  padding: `${tokens.space[3]}px ${tokens.space[3]}px`,
  paddingBottom: tokens.space[3],
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
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-4)',
  padding: 0,
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
  const [showDetails, setShowDetails] = useState(false)
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
      marginBottom: tokens.space[2],
      display: 'flex',
      flexDirection: 'column',
      gap: tokens.space[1],
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.space[2], minWidth: 0 }}>
        <AlertCircle size={14} color={tokens.colors.error} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: tokens.fontSize[1], fontWeight: 500, color: tokens.colors.error, minWidth: 0 }}>
          {content.title}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: tokens.space[2] }}>
          <button
            onClick={() => setShowDetails(v => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: tokens.colors.textSecondary,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {showDetails ? 'Hide details' : 'Details'}
          </button>
          <button
            onClick={errorActions[config.handler]}
            style={{ background: 'none', border: 'none', padding: 0, color: tokens.colors.error, fontSize: tokens.fontSize[1], fontWeight: 500, cursor: 'pointer' }}
          >
            {content.action}
          </button>
        </div>
      </div>
      <div style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary, lineHeight: '16px', whiteSpace: 'normal' }}>
        {content.message}
      </div>
      {showDetails && (
        <pre style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 120,
          overflow: 'auto',
          fontSize: 11,
          lineHeight: '15px',
          color: tokens.colors.textSecondary,
          background: tokens.colors.alpha[1],
          borderRadius: 'var(--radius-2)',
          padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
        }}>
          {error}
        </pre>
      )}
    </div>
  );
}

function MessageList({ history, expandedRawIds, toggleRaw, loading, loadingStatus, reasoningText, runtimePhase, runtimeProgress, runtimeContextUsage, runtimeState, queuedCount, onStop, onContinue, anchorRef }: {
  history: any[];
  expandedRawIds: Set<number>;
  toggleRaw: (id: number) => void;
  loading: boolean;
  loadingStatus?: string;
  reasoningText?: string;
  runtimePhase: any;
  runtimeProgress: { iteration: number; maxIterations: number } | null;
  runtimeContextUsage: any;
  runtimeState: 'idle' | 'running' | 'completed' | 'canceled' | 'error';
  queuedCount: number;
  onStop: () => void;
  onContinue: () => void;
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
        const marginTop = i === 0 ? 0 : (isCrossRole ? tokens.space[3] : tokens.space[1]);

        const hasToolCalls = !isUserMessage && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
        const bubbleStyle = isUserMessage
          ? messageBubbleUserStyle
          : (hasToolCalls ? messageBubbleResultStyle : messageBubbleModelStyle);

        const safeText = typeof msg.text === 'string' ? msg.text : String(msg.text ?? '');

        const lastIteration = msg.iterations?.[msg.iterations.length - 1];
        const thinkingStatus = msg.streaming ? (loadingStatus || 'Thinking...') : undefined;
        const reasoningPreview = msg.streaming ? reasoningText : undefined;

        const shouldShowToolGroup = !isUserMessage && (
          (msg.toolCalls && msg.toolCalls.length > 0) ||
          !!thinkingStatus ||
          !!reasoningPreview
        );

        return (
          <div key={msg.id || `msg-${i}`} className="message-enter" style={{ ...bubbleStyle as any, marginTop }}>
            {isUserMessage ? (
              <span style={{ fontSize: tokens.fontSize[1], wordBreak: 'break-word', lineHeight: 'var(--typography-line-height-2)' }}>
                {safeText}
              </span>
            ) : (
              <Fragment>
                {shouldShowToolGroup && (
                  <div style={{ marginBottom: tokens.space[3] }}>
                    <ToolExecutionPanel
                      toolCalls={msg.toolCalls}
                      thinkingStatus={thinkingStatus}
                      reasoningPreview={reasoningPreview}
                      currentTaskTitle={lastIteration?.taskTitle}
                      phase={msg.streaming ? runtimePhase : undefined}
                      progress={msg.streaming ? runtimeProgress : null}
                      contextUsage={msg.streaming ? runtimeContextUsage : null}
                      runState={msg.streaming ? runtimeState : undefined}
                      queuedCount={msg.streaming ? queuedCount : 0}
                      onStop={onStop}
                      onContinue={onContinue}
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
    generate,
    stopGeneration,
    continueGeneration,
    queuedCount,
    modelName,
    setModelName,
    apiKey,
    setApiKey,
    suggestedModels,
    onOpenSettings,
    providerName,
    runtimeState,
    runtimePhase,
    runtimeProgress,
    runtimeContextUsage,
  } = useChat(props)

  const { copy } = useClipboard()

  useEffect(() => {
    return on<SendSerializedSelectionHandler>('SEND_SERIALIZED_SELECTION', (data) => {
      copy(data.jsonString);
      // Optional: also put it in the prompt to show it works
      setPrompt(data.jsonString);
    });
  }, [copy, setPrompt]);

  const {
    shouldAutoScroll,
    containerRef,
    anchorRef,
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

  const isEmpty = pluginState === 'EMPTY' || pluginState === 'TYPING';
  const canSubmit = !!prompt.trim();

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
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {/* Messages Area */}
      <div style={messagesContainerStyle} ref={containerRef} className="messages-mask">
        <MessageList
          history={history}
          expandedRawIds={expandedRawIds}
          toggleRaw={(id) => setExpandedRawIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          loading={loading}
          loadingStatus={loadingStatus}
          reasoningText={thinkingText}
          runtimePhase={runtimePhase}
          runtimeProgress={runtimeProgress}
          runtimeContextUsage={runtimeContextUsage}
          runtimeState={runtimeState}
          queuedCount={queuedCount}
          onStop={stopGeneration}
          onContinue={continueGeneration}
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

      {/* Input Area — Flex-anchored at bottom */}
      <div style={{
        flexShrink: 0, // Prevent input itself from shrinking
        padding: `0 ${tokens.space[3]}px ${tokens.space[3]}px`,
        background: tokens.colors.background, 
        zIndex: 10,
        position: 'relative',
      }}>
        <ErrorBanner error={error} errorActions={errorActions} />
        
        {history.length > 0 && !loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: tokens.space[2] }}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<FileText size={12} />}
              onClick={() => {
                const digest = generateLogDigest(history, { modelName });
                copy(digest);
              }}
              style={{ color: tokens.colors.textSecondary }}
            >
              Copy Digest
            </Button>
          </div>
        )}

        <PromptInput
          value={prompt}
          onChange={(v) => setPrompt(v)}
          onSubmit={generate}
          loading={loading}
          disabled={false}
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
          onSkillSelect={(skillId) => {
            const skillToken = `@${skillId}`
            if (prompt.includes(skillToken)) return
            const current = prompt.trim()
            const next = current ? `${current} ${skillToken} ` : `${skillToken} `
            setPrompt(next)
          }}
        />
      </div>
    </div>
  )
}
