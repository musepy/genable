/**
 * @file SettingsPanel.tsx
 * @description Settings panel — Connections list + Active model + Pref-group + Footer
 *
 * Mock source: tools/ui-preview/settings-ab.html (B-side, lines 1557-1779)
 * CSS lives in src/ui/design-system/tokens/globalStyles.ts (search "Settings Panel — B-side mock")
 *
 * Strategy (Phase C-A): visual rewrite, schema unchanged. 4 fixed providers
 * always render as conn-rows; "Connected" / "Not configured" status derives
 * from whether apiKeys[provider] is non-empty. Custom-endpoint form (display
 * name + base URL) is omitted for now — that needs schema migration.
 */

import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Github, Heart, BookOpen, Check, X, ChevronDown, RefreshCw, ExternalLink } from 'lucide-preact';
import { LocalComponent } from '../types';
import { DeveloperPanel } from './components/DeveloperPanel';
import { useTranslations, LOCALE_PREFS, LOCALE_PREF_LABELS, type LocalePreference } from './i18n';

type ProviderName = 'gemini' | 'openrouter' | 'dashscope' | 'claude';
type ThemePref = 'auto' | 'light' | 'dark';

const PROVIDER_ORDER: ProviderName[] = ['gemini', 'openrouter', 'dashscope', 'claude'];

interface ProviderMeta {
  label: string;
  /** Where to get an API key. */
  keyUrl: string;
  keyLabel: string;
  /** Default model name shown in the active-model card when this provider has no per-provider model set. */
  defaultModelDisplay: string;
}

