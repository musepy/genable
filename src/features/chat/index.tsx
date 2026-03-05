import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Sparkles } from 'lucide-preact'
import { tokens } from '../../ui/design-system/tokens'
import {
  derivePluginState,
  getElementState,
} from '../../ui/index'
import { PromptChips } from '../../ui/components/PromptChips'
import { PromptInput } from '../../ui/components/PromptInput'
import { MessageRenderer } from '../../ui/components/MessageRenderer'
import { ToolExecutionPanel } from '../../ui/components/ToolExecutionPanel'
import { NodeListPanel } from '../../ui/components/NodeListPanel'
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
import type { ErrorActionType } from '../../config/errorPatterns'

// Inline styles — flat transcript layout
const messagesContainerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto' as const,
  padding: `${tokens.space[3]}px ${tokens.space[3]}px`,
  paddingBottom: tokens.space[1],
};

// Model messages: plain left-aligned text
const messageItemStyle = {
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  width: '100%',
  userSelect: 'text' as const,
  WebkitUserSelect: 'text' as const,
};

// User messages: subtle background to distinguish
const userItemStyle = {
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
  width: '100%',
  background: tokens.colors.alpha[2],
  borderRadius: 'var(--radius-4)',
  userSelect: 'text' as const,
  WebkitUserSelect: 'text' as const,
};

function MessageList({ history, expandedRawIds, toggleRaw, loading, loadingStatus, reasoningText, runtimePhase, runtimeProgress, runtimeContextUsage, runtimeState, queuedCount, onStop, onContinue, onErrorAction, anchorRef }: {
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
  onErrorAction: (action: ErrorActionType) => void;
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

        const safeText = typeof msg.text === 'string' ? msg.text : String(msg.text ?? '');

        const lastIteration = msg.iterations?.[msg.iterations.length - 1];
        const thinkingStatus = msg.streaming ? (loadingStatus || 'Thinking...') : undefined;
        const reasoningPreview = msg.streaming ? reasoningText : undefined;

        const shouldShowToolGroup = !isUserMessage && (
          (msg.toolCalls && msg.toolCalls.length > 0) ||
          !!thinkingStatus ||
          !!reasoningPreview ||
          !!msg.runState
        );

        return (
          <div key={msg.id || `msg-${i}`} style={{ ...(isUserMessage ? userItemStyle : messageItemStyle), marginTop }}>
            {isUserMessage ? (
              <span style={{ fontSize: tokens.fontSize[1], wordBreak: 'break-word', lineHeight: 'var(--typography-line-height-2)', color: tokens.colors.textPrimary }}>
                {safeText}
              </span>
            ) : (
              <Fragment>
                {shouldShowToolGroup && (
                  <Fragment>
                    <ToolExecutionPanel
                      toolCalls={msg.toolCalls}
                      llmCalls={msg.llmCalls}
                      thinkingStatus={thinkingStatus}
                      reasoningPreview={reasoningPreview}
                      currentTaskTitle={lastIteration?.taskTitle}
                      phase={msg.streaming ? runtimePhase : undefined}
                      progress={msg.streaming ? runtimeProgress : null}
                      contextUsage={msg.streaming ? runtimeContextUsage : null}
                      runState={msg.streaming ? runtimeState : (msg.runState as any)}
                      runError={msg.runError}
                      taskStartTime={msg.startTime}
                      taskEndTime={msg.endTime}
                      queuedCount={msg.streaming ? queuedCount : 0}
                      onStop={onStop}
                      onContinue={onContinue}
                      onErrorAction={onErrorAction}
                    />
                    {!msg.streaming && (
                      <NodeListPanel toolCalls={msg.toolCalls || []} />
                    )}
                  </Fragment>
                )}

                {safeText && <MessageRenderer content={safeText} level="L3" />}

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
    openSettings: () => {
      setError(null);
      onOpenSettings?.();
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
          onErrorAction={(action) => errorActions[action]()}
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
