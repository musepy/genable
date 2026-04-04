import { h, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { tokens } from '../../ui/design-system/tokens'
import {
  derivePluginState,
  getElementState,
} from '../../ui/index'
import { PromptChips } from '../../ui/components/PromptChips'
import { PromptInput } from '../../ui/components/PromptInput'
import { ToolBlock } from '../../ui/components/ToolBlock'
import { CanvasTextBlock as TextBlock } from '../../ui/components/canvas-markdown/CanvasTextBlock'
import { NodeListPanel } from '../../ui/components/NodeListPanel'
import { ModelPopover } from '../../ui/components/ModelPopover'
import { Button } from '../../ui/components/Button'
import { on, emit } from '@create-figma-plugin/utilities'
import {
  SendSelectionHandler, GetSelectionHandler,
  ContextAttachment,
} from '../../types'
import { ContextTag } from '../../ui/components/ContextTag'
import type { PluginState } from '../../ui/index'

import { useChat, UseChatProps } from './useChat'
import { useSmartScroll } from '../../hooks/useSmartScroll'
import { t } from '../../ui/i18n'
// ErrorActionType removed — error handling moved to StatusBlock
import type { ContentBlock } from '../../types/chat'

const TRIVIAL_TEXT_THRESHOLD = 20;

/** Merge consecutive tool_groups and skip trivial text fragments between them. */
function mergeBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const block of blocks) {
    // Skip trivial text fragments (LLM noise like "<", "row", "Semi")
    if (block.type === 'text' && block.content.trim().length < TRIVIAL_TEXT_THRESHOLD) continue;
    // Merge consecutive tool_groups
    if (block.type === 'tool_group') {
      const last = out[out.length - 1];
      if (last && last.type === 'tool_group') {
        out[out.length - 1] = { type: 'tool_group', tools: [...last.tools, ...block.tools] };
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

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

// Assistant messages: plain left-aligned text, no background
const messageItemStyle = {
  padding: `4px 10px`,
  width: '100%',
  userSelect: 'text' as const,
  WebkitUserSelect: 'text' as const,
};

// User messages: gray background, same padding as other blocks
const userItemStyle = {
  padding: '4px 10px',
  width: '100%',
  background: 'var(--gray-3)',
  borderRadius: 'var(--radius-3)',
  userSelect: 'text' as const,
  WebkitUserSelect: 'text' as const,
};

// ============================================
// StatusBlock — running / confirming stop / canceled / error
// ============================================

function StatusBlock({ runState, startTime, endTime, error, onStop, onContinue }: {
  runState: string;
  startTime?: number;
  endTime?: number;
  error?: string;
  onStop: () => void;
  onContinue: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [elapsed, setElapsed] = useState('');

  // Elapsed time ticker
  useEffect(() => {
    if (runState !== 'running' || !startTime) {
      if (startTime && endTime) {
        setElapsed(formatDuration(endTime - startTime));
      }
      return;
    }
    const tick = () => setElapsed(formatDuration(Date.now() - startTime));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [runState, startTime, endTime]);

  // Reset confirming when state changes
  useEffect(() => { setConfirming(false); }, [runState]);

  const sz = tokens.fontSize[1];
  const dim = tokens.colors.textSecondary;

  // StatusBlock renders OUTSIDE scroll area — needs full outerPad
  const hPad = `${tokens.grid.outerPad}px`;

  if (runState === 'error') {
    return (
      <div style={{ fontSize: sz, lineHeight: tokens.lineHeight[2], color: tokens.colors.error, padding: `4px ${hPad}` }}>
        {error || 'Error'}{elapsed ? ` · ${elapsed}` : ''}
      </div>
    );
  }

  if (runState === 'canceled') {
    return (
      <div style={{ fontSize: sz, lineHeight: tokens.lineHeight[2], color: dim, padding: `4px ${hPad}`, display: 'flex', alignItems: 'center' }}>
        <span>Stopped{elapsed ? ` · ${elapsed}` : ''}</span>
        <span
          onClick={onContinue}
          style={{ marginLeft: 'auto', cursor: 'pointer', padding: '2px 8px', borderRadius: '6px', transition: 'background 120ms', color: dim }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
        >continue</span>
      </div>
    );
  }

  // Outside scroll area → full 22px horizontal padding
  const row: h.JSX.CSSProperties = {
    fontSize: sz, lineHeight: tokens.lineHeight[2], color: dim,
    padding: `${tokens.space[1]}px ${hPad}`,
    display: 'flex', alignItems: 'center',
  };

  const isRunning = runState === 'running';

  // Completed / canceled / error — same word, ed form
  if (!isRunning) {
    if (!elapsed) return null;
    const label = runState === 'error' ? `Error · ${elapsed}`
      : runState === 'canceled' ? `Stopped · ${elapsed}`
      : `Thought · ${elapsed}`;
    return <div style={row}>{label}</div>;
  }

  // Running — two-step interrupt
  if (confirming) {
    return (
      <div style={row}>
        <span className="thinking-shimmer">Thinking · {elapsed || '0s'}</span>
        <span style={{ flex: 1 }} />
        <span
          onClick={() => { setConfirming(false); onStop(); }}
          style={{ flexShrink: 0, cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--radius-3)', transition: 'background 120ms', color: tokens.colors.error }}
          onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--error-3)' }}
          onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = '' }}
        >stop</span>
        <span
          onClick={() => setConfirming(false)}
          style={{ flexShrink: 0, cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--radius-3)', transition: 'background 120ms', marginLeft: tokens.space[1] }}
          onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
          onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = '' }}
        >continue</span>
      </div>
    );
  }

  return (
    <div style={row}>
      <span className="thinking-shimmer">Thinking · {elapsed || '0s'}</span>
      <span style={{ flex: 1 }} />
      <span
        onClick={() => setConfirming(true)}
        style={{ flexShrink: 0, cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--radius-3)', transition: 'background 120ms, color 120ms', color: dim, background: 'transparent' }}
        onMouseEnter={(e: MouseEvent) => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--warning-3)'; el.style.color = tokens.colors.warning }}
        onMouseLeave={(e: MouseEvent) => { const el = e.currentTarget as HTMLElement; el.style.background = 'transparent'; el.style.color = dim }}
      >click to interrupt</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ============================================
// MessageList
// ============================================

function MessageList({ history, loading, runtimeState, onStop, onContinue, anchorRef, memoryCount }: {
  history: any[];
  loading: boolean;
  runtimeState: 'idle' | 'running' | 'canceled' | 'error';
  onStop: () => void;
  onContinue: () => void;
  anchorRef: any;
  memoryCount: number;
}) {
  const isEmpty = history.length === 0 && !loading;

  if (isEmpty) {
    const pad = tokens.grid.blockPad; // 10px
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', flex: 1, padding: `0 ${pad}px` }}>
        <div style={{
          fontSize: 32,
          fontWeight: 400,
          fontFamily: 'var(--typography-font-family-emphasis)',
          color: 'var(--gray-12)',
          lineHeight: 1.25,
          letterSpacing: '-0.2px',
        }}>Build something<br />great.</div>
        <div style={{
          fontSize: tokens.fontSize[1],
          color: 'var(--gray-9)',
          marginTop: tokens.space[1],
          lineHeight: tokens.lineHeight[2],
        }}>{t.emptyStateHint}</div>
        {memoryCount > 0 && (
          <span style={{
            fontSize: 11,
            color: tokens.colors.textSecondary,
            marginTop: tokens.space[1],
          }}>{memoryCount} item{memoryCount !== 1 ? 's' : ''} remembered</span>
        )}
      </div>
    );
  }

  return (
    <Fragment>
      {history.filter(msg => !msg.id?.startsWith('recovery_')).map((msg, i) => {
        const isUserMessage = msg.role === 'user';
        const prevRole = i > 0 ? history[i - 1].role : null;
        const marginTop = i === 0 ? 0 : tokens.space[1];

        if (isUserMessage) {
          return (
            <div key={msg.id || `msg-${i}`} style={{ ...userItemStyle, marginTop }}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  {msg.attachments.map((att: ContextAttachment, ai: number) => (
                    <ContextTag key={ai} icon={attachmentIcon(att)} label={attachmentLabel(att)} />
                  ))}
                </div>
              )}
              <span style={{ fontSize: tokens.fontSize[1], wordBreak: 'break-word', lineHeight: 'var(--typography-line-height-2)', color: tokens.colors.textPrimary }}>
                {typeof msg.text === 'string' ? msg.text : String(msg.text ?? '')}
              </span>
            </div>
          );
        }

        // Model message — flat block stream
        const isStreaming = !!msg.streaming;
        const blocks = mergeBlocks(msg.blocks || []);
        const isError = msg.runState === 'error';
        const isCanceled = msg.runState === 'canceled';

        return (
          <Fragment key={msg.id || `msg-${i}`}>
            {blocks.map((block: any, bi: number) => {
              const blockMargin = bi === 0 && marginTop ? marginTop : tokens.space[1];
              if (block.type === 'text') {
                return (
                  <div key={`b-${bi}`} style={{ marginTop: blockMargin }}>
                    <TextBlock
                      content={block.content}
                      streaming={isStreaming && bi === blocks.length - 1}
                    />
                  </div>
                );
              }
              if (block.type === 'tool_group') {
                return (
                  <div key={`b-${bi}`} style={{ marginTop: blockMargin }}>
                    <ToolBlock tools={block.tools} />
                  </div>
                );
              }
              return null;
            })}

            {/* Node chips — after completion */}
            {!isStreaming && !isError && (msg.toolCalls?.length ?? 0) > 0 && (
              <NodeListPanel toolCalls={msg.toolCalls || []} />
            )}

          </Fragment>
        );
      })}

      <div ref={anchorRef} />
    </Fragment>
  );
}

// --- Attachment helpers ---

function selectionSummary(nodes: { name: string; type: string }[]): string {
  if (nodes.length === 0) return 'Empty'
  if (nodes.length === 1) return nodes[0].name
  // Group by type, show first name + count
  const names = nodes.slice(0, 2).map(n => n.name)
  const rest = nodes.length - names.length
  return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ')
}

function attachmentLabel(att: ContextAttachment): string {
  switch (att.type) {
    case 'page': return att.pageName
    case 'selection': return selectionSummary(att.nodes)
    case 'skill': return att.name
  }
}

function attachmentIcon(att: ContextAttachment): h.JSX.Element {
  const size = 12
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' as const }
  switch (att.type) {
    case 'page':
      return <svg {...props}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
    case 'selection':
      return <svg {...props}><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>
    case 'skill':
      return <svg {...props}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
  }
}

export function ChatFeature(props: UseChatProps) {
  const {
    prompt,
    setPrompt,
    history,
    loading,
    generate,
    stopGeneration,
    continueGeneration,
    pendingApproval,
    respondToApproval,
    pendingQuestion,
    respondToQuestion,
    modelName,
    setModelName,
    apiKey,
    setApiKey,
    suggestedModels,
    onOpenSettings,
    providerName,
    runtimeState,
    memoryCount,
  } = useChat(props)

  // --- Context Attachments ---
  const [attachments, setAttachments] = useState<ContextAttachment[]>([])

  const addAttachment = (att: ContextAttachment) => {
    setAttachments(prev => {
      // Deduplicate by type (only one selection, one page at a time)
      if (att.type === 'selection' || att.type === 'page') {
        return [...prev.filter(a => a.type !== att.type), att]
      }
      // Skills: deduplicate by skillId
      if (att.type === 'skill' && prev.some(a => a.type === 'skill' && a.skillId === att.skillId)) {
        return prev
      }
      return [...prev, att]
    })
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  // Listen for selection context from main thread (replacing old JSON dump)
  useEffect(() => {
    return on<SendSelectionHandler>('SEND_SELECTION', (data) => {
      if (data.selection.length === 0) return
      addAttachment({ type: 'selection', nodes: data.selection })
    })
  }, [])

  const {
    shouldAutoScroll,
    containerRef,
    anchorRef,
  } = useSmartScroll(history, { threshold: 100 });

  // Conditional scroll
  useEffect(() => {
    if (shouldAutoScroll) {
      anchorRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [history, shouldAutoScroll])

  const selectSavedPrompt = (title: string) => {
    const suggestion = t.promptSuggestions.find(s => s.title === title)
    if (suggestion) {
      setPrompt(suggestion.description)
    }
  }

  const handleGenerate = () => {
    const snapshot = [...attachments]
    setAttachments([]) // Clear after send (selection/skill are one-shot)
    generate(snapshot.length > 0 ? snapshot : undefined)
  }

  const pluginState: PluginState = derivePluginState({
    historyLength: history.length,
    loading,
    hasInput: !!prompt.trim(),
  });

  const chipsState = getElementState('promptChips', pluginState);

  const isEmpty = pluginState === 'EMPTY' || pluginState === 'TYPING';
  const canSubmit = !!prompt.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {/* Messages Area */}
      <div style={messagesContainerStyle} ref={containerRef} className="messages-mask">
        <MessageList
          history={history}
          loading={loading}
          runtimeState={runtimeState}
          onStop={stopGeneration}
          onContinue={continueGeneration}
          anchorRef={anchorRef}
          memoryCount={memoryCount}
        />

        {isEmpty && chipsState.visible && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 0 }}>
            <PromptChips
              suggestions={memoryCount > 0
                ? [...t.memorySuggestions, ...t.promptSuggestions]
                : t.promptSuggestions}
              onSelect={selectSavedPrompt}
              visible={chipsState.visible}
              enabled={chipsState.enabled}
            />
          </div>
        )}

        {/* Scroll anchor for bottom */}
      </div>

      {/* Tool Approval Panel — outside scroll, needs outerPad */}
      {pendingApproval && (
        <div style={{
          flexShrink: 0,
          padding: `${tokens.space[2]}px ${tokens.grid.outerPad}px`,
          borderTop: `1px solid ${tokens.colors.alpha[3]}`,
          display: 'flex',
          alignItems: 'center',
          gap: tokens.space[2],
        }}>
          <span style={{ flex: 1, fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary, fontFamily: 'var(--font-family-mono)' }}>
            {pendingApproval.toolCalls.map(tc => tc.name).join(', ')}
          </span>
          <Button variant="primary" size="sm" onClick={() => respondToApproval(true)}>Approve</Button>
          <Button variant="ghost" size="sm" onClick={() => respondToApproval(false)}>Deny</Button>
        </div>
      )}

      {/* Ask User Question Panel — outside scroll, needs outerPad */}
      {pendingQuestion && (
        <div style={{
          flexShrink: 0,
          padding: `${tokens.space[3]}px ${tokens.grid.outerPad}px`,
          borderTop: `1px solid ${tokens.colors.alpha[3]}`,
          display: 'flex',
          flexDirection: 'column',
          gap: tokens.space[2],
        }}>
          <span style={{
            fontSize: tokens.fontSize[2],
            color: tokens.colors.textPrimary,
            fontWeight: 500,
            lineHeight: tokens.lineHeight[2],
          }}>
            {pendingQuestion.question}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
            {pendingQuestion.options.map(opt => (
              <button
                key={opt.label}
                className="card-interactive"
                onClick={() => respondToQuestion(opt.label)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 2,
                  padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
                  border: 'var(--border-default)',
                  borderRadius: 'var(--radius-2)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  fontFamily: tokens.font.sans,
                  transition: 'var(--transition-crisp)',
                }}
              >
                <span style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textPrimary, fontWeight: 500 }}>
                  {opt.label}
                </span>
                {opt.description && (
                  <span style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary }}>
                    {opt.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Status bar — fixed between scroll area and input */}
      {(() => {
        const lastModel = [...history].reverse().find((m: any) => m.role === 'model');
        if (!lastModel) return null;
        const state = loading ? runtimeState : lastModel.runState;
        if (!state) return null;
        return (
          <div style={{ flexShrink: 0, borderTop: `1px solid ${tokens.colors.alpha[2]}` }}>
            <StatusBlock
              runState={state}
              startTime={lastModel.startTime}
              endTime={lastModel.endTime}
              error={lastModel.runError}
              onStop={stopGeneration}
              onContinue={continueGeneration}
            />
          </div>
        );
      })()}

      {/* Input Area — Flex-anchored at bottom */}
      <div style={{
        flexShrink: 0,
        padding: `0 ${tokens.space[3]}px ${tokens.space[3]}px`,
        background: tokens.colors.background,
        zIndex: 10,
        position: 'relative',
      }}>

        <PromptInput
          value={prompt}
          onChange={(v) => setPrompt(v)}
          onSubmit={handleGenerate}
          loading={loading}
          disabled={false}
          placeholder={t.placeholder}
          canSubmit={canSubmit}
          contextTags={attachments.length > 0 ? (
            <Fragment>
              {attachments.map((att, i) => (
                <ContextTag
                  key={att.type === 'skill' ? att.skillId : att.type}
                  icon={attachmentIcon(att)}
                  label={attachmentLabel(att)}
                  onRemove={att.type === 'page' ? undefined : () => removeAttachment(i)}
                />
              ))}
            </Fragment>
          ) : undefined}
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
              providerName={providerName}
            />
          }
          onPlusClick={() => emit<GetSelectionHandler>('GET_SELECTION')}
          onSkillSelect={(skillId) => {
            addAttachment({ type: 'skill', skillId, name: skillId })
          }}
        />
      </div>
    </div>
  )
}
