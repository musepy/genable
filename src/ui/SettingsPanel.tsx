/**
 * @file SettingsPanel.tsx
 * @description V2 (Phase 7) Settings — protocol-based provider list. Replaces
 * the per-vendor 4-row hardcoding with a generic list driven by the
 * ProviderConfig array surfaced by useModelSettings.
 *
 * Structure (mirroring tools/ui-preview/settings-ab-v2-protocol.html §2 + §3):
 *   header / × close
 *   Settings subhead
 *   PROVIDERS section — list (or empty state) + Add Provider button + Add/Edit form
 *   APPEARANCE — Language popover + Theme seg-pill
 *   DEVELOPER (collapsed disclosure)
 *   footer (sponsor links + privacy)
 *
 * The Theme + Language + DeveloperPanel + footer match the prior visual.
 */

import { h, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Github, Heart, Check, ChevronDown } from 'lucide-preact';
import type { LocalComponent } from '../types';
import type { ProviderConfig, ProviderProbeResult } from '../types/provider';
import { DeveloperPanel } from './components/DeveloperPanel';
import { ProviderRow } from './components/ProviderRow';
import { AddProviderForm } from './components/AddProviderForm';
import { useTranslations, LOCALE_PREFS, LOCALE_PREF_LABELS, type LocalePreference } from './i18n';

type ThemePref = 'auto' | 'light' | 'dark';

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export interface SettingsPanelProps {
  // V2 provider state (from useModelSettings)
  providers: ProviderConfig[];
  activeProviderId: string | null;
  addProvider: (cfg: Omit<ProviderConfig, 'id'>) => string;
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void;
  removeProvider: (id: string) => void;
  setActiveProviderId: (id: string) => void;
  validateProvider: (cfg: ProviderConfig) => Promise<ProviderProbeResult>;

  // Lifecycle
  onLogout?: () => void;
  onRestoreSession?: () => void;
  onClose?: () => void;
  localComponents?: LocalComponent[];

  // Prefs
  localePref?: LocalePreference;
  setLocalePref?: (pref: LocalePreference) => void;
  theme?: ThemePref;
  setTheme?: (t: ThemePref) => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    providers,
    activeProviderId,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProviderId,
    validateProvider,
    onLogout,
    onRestoreSession,
    localePref = 'auto',
    setLocalePref,
    theme = 'auto',
    setTheme,
  } = props;

  const t = useTranslations();

  // ── State ────────────────────────────────────────────────────────────────
  /** 'closed' | 'add' | { kind: 'edit', id } */
  type FormState = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; id: string };
  const [formState, setFormState] = useState<FormState>({ kind: 'closed' });

  const [showDeveloper, setShowDeveloper] = useState(false);
  const [langPopoverOpen, setLangPopoverOpen] = useState(false);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const segPillRef = useRef<HTMLSpanElement | null>(null);
  const langTriggerRef = useRef<HTMLSpanElement | null>(null);
  const langPopoverRef = useRef<HTMLDivElement | null>(null);

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

  // ── Language popover positioning (open upward, right-aligned) ────────────
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

  // ── Outside-click closes language popover ────────────────────────────────
  useEffect(() => {
    if (!langPopoverOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (langPopoverRef.current?.contains(t)) return;
      if (langTriggerRef.current?.contains(t)) return;
      setLangPopoverOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [langPopoverOpen]);

  // ── Esc closes popover / form ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (langPopoverOpen) { setLangPopoverOpen(false); return; }
      if (formState.kind !== 'closed') { setFormState({ kind: 'closed' }); return; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [langPopoverOpen, formState]);

  // ── Form handlers ────────────────────────────────────────────────────────
  const handleAddProvider = (cfg: Omit<ProviderConfig, 'id'>) => {
    addProvider(cfg);
    setFormState({ kind: 'closed' });
  };

  const handleUpdateProvider = (id: string, cfg: Omit<ProviderConfig, 'id'>) => {
    updateProvider(id, cfg);
    setFormState({ kind: 'closed' });
  };

  const handleRemoveProvider = (id: string) => {
    removeProvider(id);
    setFormState({ kind: 'closed' });
  };

  const handleSelectLocale = (l: LocalePreference) => {
    setLocalePref?.(l);
    setLangPopoverOpen(false);
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const editingProvider =
    formState.kind === 'edit' ? providers.find(p => p.id === formState.id) : undefined;

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
      <div
        className="plugin-scroll"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="settings-body">
          {/* PROVIDERS section */}
          <div className="row-label">
            <span className="lhs">Providers</span>
            {providers.length > 0 && (
              <span className="rhs-link">
                {providers.length} configured
              </span>
            )}
          </div>

          {providers.length === 0 ? (
            <div className="provider-list empty">
              <div className="provider-empty-icon">🔌</div>
              <div className="provider-empty-title">No providers configured</div>
              <div className="provider-empty-sub">
                Add an LLM provider to start generating designs.
              </div>
            </div>
          ) : (
            <div className="provider-list">
              {providers.map(p => (
                <ProviderRow
                  key={p.id}
                  config={p}
                  isActive={p.id === activeProviderId}
                  onSelect={() => setActiveProviderId(p.id)}
                  onEdit={() => setFormState({ kind: 'edit', id: p.id })}
                />
              ))}
            </div>
          )}

          {formState.kind === 'closed' && (
            <button
              type="button"
              className="add-btn"
              onClick={() => setFormState({ kind: 'add' })}
            >
              + Add Provider
            </button>
          )}

          {formState.kind === 'add' && (
            <AddProviderForm
              mode="add"
              onSave={handleAddProvider}
              onCancel={() => setFormState({ kind: 'closed' })}
              onValidate={validateProvider}
            />
          )}

          {formState.kind === 'edit' && editingProvider && (
            <AddProviderForm
              mode="edit"
              initial={editingProvider}
              onSave={(cfg) => handleUpdateProvider(editingProvider.id, cfg)}
              onRemove={() => handleRemoveProvider(editingProvider.id)}
              onCancel={() => setFormState({ kind: 'closed' })}
              onValidate={validateProvider}
            />
          )}

          {/* APPEARANCE section: Theme + Language */}
          <div className="row-label" style={{ marginTop: 24 }}>
            <span className="lhs">Appearance</span>
          </div>
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
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setLangPopoverOpen(o => !o);
                  }
                }}
              >
                <span data-lang-label>{LOCALE_PREF_LABELS[localePref]}</span>
                <ChevronDown className="chev" size={12} strokeWidth={1.8} />
              </span>
            </div>
          </div>

          {/* DEVELOPER (Dogfood) — preserved disclosure */}
          <div className="dev-disclosure">
            <button
              className="dd-toggle"
              type="button"
              onClick={() => setShowDeveloper(s => !s)}
              aria-expanded={showDeveloper}
            >
              <span
                style={{
                  display: 'inline-flex',
                  transform: showDeveloper ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms ease',
                }}
              >
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

      {/* Footer: Sponsor / GitHub links */}
      <div className="footer-b">
        <div className="links">
          <a
            href="https://www.patreon.com/c/musec"
            target="_blank"
            rel="noopener noreferrer"
            title="Sponsor on Patreon"
          >
            <Heart size={11} strokeWidth={1.8} className="heart" />
            Sponsor
          </a>
          <a href="https://github.com/musepy/genable" target="_blank" rel="noopener noreferrer">
            <Github size={11} strokeWidth={1.8} />
            GitHub
          </a>
        </div>
        <div className="copy">© 2026 Genable · v1.0.0</div>
      </div>

      {/* Hoisted Language popover */}
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
