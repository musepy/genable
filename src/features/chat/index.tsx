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
import { loadImageFile, MAX_IMAGES, ImageAttachmentError } from '../../ui/utils/imageAttachment'
import { ImagePreviewModal } from '../../ui/components/ImagePreviewModal'
import { getModelQuirks } from '../../engine/llm-client/providers/shared/modelQuirks'
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
        <span style={{ marginLeft: tokens.space[2], flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{elapsed || '0s'}</span>
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
      <span style={{ marginLeft: tokens.space[2], flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{elapsed || '0s'}</span>
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

/** Format elapsed ms as a compact duration label (e.g. "5s", "1m 30s").
 *  Plain text — no emoji, no icon prefix; the surrounding context is enough. */
function formatElapsedTimer(ms: number): string {
  return formatDuration(ms);
}


// ============================================
// MessageList
// ============================================

function MessageList({ history, loading, runtimeState, onStop, onContinue, anchorRef, onImagePreview }: {
  history: any[];
  loading: boolean;
  runtimeState: 'idle' | 'running' | 'canceled' | 'error' | 'empty_response';
  onStop: () => void;
  onContinue: () => void;
  anchorRef: any;
  onImagePreview?: (att: ImageAtt) => void;
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
          lineHeight: 1.05,
          letterSpacing: '-0.4px',
        }}>{t.buildSomething}<br />{t.great}</div>
        <div style={{
          fontSize: tokens.fontSize[1],
          color: 'var(--gray-a11)',
          marginTop: tokens.space[3],
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
                  {renderAttachmentChips(msg.attachments, {
                    onImageClick: onImagePreview,
                  })}
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

type ImageAtt = Extract<ContextAttachment, { type: 'image' }>

interface ChipHandlers {
  onNodeClick?: (nodeId: string) => void
  onNodeRemove?: (nodeId: string) => void
  onSkillRemove?: (skillId: string) => void
  onAggregateRemove?: (nodeIds: string[]) => void
  onImageRemove?: (imageId: string) => void
  /** Receives the full attachment so callers don't need to look it up by id —
   *  this lets history-rendered chips share the same handler as composer chips. */
  onImageClick?: (att: ImageAtt) => void
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
    if (att.type === 'image') {
      const thumb = (
        <img
          src={`data:${att.mimeType};base64,${att.data}`}
          alt=""
          style={{
            width: 14,
            height: 14,
            objectFit: 'cover',
            borderRadius: 2,
            display: 'block',
          }}
        />
      )
      chips.push(
        <ContextTag
          key={`image-${att.id}`}
          icon={thumb}
          label={att.name}
          title={`${att.name} · ${att.width}×${att.height} · ${att.sizeKB}KB`}
          onClick={handlers?.onImageClick ? () => handlers.onImageClick!(att) : undefined}
          onRemove={handlers?.onImageRemove ? () => handlers.onImageRemove!(att.id) : undefined}
        />,
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

// ─── AskUserForm ─────────────────────────────────────────────────────────
//
// Sequential question form. CC AskUserQuestion-aligned UX:
//   - One question at a time, with progress chip "1 / N" inline with the text
//   - Click an option to record the answer
//       single-select: auto-advance to the next question (or auto-submit on last)
//       multi-select:  toggle entry; user advances via Next
//   - Per-question Other = bare auto-grow textarea; pressing ⌘↵ or Next commits
//     the textarea text as the answer (single-select replaces the option;
//     multi-select appends). Committed Other mirrors the selected-option state
//     (gray-a3 row + filled badge).
//   - Stable nav region: Back · Skip · Next (Next is primary; Back hidden on
//     the first question). ←/→ also nav between questions when not typing.
//
// Single-question forms: no nav region; option click submits, Other commits via
// ⌘↵ or the inline Submit button.
//
// Global free-form bypass (typing in the chat input) is handled by ChatFeature,
// not this component — it routes prompt text to respondToQuestion({ freeText }).

interface AskUserQuestion {
  question: string
  options: { label: string; description?: string }[]
  multiSelect?: boolean
}

function AskUserForm({
  questions,
  onSubmit,
}: {
  questions: AskUserQuestion[]
  onSubmit: (answers: Array<string | string[]>) => void
}) {
  // selections[i]:
  //   single-select: string (option label OR custom text from "Other") | null
  //   multi-select:  string[] (entries are option labels OR custom text)
  const [selections, setSelections] = useState<Array<string | string[] | null>>(
    () => questions.map(q => (q.multiSelect ? [] : null)),
  )
  // Per-question Other textarea draft (uncommitted text)
  const [otherDraft, setOtherDraft] = useState<Record<number, string>>({})
  // Per-question source of the committed answer — drives "committed Other"
  // visual state for single-select (option label vs. user-typed text).
  const [answerSource, setAnswerSource] = useState<Record<number, 'option' | 'freeform'>>({})
  const [activeIdx, setActiveIdx] = useState(0)
  const formRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const isSingleQuestion = questions.length === 1
  const cur = questions[activeIdx]
  const atLast = activeIdx === questions.length - 1
  const atFirst = activeIdx === 0

  const isAnswered = (sel: Array<string | string[] | null>, i: number): boolean => {
    const s = sel[i]
    if (questions[i].multiSelect) return Array.isArray(s) && s.length > 0
    return typeof s === 'string' && s.length > 0
  }
  const isQuestionAnswered = (i: number) => isAnswered(selections, i)
  const allAnswered = (sel: Array<string | string[] | null> = selections) =>
    questions.every((_, i) => isAnswered(sel, i))

  const finalize = (sel: Array<string | string[] | null> = selections) => {
    const answers = sel.map((s, i) =>
      questions[i].multiSelect ? ((s as string[]) || []) : ((s as string) || ''),
    )
    onSubmit(answers)
  }

  const setSelectionAt = (qIdx: number, value: string | string[] | null, source?: 'option' | 'freeform') => {
    setSelections(prev => {
      const next = [...prev]
      next[qIdx] = value
      return next
    })
    if (source) setAnswerSource(prev => ({ ...prev, [qIdx]: source }))
  }

  const recordOption = (qIdx: number, label: string) => {
    const q = questions[qIdx]
    setSelections(prev => {
      const next = [...prev]
      if (q.multiSelect) {
        const cur = (next[qIdx] as string[]) || []
        next[qIdx] = cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label]
      } else {
        next[qIdx] = label
      }

      // Single-select: auto-advance / auto-submit
      if (!q.multiSelect) {
        if (isSingleQuestion) {
          setTimeout(() => finalize(next), 0)
        } else if (qIdx < questions.length - 1) {
          setTimeout(() => setActiveIdx(qIdx + 1), 180)
        } else if (allAnswered(next)) {
          setTimeout(() => finalize(next), 180)
        }
      }
      return next
    })
    setAnswerSource(prev => ({ ...prev, [qIdx]: 'option' }))
    // Clear any uncommitted Other draft for this Q since user picked an option
    setOtherDraft(prev => ({ ...prev, [qIdx]: '' }))
  }

  const goNext = () => {
    // Commit any pending Other draft for the current Q before advancing
    let committed = false
    setSelections(prev => {
      const text = (otherDraft[activeIdx] || '').trim()
      if (!text) return prev
      const q = questions[activeIdx]
      const next = [...prev]
      if (q.multiSelect) {
        const cur = (next[activeIdx] as string[]) || []
        if (!cur.includes(text)) next[activeIdx] = [...cur, text]
      } else {
        next[activeIdx] = text
      }
      committed = true
      // Submit / advance with the just-committed selection
      setTimeout(() => {
        if (atLast) finalize(next)
        else setActiveIdx(activeIdx + 1)
      }, 0)
      return next
    })
    if (committed) {
      setAnswerSource(prev => ({ ...prev, [activeIdx]: 'freeform' }))
      setOtherDraft(prev => ({ ...prev, [activeIdx]: '' }))
      return
    }
    if (atLast) finalize()
    else setActiveIdx(activeIdx + 1)
  }

  const goSkip = () => {
    if (atLast) finalize()
    else setActiveIdx(activeIdx + 1)
  }

  const goBack = () => {
    if (!atFirst) setActiveIdx(activeIdx - 1)
  }

  const isOptionSelected = (qIdx: number, label: string): boolean => {
    const s = selections[qIdx]
    if (questions[qIdx].multiSelect) return Array.isArray(s) && s.includes(label)
    return s === label
  }

  // Auto-grow Other textarea: starts at minHeight (36px = ~1 row) and grows
  // with content up to maxHeight (120px). Critical because the plugin window
  // is fixed-height — a 120px textarea on an empty Other row pushed the
  // PromptInput off-screen below the form card. Skip/Next shifting down a
  // few px as user types is acceptable; an invisible input is not.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [activeIdx, otherDraft[activeIdx], selections[activeIdx]])

  // Keyboard: ⌘↵ commit/advance (uses unified goNext), ←/→ nav (multi-q only,
  // when not typing in textarea).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inTextarea = (e.target as HTMLElement | null)?.tagName === 'TEXTAREA'
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        goNext()
        return
      }
      if (inTextarea) return
      if (isSingleQuestion) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (!atLast) setActiveIdx(activeIdx + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (!atFirst) setActiveIdx(activeIdx - 1)
      }
    }
    const el = formRef.current
    if (!el) return
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [activeIdx, atFirst, atLast, otherDraft, isSingleQuestion])

  // ─── Style helpers ────────────────────────────────────────────────────
  const optionRowStyle = (selected: boolean): any => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 12px',
    minHeight: 32,
    border: 'none',
    borderRadius: 6,
    background: selected ? tokens.colors.alpha[3] : tokens.colors.alpha[2],
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontFamily: tokens.font.sans,
    transition: 'background 150ms ease',
  })

  const onOptionEnter = (e: MouseEvent, selected: boolean) => {
    if (selected) return
    ;(e.currentTarget as HTMLElement).style.background = tokens.colors.alpha[3]
  }
  const onOptionLeave = (e: MouseEvent, selected: boolean) => {
    if (selected) return
    ;(e.currentTarget as HTMLElement).style.background = tokens.colors.alpha[2]
  }

  const numBadgeStyle = (filled: boolean): any => ({
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 1,
    minWidth: 18,
    height: 18,
    padding: '0 4px',
    boxSizing: 'border-box',
    borderRadius: 'var(--radius-2)',
    border: filled ? `1px solid ${tokens.colors.textPrimary}` : `1px solid ${tokens.colors.alpha[4]}`,
    background: filled ? tokens.colors.textPrimary : tokens.colors.panel,
    color: filled ? tokens.colors.background : tokens.colors.textSecondary,
    fontFamily: tokens.font.mono,
    fontSize: 10,
    fontVariantNumeric: 'tabular-nums',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  })

  const checkboxStyle = (filled: boolean): any => ({
    flexShrink: 0,
    marginTop: 2,
    width: 14,
    height: 14,
    borderRadius: 3,
    border: filled ? `1px solid ${tokens.colors.textPrimary}` : `1px solid ${tokens.colors.alpha[5]}`,
    background: filled ? tokens.colors.textPrimary : 'transparent',
    color: filled ? tokens.colors.panel : 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
  })

  const navBtnBase: any = {
    height: 26,
    padding: '0 10px',
    border: `1px solid ${tokens.colors.alpha[4]}`,
    borderRadius: 'var(--radius-2)',
    background: 'transparent',
    color: tokens.colors.textPrimary,
    fontFamily: tokens.font.sans,
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    transition: 'background 150ms ease',
  }
  const navBtnPrimary: any = {
    ...navBtnBase,
    background: tokens.colors.textPrimary,
    color: tokens.colors.panel,
    borderColor: tokens.colors.textPrimary,
  }
  const kbdStyle: any = {
    fontFamily: tokens.font.mono,
    fontSize: 10,
    color: tokens.colors.panel,
    opacity: 0.7,
    marginLeft: 2,
    lineHeight: 1,
  }

  // ─── Header row: question text left, 1/N progress chip right ─────────
  // Padding-right of 24 aligns the chip's right edge with the option/Other
  // number badges (which sit at outer 12 + internal 12 = 24 from card edge).
  const headerNode = (
    <div style={{ padding: '12px 24px 8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <p style={{
        margin: 0,
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        color: tokens.colors.textPrimary,
        fontWeight: 500,
        lineHeight: 1.45,
        wordBreak: 'break-word',
        overflowWrap: 'anywhere' as any,
      }}>
        {cur.question}
      </p>
      {!isSingleQuestion && (
        <span style={{
          flexShrink: 0,
          fontSize: 11,
          color: tokens.colors.textSecondary,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 400,
        }}>
          {activeIdx + 1}/{questions.length}
        </span>
      )}
    </div>
  )

  // ─── Option list ─────────────────────────────────────────────────────
  const optionListNode = (
    <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {cur.options.map((opt, oi) => {
        const selected = isOptionSelected(activeIdx, opt.label)
        return (
          <button
            key={opt.label}
            type="button"
            onClick={() => recordOption(activeIdx, opt.label)}
            onMouseEnter={(e: MouseEvent) => onOptionEnter(e, selected)}
            onMouseLeave={(e: MouseEvent) => onOptionLeave(e, selected)}
            style={optionRowStyle(selected)}
          >
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: tokens.colors.textPrimary, fontWeight: 400, wordBreak: 'break-word', overflowWrap: 'anywhere' as any }}>{opt.label}</span>
              {opt.description && (
                <span style={{
                  fontSize: 11,
                  color: tokens.colors.textSecondary,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere' as any,
                  // Cap desc at 2 lines so a single very long description
                  // (e.g. agent overshoots) can't push the input off-screen.
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>{opt.description}</span>
              )}
            </span>
            {cur.multiSelect ? (
              <span style={checkboxStyle(selected)}>
                {selected && (
                  <svg width="10" height="10" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </span>
            ) : (
              <span style={numBadgeStyle(selected)}>{oi + 1}</span>
            )}
          </button>
        )
      })}
    </div>
  )

  // ─── Other group: gray-a2 card with head (label + badge) + bordered textarea ───
  const draft = otherDraft[activeIdx] || ''
  const otherIsCommitted = !cur.multiSelect && answerSource[activeIdx] === 'freeform' && typeof selections[activeIdx] === 'string' && selections[activeIdx] !== ''
  const otherDisplayValue = otherIsCommitted ? (selections[activeIdx] as string) : draft

  const otherRowStyle: any = {
    flexShrink: 0,
    margin: '6px 12px 0',
    padding: '10px 12px',
    background: otherIsCommitted ? tokens.colors.alpha[3] : tokens.colors.alpha[2],
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: 'background 150ms ease',
  }
  const otherTextareaStyle: any = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    border: `1px solid ${tokens.colors.alpha[4]}`,
    borderRadius: 'var(--radius-2)',
    background: tokens.colors.panel,
    fontFamily: tokens.font.sans,
    fontSize: 12,
    lineHeight: '16px',
    color: tokens.colors.textPrimary,
    outline: 'none',
    minHeight: 36,
    maxHeight: 120,
    resize: 'none',
    overflowY: 'auto',
    display: 'block',
    transition: 'border-color 150ms ease',
  }

  const otherNode = (
    <div style={otherRowStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: tokens.colors.textPrimary, fontWeight: 400 }}>Other</span>
        {!cur.multiSelect && (
          <span style={numBadgeStyle(otherIsCommitted)}>{cur.options.length + 1}</span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        rows={1}
        value={otherDisplayValue}
        placeholder="Or write your own answer…"
        onInput={(e: any) => {
          // Editing clears the committed-freeform state; revert to draft mode
          if (otherIsCommitted) {
            setSelectionAt(activeIdx, cur.multiSelect ? [] : null)
            setAnswerSource(prev => ({ ...prev, [activeIdx]: undefined as any }))
          }
          setOtherDraft(prev => ({ ...prev, [activeIdx]: e.target.value }))
        }}
        onKeyDown={(e: KeyboardEvent) => {
          // Plain Enter commits + advances/finalizes (matches design v19+).
          // Shift+Enter inserts a newline. Cmd/Ctrl+Enter handled by formRef listener.
          if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
            const text = (otherDraft[activeIdx] || '').trim()
            if (!text) return
            e.preventDefault()
            goNext()
          }
        }}
        onFocus={(e: any) => { e.currentTarget.style.borderColor = tokens.colors.alpha[5] }}
        onBlur={(e: any) => { e.currentTarget.style.borderColor = tokens.colors.alpha[4] }}
        style={otherTextareaStyle}
      />
    </div>
  )

  // ─── Form card (design C2: separate sibling of PromptInput, NOT inside it).
  //     Own border + radius + shadow. The plugin window is fixed-height, so
  //     the form MUST share that budget with StatusBlock + PromptInput.
  //
  //     Layout contract (top-to-bottom inside the card):
  //       - Header           flexShrink:0 — always visible
  //       - Options scroller flex:1, minHeight:0, overflowY:auto — only this
  //                          region shrinks; long option lists scroll here
  //       - Other            flexShrink:0 — always visible (textarea is the
  //                          only way to type a custom answer; never hide it)
  //       - Nav (Skip/Next)  flexShrink:0 — always visible
  //
  //     The card itself is flexShrink:1 + minHeight:0 inside ChatFeature's
  //     flex column so PromptInput (flexShrink:0 sibling) stays anchored.
  //     Horizontal margin matches input wrapper's horizontal padding (12px)
  //     so card and input share the same width. Bottom margin tightened to
  //     4px so the visual gap stays compact (4 + 8px input top padding = 12).
  const formCardStyle: any = {
    flexShrink: 1,
    minHeight: 0,
    margin: '0 12px 4px',
    background: tokens.colors.panel,
    border: `1px solid ${tokens.colors.alpha[4]}`,
    borderRadius: 'var(--radius-5)',
    boxShadow: tokens.colors.shadowFocus,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }

  return (
    <div
      ref={formRef}
      tabIndex={-1}
      style={{ ...formCardStyle, outline: 'none' }}
    >
      {headerNode}

      {/* Options scroller — the ONLY shrinkable region. flex:1 + minHeight:0
          is the standard flexbox-scrollable recipe; without minHeight:0 the
          area refuses to shrink below its content size. Other + Nav are
          siblings (flexShrink:0) so they stay pinned to the bottom even when
          the option list overflows. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {optionListNode}
      </div>

      {otherNode}

      {/* Stable nav. Single-q hides Back+Skip — Submit is the only action.
          Multi-q: Back (hidden on first), Skip, Next/Submit. */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '10px 12px 12px', gap: 8 }}>
        {!isSingleQuestion && !atFirst && (
          <button
            type="button"
            onClick={goBack}
            style={navBtnBase}
          >
            Back
          </button>
        )}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {!isSingleQuestion && (
            <button type="button" onClick={goSkip} style={navBtnBase}>
              Skip
            </button>
          )}
          <button type="button" onClick={goNext} style={navBtnPrimary}>
            <span>{atLast ? 'Submit' : 'Next'}</span>
            <span style={kbdStyle}>⌘↵</span>
          </button>
        </div>
      </div>
    </div>
  )
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
  /** Currently lightboxed image attachment. Holds the full data so it works
   *  for both composer chips and history-rendered chips (whose attachments
   *  may not exist in the live `attachments` array). */
  const [previewImage, setPreviewImage] = useState<ImageAtt | null>(null)

  // Capability awareness: when the active model is in MODEL_QUIRKS with
  // supportsVision:false (e.g. deepseek-v4-*, mimo-v2.5-pro), warn the user
  // that any image attachments will be stripped at request time. The runtime
  // (Wave 3a in openaiFormat.ts) replaces them with a text marker so the
  // model knows an image existed; this banner closes the loop on the user
  // side so they can decide to switch model or send anyway.
  const modelSupportsVision = getModelQuirks(modelName).supportsVision !== false
  const hasImageAttachment = attachments.some(a => a.type === 'image')
  const showVisionWarning = hasImageAttachment && !modelSupportsVision

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

  const handleImageAttach = async (files: File[]) => {
    // Cap total images at MAX_IMAGES; silently drop the overflow.
    const existingImages = attachments.filter(a => a.type === 'image').length
    const slots = Math.max(0, MAX_IMAGES - existingImages)
    if (slots === 0) {
      console.warn(`[chat] Image attach ignored: already at MAX_IMAGES (${MAX_IMAGES})`)
      return
    }
    const accepted = files.slice(0, slots)
    for (const file of accepted) {
      try {
        const att = await loadImageFile(file)
        addAttachment(att)
      } catch (err) {
        const reason = err instanceof ImageAttachmentError ? err.message : 'Failed to attach image'
        console.warn('[chat] Image attach failed:', reason, file)
      }
    }
  }

  // One-shot selection snapshot: SEND_SELECTION only fires via explicit user
  // action (+ → "Add current selection"). Merges into existing chips; never
  // removes. Only X removes. Canvas operations in between are ignored.
  useEffect(() => {
    return on<SendSelectionHandler>('SEND_SELECTION', (data) => {
      if (data.selection.length === 0) return
      setAttachments(prev => {
        const existing = prev.find((a): a is Extract<ContextAttachment, { type: 'selection' }> => a.type === 'selection')
        const existingIds = new Set(existing?.nodes.map(n => n.id) ?? [])
        const newNodes = data.selection.filter(n => !existingIds.has(n.id))
        if (newNodes.length === 0) return prev
        const mergedNodes = [...(existing?.nodes ?? []), ...newNodes]
        const withoutSelection = prev.filter(a => a.type !== 'selection')
        return [...withoutSelection, { type: 'selection', nodes: mergedNodes }]
      })
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
    // When ask_user is pending, route input as free-form text override
    if (pendingQuestion && prompt.trim()) {
      respondToQuestion({ freeText: prompt.trim() })
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
  // Send-button enabled only when there's text to send. The form has its own
  // Submit button — sending freeform here means "bypass the form with this text".
  const canSubmit = !!prompt.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {/* Messages Area — wrapped to host the bottom fade overlay */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={messagesContainerStyle} ref={containerRef} className="messages-mask">
          <MessageList
            history={history}
            loading={loading}
            runtimeState={runtimeState}
            onStop={stopGeneration}
            onContinue={continueGeneration}
            anchorRef={anchorRef}
            onImagePreview={setPreviewImage}
          />

          {isEmpty && chipsState.visible && (
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: tokens.space[4],
              // PromptInput's shadow (8px y / 32px blur, plus thinking-state
              // accent glow) bleeds upward into this region. Input-area wrapper
              // has zIndex:10, so without raising the chips above it the shadow
              // paints over them. zIndex must beat input-area's 10.
              position: 'relative',
              zIndex: 20,
            }}>
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

        {/* Bottom fade — soft transition into the StatusBlock instead of a hairline border */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, transparent, ${tokens.colors.background})`,
          }}
        />
      </div>

      {/* Status bar — fixed between scroll area and input. zIndex above the
          input-area's shadow so "Waiting for answer 20s" isn't dimmed by it. */}
      {(() => {
        const lastModel = [...history].reverse().find((m: any) => m.role === 'model');
        if (!lastModel) return null;
        const state = runtimeState !== 'idle' ? runtimeState : lastModel.runState;
        if (!state) return null;
        return (
          <div style={{ flexShrink: 0, background: tokens.colors.background, position: 'relative', zIndex: 20 }}>
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

      {/* Ask User Form — separate sibling card above the input (design C2).
          Renders between StatusBlock and PromptInput. */}
      {pendingQuestion && (
        <AskUserForm
          questions={pendingQuestion.questions}
          onSubmit={(answers) => respondToQuestion({ answers })}
        />
      )}

      {/* Input Area — Flex-anchored at bottom. Top pad gives chip→composer
          breathing room (4 + 8 = 12). NO zIndex here: a stacking context
          would trap the model popover (zIndex:100) below sibling status/chips
          which are at zIndex:20. position:relative kept for any descendant
          that positions absolutely against this wrapper.
          background MUST stay transparent: the form card above casts a 32px
          downward shadow that needs to render in this region. An opaque bg
          here paints over the shadow and creates a visible clip line at the
          form's bottom edge. The body bg behind (var(--color-background))
          shows through fine. */}
      {/* Vision-capability warning — shown when the user has an image attached
          but the active model can't see images. Image content is stripped at
          request time (openaiFormat.ts) and replaced with a text marker, so
          the run won't crash, but the model also can't use the image. */}
      {showVisionWarning && (
        <div
          role="status"
          style={{
            flexShrink: 0,
            margin: `0 ${tokens.space[3]}px ${tokens.space[2]}px`,
            padding: `${tokens.space[2]}px ${tokens.space[3]}px`,
            fontSize: tokens.fontSize[1],
            lineHeight: tokens.lineHeight[2],
            color: 'var(--color-textSecondary)',
            background: 'var(--gray-3)',
            border: '1px solid var(--gray-5)',
            borderRadius: 'var(--radius-2)',
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
          }}
        >
          <span style={{ flex: 1 }}>
            <strong>{modelName}</strong> can't see images. Attachments will be ignored — switch model to use vision.
          </span>
        </div>
      )}

      <div style={{
        flexShrink: 0,
        padding: `${tokens.space[2]}px ${tokens.space[3]}px ${tokens.space[3]}px`,
        background: 'transparent',
        position: 'relative',
      }}>

        <PromptInput
          value={prompt}
          onChange={(v) => setPrompt(v)}
          onSubmit={handleGenerate}
          loading={loading}
          disabled={false}
          placeholder={pendingQuestion ? 'Or type a free-form answer…' : t.placeholder}
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
                onImageRemove: (imageId) => {
                  setAttachments(prev => prev.filter(a => !(a.type === 'image' && a.id === imageId)))
                  // If the removed image was open in the lightbox, close it.
                  if (previewImage?.id === imageId) setPreviewImage(null)
                },
                onImageClick: (att) => setPreviewImage(att),
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
          onImageAttach={handleImageAttach}
        />
      </div>

      {/* Lightbox preview — opens when any image chip (composer or history) is clicked. */}
      {previewImage && (
        <ImagePreviewModal
          mimeType={previewImage.mimeType}
          data={previewImage.data}
          name={previewImage.name}
          width={previewImage.width}
          height={previewImage.height}
          sizeKB={previewImage.sizeKB}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  )
}
