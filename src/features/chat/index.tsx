import { h, Fragment } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { tokens } from '../../ui/design-system/tokens'

const BRAILLE_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
function useBrailleSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame(f => (f + 1) % BRAILLE_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return active ? BRAILLE_FRAMES[frame] : '';
}
import {
  derivePluginState,
  getElementState,
} from '../../ui/index'
import { PromptChips } from '../../ui/components/PromptChips'
import { PromptInput } from '../../ui/components/PromptInput'
import { ToolBlock } from '../../ui/components/ToolBlock'
import { CanvasTextBlock as TextBlock } from '../../ui/components/canvas-markdown/CanvasTextBlock'
import { ModelPopover } from '../../ui/components/ModelPopover'
import { on, emit } from '@create-figma-plugin/utilities'
import {
  SendSelectionHandler, GetSelectionHandler, SelectNodeHandler, UnselectNodesHandler,
  ContextAttachment,
} from '../../types'
import { ContextTag } from '../../ui/components/ContextTag'
import { NodeTypeIcon, SkillIcon, PageIcon, isComponentType } from '../../ui/components/NodeTypeIcon'
import type { PluginState } from '../../ui/index'

import { useChat, UseChatProps } from './useChat'
import { useSmartScroll } from '../../hooks/useSmartScroll'
import { useTranslations } from '../../ui/i18n'
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