const PROVIDER_META: Record<ProviderName, ProviderMeta> = {
  gemini: {
    label: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyLabel: 'Google AI Studio',
    defaultModelDisplay: 'Gemini 2.5 Flash',
  },
  openrouter: {
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    keyLabel: 'OpenRouter Keys',
    defaultModelDisplay: 'OpenRouter',
  },
  dashscope: {
    label: 'DashScope',
    keyUrl: 'https://bailian.console.aliyun.com/',
    keyLabel: 'Alibaba Cloud Bailian',
    defaultModelDisplay: 'Qwen 3.6 Plus',
  },
  claude: {
    label: 'Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'Anthropic Console',
    defaultModelDisplay: 'Claude Sonnet 4',
  },
};

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export interface SettingsPanelProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  apiKeys?: Record<ProviderName, string>;
  /** Set or clear (key === '') a specific provider's key, persisting immediately. */
  setApiKeyFor?: (provider: ProviderName, key: string) => void;
  modelName: string;
  setModelName: (name: string) => void;
  providerName: ProviderName;
  setProviderName: (name: ProviderName) => void;
  suggestedModels: { name: string; displayName: string }[];
  fetchStatus: 'idle' | 'fetching' | 'success' | 'fail';
  settingsError: string | null;
  onFetchModels: () => void;
  onSave: () => void;
  onLogout?: () => void;
  onRestoreSession?: () => void;
  onClose?: () => void;
  localComponents?: LocalComponent[];
  localePref?: LocalePreference;
  setLocalePref?: (pref: LocalePreference) => void;
  theme?: ThemePref;
  setTheme?: (t: ThemePref) => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    apiKey,
    setApiKey,
    apiKeys: apiKeysProp,
    setApiKeyFor,
    modelName,
    setModelName,
    providerName,
    setProviderName,
    suggestedModels,
    fetchStatus,
    settingsError,
    onFetchModels,
    onSave,
    onLogout,
    onRestoreSession,
    onClose,
    localePref = 'auto',
    setLocalePref,
    theme = 'auto',
    setTheme,
  } = props;

  const t = useTranslations();

  // Fallback when parent didn't pass apiKeys (e.g. capture-sandbox renders).
  // Build from current single apiKey + providerName.
  const apiKeys: Record<ProviderName, string> = apiKeysProp ?? {
    gemini: providerName === 'gemini' ? apiKey : '',
    openrouter: providerName === 'openrouter' ? apiKey : '',
    dashscope: providerName === 'dashscope' ? apiKey : '',
    claude: providerName === 'claude' ? apiKey : '',
  };

  // ── State ────────────────────────────────────────────────────────────────
  const [expandedProvider, setExpandedProvider] = useState<ProviderName | null>(providerName);
  const [confirmingProvider, setConfirmingProvider] = useState<ProviderName | null>(null);
  /** Per-provider in-progress key edit (controlled inputs). */
  const [keyDrafts, setKeyDrafts] = useState<Record<ProviderName, string>>({
    gemini: '', openrouter: '', dashscope: '', claude: '',
  });
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [langPopoverOpen, setLangPopoverOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState('');

  // ── Refs ─────────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const segPillRef = useRef<HTMLSpanElement | null>(null);
  const modelTriggerRef = useRef<HTMLDivElement | null>(null);
  const modelPopoverRef = useRef<HTMLDivElement | null>(null);
  const langTriggerRef = useRef<HTMLSpanElement | null>(null);
  const langPopoverRef = useRef<HTMLDivElement | null>(null);
  const modelFilterInputRef = useRef<HTMLInputElement | null>(null);

  // Sync drafts with stored keys when keys change externally
  useEffect(() => {
    setKeyDrafts(prev => ({
      gemini: apiKeys.gemini || prev.gemini,
      openrouter: apiKeys.openrouter || prev.openrouter,
      dashscope: apiKeys.dashscope || prev.dashscope,
      claude: apiKeys.claude || prev.claude,
    }));
  }, [apiKeys.gemini, apiKeys.openrouter, apiKeys.dashscope, apiKeys.claude]);

  // ── Theme seg-pill: position the sliding active pill via CSS vars ────────
  useLayoutEffect(() => {
    const pill = segPillRef.current;
    if (!pill) return;
    const segs = pill.querySelectorAll<HTMLElement>('.seg');
    const idx = THEME_OPTIONS.findIndex(o => o.value === theme);
    const active = segs[idx];
    if (!active) return;
    pill.style.setProperty('--seg-x', `${active.offsetLeft}px`);
    pill.style.setProperty('--seg-w', `${active.offsetWidth}px`);
  }, [theme]);

  // ── Active-model popover positioning (open downward) ─────────────────────
  useLayoutEffect(() => {
    if (!modelPopoverOpen) return;
    const trigger = modelTriggerRef.current;
    const popover = modelPopoverRef.current;
    const root = rootRef.current;
    if (!trigger || !popover || !root) return;

    const tr = trigger.getBoundingClientRect();
    const rr = root.getBoundingClientRect();

    popover.style.left = `${tr.left - rr.left}px`;
    popover.style.top = `${tr.bottom - rr.top + 4}px`;
    popover.style.right = 'auto';
    popover.style.bottom = 'auto';
    popover.style.width = `${tr.width}px`;
    popover.style.maxHeight = `${Math.max(160, rr.bottom - tr.bottom - 16)}px`;

    // Auto-focus filter input on open
    setTimeout(() => modelFilterInputRef.current?.focus(), 0);
  }, [modelPopoverOpen]);

  // ── Language popover positioning (open upward, right-aligned to .rhs) ───
  useLayoutEffect(() => {
    if (!langPopoverOpen) return;
    const trigger = langTriggerRef.current;
    const popover = langPopoverRef.current;
    const root = rootRef.current;
    if (!trigger || !popover || !root) return;

    const tr = trigger.getBoundingClientRect();
    const rr = root.getBoundingClientRect();

    popover.style.left = 'auto';
    popover.style.right = `${rr.right - tr.right}px`;
    popover.style.bottom = `${rr.bottom - tr.top + 4}px`;
    popover.style.top = 'auto';
  }, [langPopoverOpen]);

  // ── Outside-click closes either popover ──────────────────────────────────
  useEffect(() => {
    if (!modelPopoverOpen && !langPopoverOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (modelPopoverOpen) {
        if (modelPopoverRef.current?.contains(t)) return;
        if (modelTriggerRef.current?.contains(t)) return;
        setModelPopoverOpen(false);
      }
      if (langPopoverOpen) {
        if (langPopoverRef.current?.contains(t)) return;
        if (langTriggerRef.current?.contains(t)) return;
        setLangPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [modelPopoverOpen, langPopoverOpen]);

  // ── Esc closes popovers / cancels confirming ─────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modelPopoverOpen) { setModelPopoverOpen(false); return; }
      if (langPopoverOpen) { setLangPopoverOpen(false); return; }
      if (confirmingProvider) { setConfirmingProvider(null); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modelPopoverOpen, langPopoverOpen, confirmingProvider]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const connectedCount = PROVIDER_ORDER.filter(p => Boolean(apiKeys[p])).length;
  const activeProviderHasKey = Boolean(apiKeys[providerName]);
  const meta = PROVIDER_META[providerName];

  // Active model display: prefer matching displayName from suggestedModels list
  const activeModelDisplayName = (() => {
    const norm = (s: string) => s.toLowerCase().replace(/^models\//, '').replace(/[^a-z0-9]/g, '');
    const found = suggestedModels.find(m => norm(m.name) === norm(modelName));
    if (found?.displayName) return found.displayName;
    if (modelName) {
      // Last-resort prettifier: strip "models/" prefix, replace dashes with spaces
      return modelName.split('/').pop()?.replace(/-/g, ' ') || modelName;
    }
    return meta.defaultModelDisplay;
  })();

  const filteredModels = (() => {
    if (!modelFilter.trim()) return suggestedModels;
    const f = modelFilter.toLowerCase();
    return suggestedModels.filter(m =>
      m.displayName.toLowerCase().includes(f) || m.name.toLowerCase().includes(f)
    );
  })();

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleConnRowClick = (p: ProviderName, e: h.JSX.TargetedEvent<HTMLDivElement>) => {
    // Click radio → set active. Click body → expand/collapse.
    const target = e.target as HTMLElement;
    if (target.closest('.radio')) {
      if (apiKeys[p]) setProviderName(p);
      return;
    }
    setExpandedProvider(prev => prev === p ? null : p);
    if (confirmingProvider && confirmingProvider !== p) setConfirmingProvider(null);
  };

  const handleDeleteClick = (p: ProviderName) => {
    if (confirmingProvider === p) {
      // Second click → actually clear the key. Row stays (4 fixed providers),
      // it just transitions back to "Not configured" via natural re-render.
      setConfirmingProvider(null);
      setKeyDrafts(prev => ({ ...prev, [p]: '' }));
      setApiKeyFor?.(p, '');
      if (apiKeysProp == null) setApiKey('');
      // If removed provider was active and other keys exist, switch.
      if (providerName === p) {
        const next = PROVIDER_ORDER.find(x => x !== p && apiKeys[x]);
        if (next) setProviderName(next);
      }
    } else {
      setConfirmingProvider(p);
    }
  };

  const handleCancelConfirm = () => setConfirmingProvider(null);

  const handleSaveKey = (p: ProviderName) => {
    const draft = (keyDrafts[p] || '').trim();
    if (!draft) return;
    setApiKeyFor?.(p, draft);
    if (apiKeysProp == null && p === providerName) setApiKey(draft);
    // Trigger a model fetch if this is the active provider
    if (p === providerName) {
      setTimeout(() => onFetchModels(), 50);
    }
  };

  const handleSelectModel = (name: string) => {
    setModelName(name);
    setModelPopoverOpen(false);
  };

  const handleSelectLocale = (l: LocalePreference) => {
    setLocalePref?.(l);
    setLangPopoverOpen(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
      }}
    >
      <div className="plugin-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div className="settings-body">
          {/* Connections section */}
          <div className="row-label">
            <span className="lhs">Connections</span>
            <span className="rhs-link">{connectedCount} connected · {connectedCount} of 4</span>
          </div>

          <div className="conn-list">
            {PROVIDER_ORDER.map((p, idx) => {
              const m = PROVIDER_META[p];
              const hasKey = Boolean(apiKeys[p]);
              const isActive = providerName === p;
              const isExpanded = expandedProvider === p;
              const isConfirming = confirmingProvider === p;
              const isInvalid = isActive && hasKey && fetchStatus === 'fail';

              const rowClass = [
                'conn-row',
                isActive && 'is-active',
                isExpanded && 'is-open',
                isConfirming && 'is-confirming',
              ].filter(Boolean).join(' ');

              const expandClass = 'conn-expand';

              return (
                <Fragment key={p}>
                  <div
                    className={rowClass}
                    onClick={(e) => handleConnRowClick(p, e)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="name">{m.label}</span>
                    <span className={`meta-line ${isInvalid ? 'is-error' : ''}`}>
                      {!hasKey ? 'Not configured' : isInvalid ? 'Key invalid' : 'Connected'}
                    </span>
                    <span className="actions">
                      <span
                        className={`radio ${isActive && hasKey ? 'checked' : ''} ${!hasKey ? 'disabled' : ''}`}
                        aria-label={isActive ? 'Active routing target' : 'Set as active routing target'}
                        role="radio"
                        aria-checked={isActive && hasKey}
                      />
                    </span>
                  </div>
                  <div className={expandClass}>
                    <div className="conn-expand-inner">
                      <div className="conn-expand-body">
                        <div className="key-row">
                          <input
                            className="key-input"
                            type="password"
                            value={keyDrafts[p] || ''}
                            placeholder={`Enter ${m.label} API key`}
                            onInput={(e) => {
                              const v = (e.target as HTMLInputElement).value;
                              setKeyDrafts(prev => ({ ...prev, [p]: v }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveKey(p);
                            }}
                          />
                          {hasKey && isInvalid && (
                            <button
                              className="test-btn"
                              type="button"
                              onClick={() => { handleSaveKey(p); }}
                            >
                              Retry
                            </button>
                          )}
                          {!hasKey && (keyDrafts[p] || '').length >= 10 && (
                            <button
                              className={`test-btn ${fetchStatus === 'fetching' ? 'testing' : ''}`}
                              type="button"
                              onClick={() => handleSaveKey(p)}
                              disabled={(fetchStatus as string) === 'fetching'}
                            >
                              {(fetchStatus as string) === 'fetching' ? 'Testing…' : 'Save'}
                            </button>
                          )}
                          <button
                            className="cancel-btn"
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleCancelConfirm(); }}
                          >
                            Cancel
                          </button>
                          {hasKey && (
                            <button
                              className="delete-x"
                              type="button"
                              aria-label={`Remove ${m.label} connection`}
                              title={`Remove ${m.label}?`}
                              onClick={(e) => { e.stopPropagation(); handleDeleteClick(p); }}
                            >
                              <span className="x-icon">
                                <X size={10} strokeWidth={2.5} />
                              </span>
                              <span className="rm-label">Remove</span>
                            </button>
                          )}
                        </div>
                        <div className="help-row">
                          <a href={m.keyUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            Get key from {m.keyLabel}
                            <ExternalLink size={10} strokeWidth={1.5} />
                          </a>
                          <span className={`status ${isInvalid ? 'is-error' : ''}`}>
                            {!hasKey
                              ? 'Not tested yet'
                              : isInvalid
                                ? (settingsError || 'Key invalid')
                                : isActive && fetchStatus === 'fetching'
                                  ? 'Testing…'
                                  : `Connected · ${suggestedModels.length || '?'} model${suggestedModels.length === 1 ? '' : 's'}`
                            }
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>

          {/* Active model card */}
          <div className="active-model-wrap">
            <div
              ref={modelTriggerRef}
              className={`active-model ${modelPopoverOpen ? 'is-open' : ''}`}
              onClick={() => activeProviderHasKey && setModelPopoverOpen(o => !o)}
              role="button"
              tabIndex={0}
              aria-haspopup="listbox"
              aria-expanded={modelPopoverOpen}
              style={{ opacity: activeProviderHasKey ? 1 : 0.5, cursor: activeProviderHasKey ? 'pointer' : 'not-allowed' }}
            >
              <div className="model-info">
                <div className="model-name">{activeModelDisplayName}</div>
              </div>
              <ChevronDown className="chev" size={12} strokeWidth={1.8} />
            </div>
          </div>

          {/* Pref-group: Theme + Language */}
          <div className="pref-group">
            <div className="pref-row">
              <span className="lhs">Theme</span>
              <span className="seg-pill" ref={segPillRef}>
                {THEME_OPTIONS.map(opt => (
                  <span
                    key={opt.value}
                    className={`seg ${theme === opt.value ? 'active' : ''}`}
                    onClick={() => setTheme?.(opt.value)}
                    role="button"
                    tabIndex={0}
                  >
                    {opt.label}
                  </span>
                ))}
              </span>
            </div>
            <div className="pref-row pref-row-lang">
              <span className="lhs">{t.language}</span>
              <span
                ref={langTriggerRef}
                className={`rhs ${langPopoverOpen ? 'is-open' : ''}`}
                data-lang-trigger
                tabIndex={0}
                role="button"
                aria-haspopup="listbox"
                aria-expanded={langPopoverOpen}
                onClick={() => setLangPopoverOpen(o => !o)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLangPopoverOpen(o => !o); }
                }}
              >
                <span data-lang-label>{LOCALE_PREF_LABELS[localePref]}</span>
                <ChevronDown className="chev" size={12} strokeWidth={1.8} />
              </span>
            </div>
          </div>

          {/* Developer Tools (Dogfood) — preserved from previous panel */}
          <div className="dev-disclosure">
            <button
              className="dd-toggle"
              type="button"
              onClick={() => setShowDeveloper(s => !s)}
              aria-expanded={showDeveloper}
            >
              <span style={{ display: 'inline-flex', transform: showDeveloper ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }}>
                <ChevronDown size={12} strokeWidth={1.5} style={{ transform: 'rotate(-90deg)' }} />
              </span>
              {t.developerTools}
            </button>
            {showDeveloper && (
              <div style={{ marginTop: 8 }}>
                <DeveloperPanel
                  onLogout={onLogout}
                  onRestoreSession={onRestoreSession}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer-b: Sponsor / Docs / GitHub + © · v1.0.0 */}
      <div className="footer-b">
        <div className="links">
          <a href="https://github.com/sponsors/Muse404" target="_blank" rel="noopener noreferrer" title="Sponsor on GitHub">
            <Heart size={11} strokeWidth={1.8} className="heart" />
            Sponsor
          </a>
          <a href="https://github.com/Muse404" target="_blank" rel="noopener noreferrer">
            <BookOpen size={11} strokeWidth={1.8} />
            Docs
          </a>
          <a href="https://github.com/Muse404" target="_blank" rel="noopener noreferrer">
            <Github size={11} strokeWidth={1.8} />
            GitHub
          </a>
        </div>
        <div className="copy">© 2026 Genable · v1.0.0</div>
      </div>

      {/* Hoisted Active-model popover */}
      {modelPopoverOpen && (
        <div ref={modelPopoverRef} className="model-popover" role="listbox" aria-label="Select model">
          <div className="pop-filter" data-typed={modelFilter ? 'true' : 'false'}>
            <input
              ref={modelFilterInputRef}
              type="text"
              placeholder="Filter models…"
              value={modelFilter}
              onInput={(e) => setModelFilter((e.target as HTMLInputElement).value)}
            />
            {modelFilter && (
              <button className="pf-clear" type="button" aria-label="Clear filter" onClick={() => setModelFilter('')}>
                <X size={10} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="pop-list">
            {filteredModels.length === 0 ? (
              <div className="pop-empty">No models match "{modelFilter}"</div>
            ) : (
              filteredModels.map(m => {
                const norm = (s: string) => s.toLowerCase().replace(/^models\//, '').replace(/[^a-z0-9]/g, '');
                const isSelected = norm(m.name) === norm(modelName);
                return (
                  <div
                    key={m.name}
                    className={`pop-item ${isSelected ? 'is-selected' : ''}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectModel(m.name)}
                  >
                    <span className="pi-name">{m.displayName || m.name}</span>
                    {isSelected && <Check className="pi-check" size={12} strokeWidth={2.5} />}
                  </div>
                );
              })
            )}
          </div>
          <div className="pop-footer">
            <div
              className="pop-footer-row"
              onClick={() => { onFetchModels(); }}
              role="button"
            >
              <RefreshCw size={10} strokeWidth={1.8} className={fetchStatus === 'fetching' ? 'is-spinning' : ''} />
              {fetchStatus === 'fetching' ? 'Refreshing…' : 'Refresh model list'}
            </div>
          </div>
        </div>
      )}

      {/* Hoisted Language popover (no filter, opens upward) */}
      {langPopoverOpen && (
        <div
          ref={langPopoverRef}
          className="model-popover"
          role="listbox"
          aria-label="Select language"
          style={{ width: 'max-content', minWidth: 96, maxWidth: 160 }}
        >
          <div className="pop-list">
            {LOCALE_PREFS.map(p => {
              const isSelected = localePref === p;
              return (
                <div
                  key={p}
                  className={`pop-item ${isSelected ? 'is-selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectLocale(p)}
                >
                  <span className="pi-name">{LOCALE_PREF_LABELS[p]}</span>
                  {isSelected && <Check className="pi-check" size={12} strokeWidth={2.5} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