function StatusBlock({ runState, startTime, endTime, error, onStop, onContinue, onRetry, waitingForUser }: {
  runState: string;
  startTime?: number;
  endTime?: number;
  error?: string;
  onStop: () => void;
  onContinue: () => void;
  onRetry: () => void;
  waitingForUser?: boolean;
}) {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [elapsed, setElapsed] = useState('');
  const spinner = useBrailleSpinner(runState === 'running' && !waitingForUser);

  // Elapsed time ticker — paused when waiting for user
  useEffect(() => {
    if (runState !== 'running' || !startTime || waitingForUser) {
      if (startTime && endTime) {
        setElapsed(formatDuration(endTime - startTime));
      }
      return;
    }
    const tick = () => setElapsed(formatElapsedTimer(Date.now() - startTime));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [runState, startTime, endTime, waitingForUser]);

  // Reset confirming when state changes
  useEffect(() => { setConfirming(false); }, [runState]);

  const sz = tokens.fontSize[1];
  const dim = tokens.colors.textSecondary;

  // StatusBlock renders OUTSIDE scroll area — needs full outerPad
  const hPad = `${tokens.grid.outerPad}px`;

  if (runState === 'error') {
    return (
      <div style={{ fontSize: sz, lineHeight: tokens.lineHeight[2], color: tokens.colors.error, padding: `4px ${hPad}` }}>
        {error || t.statusError}{elapsed ? ` · ${elapsed}` : ''}
      </div>
    );
  }

  if (runState === 'canceled') {
    return (
      <div style={{ fontSize: sz, lineHeight: tokens.lineHeight[2], color: dim, padding: `4px ${hPad}`, display: 'flex', alignItems: 'center' }}>
        <span>{t.statusStopped}{elapsed ? ` · ${elapsed}` : ''}</span>
        <span
          onClick={onContinue}
          style={{ marginLeft: 'auto', cursor: 'pointer', padding: '2px 8px', borderRadius: '6px', transition: 'background 120ms', color: dim }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
        >{t.continueAction}</span>
      </div>
    );
  }

  if (runState === 'empty_response') {
    return (
      <div style={{ fontSize: sz, lineHeight: tokens.lineHeight[2], color: dim, padding: `4px ${hPad}`, display: 'flex', alignItems: 'center' }}>
        <span>{t.statusEmptyResponse}{elapsed ? ` · ${elapsed}` : ''}</span>
        <span
          onClick={onRetry}
          style={{ marginLeft: 'auto', cursor: 'pointer', padding: '2px 8px', borderRadius: '6px', transition: 'background 120ms', color: dim }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
        >{t.retryAction}</span>
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
    const label = runState === 'error' ? `${t.statusError} · ${elapsed}`
      : runState === 'canceled' ? `${t.statusStopped} · ${elapsed}`
      : `${t.statusThought} · ${elapsed}`;
    return <div style={row}>{label}</div>;
  }

  // Waiting for user answer — paused, no timer ticking
  if (waitingForUser) {
    return (
      <div style={row}>
        <span style={{ color: tokens.colors.accent }}>Waiting for answer</span>
        {elapsed ? <span style={{ marginLeft: tokens.space[2], flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{elapsed}</span> : null}
      </div>
    );
  }

  // Running — two-step interrupt
  if (confirming) {
    return (
      <div style={row}>
        <span className="thinking-shimmer">{spinner} {t.statusThinking}</span>
        <span style={{ marginLeft: tokens.space[2], flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{elapsed || '⏱ 0s'}</span>
        <span style={{ flex: 1 }} />
        <span
          onClick={() => { setConfirming(false); onStop(); }}
          style={{ flexShrink: 0, cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--radius-3)', transition: 'background 120ms', color: tokens.colors.error }}
          onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--error-3)' }}
          onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = '' }}
        >{t.stopAction}</span>
        <span
          onClick={() => setConfirming(false)}
          style={{ flexShrink: 0, cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--radius-3)', transition: 'background 120ms', marginLeft: tokens.space[1] }}
          onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
          onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = '' }}
        >{t.continueAction}</span>
      </div>
    );
  }

  return (
    <div
      style={row}
      onMouseEnter={(e: MouseEvent) => { const btn = (e.currentTarget as HTMLElement).querySelector('[data-interrupt]') as HTMLElement; if (btn) btn.style.opacity = '1'; }}
      onMouseLeave={(e: MouseEvent) => { const btn = (e.currentTarget as HTMLElement).querySelector('[data-interrupt]') as HTMLElement; if (btn) btn.style.opacity = '0'; }}
    >
      <span className="thinking-shimmer">{spinner} {t.statusThinking}</span>
      <span style={{ marginLeft: tokens.space[2], flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{elapsed || '⏱ 0s'}</span>
      <span style={{ flex: 1 }} />
      <span
        data-interrupt
        onClick={() => setConfirming(true)}
        style={{ flexShrink: 0, cursor: 'pointer', padding: '2px 8px', borderRadius: 'var(--radius-3)', transition: 'background 150ms, opacity 150ms', color: dim, background: 'transparent', opacity: 0 }}
        onMouseEnter={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'var(--gray-3)' }}
        onMouseLeave={(e: MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >{t.clickToInterrupt}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/** Format elapsed ms as a compact timer label with stopwatch prefix. */
function formatElapsedTimer(ms: number): string {
  return `⏱ ${formatDuration(ms)}`;
}


// ============================================
// MessageList
// ============================================

function MessageList({ history, loading, runtimeState, onStop, onContinue, anchorRef }: {
  history: any[];
  loading: boolean;
  runtimeState: 'idle' | 'running' | 'canceled' | 'error' | 'empty_response';
  onStop: () => void;
  onContinue: () => void;
  anchorRef: any;
}) {
  const isEmpty = history.length === 0 && !loading;

  const t = useTranslations();
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
        }}>{t.buildSomething}<br />{t.great}</div>
        <div style={{
          fontSize: tokens.fontSize[1],
          color: 'var(--gray-9)',
          marginTop: tokens.space[1],
          lineHeight: tokens.lineHeight[2],
        }}>{t.emptyStateHint}</div>
      </div>
    );
  }

  return (
    <Fragment>
      {history.map((msg, i) => {
        const isUserMessage = msg.role === 'user';
        const prevRole = i > 0 ? history[i - 1].role : null;
        const marginTop = i === 0 ? 0 : tokens.space[1];

        if (isUserMessage) {
          return (
            <div key={msg.id || `msg-${i}`} style={{ ...userItemStyle, marginTop }}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                  {renderAttachmentChips(msg.attachments)}
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

          </Fragment>
        );
      })}

      <div ref={anchorRef} />
    </Fragment>
  );
}

// --- Attachment rendering ---

/** Format the count label on an aggregated "+N" chip. */
function aggregateLabel(count: number): string {
  if (count >= 1000) return '999+'
  if (count >= 100) return '99+'
  if (count >= 10) return '9+'
  return `+${count}`
}

type NodeRef = { id: string; name: string; type: string }

interface ChipHandlers {
  onNodeClick?: (nodeId: string) => void
  onNodeRemove?: (nodeId: string) => void
  onSkillRemove?: (skillId: string) => void
  onAggregateRemove?: (nodeIds: string[]) => void
}

/** Convert attachments into the flat list of v5-style chips rendered above the textarea. */
function renderAttachmentChips(
  attachments: ContextAttachment[],
  handlers?: ChipHandlers,
): h.JSX.Element[] {
  const chips: h.JSX.Element[] = []

  for (const att of attachments) {
    if (att.type === 'skill') {
      chips.push(
        <ContextTag
          key={`skill-${att.skillId}`}
          icon={<SkillIcon />}
          label={att.name}
          onRemove={handlers?.onSkillRemove ? () => handlers.onSkillRemove!(att.skillId) : undefined}
        />,
      )
      continue
    }
    if (att.type === 'page') {
      chips.push(
        <ContextTag key={`page-${att.pageId}`} icon={<PageIcon />} label={att.pageName} />,
      )
      continue
    }
    // selection — split into per-node chips with progressive aggregation
    const nodes = att.nodes as NodeRef[]
    if (nodes.length === 0) continue
    const headCount = nodes.length <= 3 ? nodes.length : 2
    const head = nodes.slice(0, headCount)
    const tail = nodes.slice(headCount)

    for (const n of head) {
      chips.push(
        <ContextTag
          key={`node-${n.id}`}
          icon={<NodeTypeIcon nodeType={n.type} />}
          label={n.name}
          title={n.name}
          variant={isComponentType(n.type) ? 'component' : 'default'}
          onClick={handlers?.onNodeClick ? () => handlers.onNodeClick!(n.id) : undefined}
          onRemove={handlers?.onNodeRemove ? () => handlers.onNodeRemove!(n.id) : undefined}
        />,
      )
    }

    if (tail.length > 0) {
      const tailIds = tail.map(n => n.id)
      chips.push(
        <ContextTag
          key={`agg-${tailIds.join(',')}`}
          label={aggregateLabel(tail.length)}
          title={tail.map(n => n.name).join(', ')}
          onRemove={handlers?.onAggregateRemove ? () => handlers.onAggregateRemove!(tailIds) : undefined}
        />,
      )
    }
  }

  return chips
}

export function ChatFeature(props: UseChatProps) {
  const t = useTranslations();
  const {
    prompt,
    setPrompt,
    history,
    loading,
    generate,
    stopGeneration,
    continueGeneration,
    retryGeneration,
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

  // Additive sync with canvas: new selections become chips, but existing chips
  // persist — only an explicit X removes them. Partial/full canvas deselect never
  // removes chips (the node just stays in the prompt context). If a node is
  // re-selected after being X'd, a fresh chip appears (X only clears current state).
  useEffect(() => {
    const unsub = on<SendSelectionHandler>('SEND_SELECTION', (data) => {
      if (data.selection.length === 0) return // never remove on canvas deselect
      setAttachments(prev => {
        const existing = prev.find((a): a is Extract<ContextAttachment, { type: 'selection' }> => a.type === 'selection')
        const existingIds = new Set(existing?.nodes.map(n => n.id) ?? [])
        const newNodes = data.selection.filter(n => !existingIds.has(n.id))
        if (newNodes.length === 0) return prev // nothing new to add
        const mergedNodes = [...(existing?.nodes ?? []), ...newNodes]
        const withoutSelection = prev.filter(a => a.type !== 'selection')
        return [...withoutSelection, { type: 'selection', nodes: mergedNodes }]
      })
    })
    emit<GetSelectionHandler>('GET_SELECTION')
    return unsub
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
    // When ask_user is pending, route input to answer the question
    if (pendingQuestion && prompt.trim()) {
      respondToQuestion(prompt.trim())
      setPrompt('')
      return
    }
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
  const canSubmit = !!prompt.trim() || !!pendingQuestion;

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
        const state = runtimeState !== 'idle' ? runtimeState : lastModel.runState;
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
              onRetry={retryGeneration}
              waitingForUser={!!pendingQuestion}
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
          placeholder={pendingQuestion ? 'Or type your answer…' : t.placeholder}
          canSubmit={canSubmit}
          contextTags={attachments.length > 0 ? (
            <Fragment>
              {renderAttachmentChips(attachments, {
                onNodeClick: (nodeId) => emit<SelectNodeHandler>('SELECT_NODE', { nodeId, preserveSelection: true }),
                onNodeRemove: (nodeId) => {
                  emit<UnselectNodesHandler>('UNSELECT_NODES', { nodeIds: [nodeId] })
                  setAttachments(prev => prev
                    .map(a => a.type === 'selection'
                      ? { ...a, nodes: a.nodes.filter(n => n.id !== nodeId) }
                      : a)
                    .filter(a => a.type !== 'selection' || a.nodes.length > 0))
                },
                onAggregateRemove: (nodeIds) => {
                  emit<UnselectNodesHandler>('UNSELECT_NODES', { nodeIds })
                  const idSet = new Set(nodeIds)
                  setAttachments(prev => prev
                    .map(a => a.type === 'selection'
                      ? { ...a, nodes: a.nodes.filter(n => !idSet.has(n.id)) }
                      : a)
                    .filter(a => a.type !== 'selection' || a.nodes.length > 0))
                },
                onSkillRemove: (skillId) => {
                  setAttachments(prev => prev.filter(a => !(a.type === 'skill' && a.skillId === skillId)))
                },
              })}
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
