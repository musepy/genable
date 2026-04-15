/**
 * @file SettingsPanel.tsx
 * @description Settings panel - Simplified, Clean Design
 * 
 * Design Principles:
 * - Minimal decoration, maximum function
 * - No unnecessary icons or group titles
 * - Compact spacing
 */

import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { tokens, motion } from './design-system/tokens';
import { Button } from './components/Button';
import { Input } from './components/Input';
import { ModelSelector } from './components/ModelSelector';
import { useDebounce } from './hooks/useDebounce';
import { LocalComponent } from '../types';
import { DeveloperPanel } from './components/DeveloperPanel';
import { ChevronDown, Github, ExternalLink, ChevronRight, Check } from 'lucide-preact';
import { useState, useRef } from 'preact/hooks';
import { useTranslations, LOCALE_PREFS, LOCALE_PREF_LABELS, type LocalePreference } from './i18n';

export interface SettingsPanelProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  modelName: string;
  setModelName: (name: string) => void;
  providerName: 'gemini' | 'openrouter' | 'dashscope' | 'claude';
  setProviderName: (name: 'gemini' | 'openrouter' | 'dashscope' | 'claude') => void;
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
}

export function SettingsPanel({
  apiKey,
  setApiKey,
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
  localComponents = [],
  localePref,
  setLocalePref,
}: SettingsPanelProps) {
  const t = useTranslations();
  
  const [expandedProvider, setExpandedProvider] = useState<'gemini' | 'openrouter' | 'dashscope' | 'claude' | null>(providerName);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showFreeOnly, setShowFreeOnly] = useState(providerName === 'gemini');
  const [localeOpen, setLocaleOpen] = useState(false);
  const localeRef = useRef<HTMLDivElement>(null);
  
  const debouncedApiKey = useDebounce(apiKey, 800);

  // Close locale popover on click outside
  useEffect(() => {
    if (!localeOpen) return;
    const handler = (e: MouseEvent) => {
      if (localeRef.current && !localeRef.current.contains(e.target as Node)) setLocaleOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [localeOpen]);
  
  useEffect(() => {
    setShowFreeOnly(providerName === 'gemini');
  }, [providerName]);

  useEffect(() => {
    if (debouncedApiKey && debouncedApiKey.length >= 20 && fetchStatus !== 'fetching') {
      onFetchModels();
    }
  }, [debouncedApiKey]);

  const providerMetaMap: Record<string, { label: string; keyUrl: string; keyLabel: string }> = {
    gemini: { label: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyLabel: 'Google AI Studio' },
    openrouter: { label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', keyLabel: 'OpenRouter Keys' },
    dashscope: { label: 'DashScope', keyUrl: 'https://bailian.console.aliyun.com/', keyLabel: 'Alibaba Cloud Bailian' },
    claude: { label: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys', keyLabel: 'Anthropic Console' },
  };
  const providerMeta = providerMetaMap[providerName] || providerMetaMap.gemini;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-background)' }}>
      {/* ===== CONTENT (Modular Stack) ===== */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        padding: `${tokens.space[4]}px ${tokens.space[3]}px`,  // 16px vertical, 12px horizontal (scroll pad)
      }}>
        
        {/* Unified Config Settings */}
        <div style={{ marginBottom: tokens.space[6] }}>
          
          {/* Provider Toggle */}
          <div style={{ 
            display: 'flex', 
            gap: tokens.space[4], 
            borderBottom: 'var(--border-default)',
            marginBottom: tokens.space[4],
            padding: `0 ${tokens.grid.blockPad}px`,
          }}>
            {(['gemini', 'openrouter', 'dashscope', 'claude'] as const).map(p => {
              const isActive = providerName === p;
              const tabLabel = providerMetaMap[p]?.label || p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProviderName(p)}
                  style={{
                    padding: `0 0 ${tokens.space[2]}px 0`,
                    border: 'none',
                    background: 'transparent',
                    color: isActive ? 'var(--gray-12)' : 'var(--gray-9)',
                    fontSize: tokens.fontSize[1],
                    fontWeight: tokens.fontWeight.medium,
                    cursor: 'pointer',
                    position: 'relative',
                    transition: `color ${motion.duration.crisp}ms var(--ease-in-out)`,
                  }}
                >
                  {tabLabel}
                  <div style={{
                    position: 'absolute',
                    bottom: -1,
                    left: 0,
                    right: 0,
                    height: 2,
                    background: 'var(--gray-12)',
                    borderRadius: '2px 2px 0 0',
                    transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
                    transition: `transform ${motion.duration.normal}ms var(--ease-in-out)`,
                  }} />
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
            {/* Input & Link */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.space[1], padding: `0 ${tokens.grid.blockPad}px` }}>
                <span style={{ fontSize: tokens.fontSize[1], fontWeight: tokens.fontWeight.medium, color: 'var(--gray-11)' }}>{t.apiKey}</span>
                <a
                  href={providerMeta.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: tokens.fontSize[1], color: 'var(--gray-9)', textDecoration: 'none' }}
                >
                  {t.getFrom(providerMeta.keyLabel)}
                </a>
              </div>
              <Input 
                type="password"
                value={apiKey}
                onInput={(e: h.JSX.TargetedEvent<HTMLInputElement>) => {
                  setApiKey(e.currentTarget.value);
                }}
                placeholder={t.enterApiKey(providerMeta.label)}
                fullWidth
              />
            </div>

            {/* Model Selector */}
            {suggestedModels.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.space[2], padding: `0 ${tokens.grid.blockPad}px` }}>
                  <label style={{ 
                    fontSize: tokens.fontSize[1],
                    color: 'var(--gray-9)', 
                    display: 'block',
                    fontWeight: tokens.fontWeight.regular
                  }}>
                    {t.availableModels}
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowFreeOnly(v => !v)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-3)',
                      border: showFreeOnly ? '1px solid rgba(62,99,221,0.15)' : 'var(--border-subtle)',
                      background: showFreeOnly ? 'var(--accent-3)' : 'transparent',
                      color: showFreeOnly ? 'var(--accent-9)' : 'var(--gray-9)',
                      fontSize: tokens.fontSize[1],
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {t.free}
                  </button>
                </div>
                <ModelSelector 
                  models={suggestedModels}
                  selectedModel={modelName}
                  onSelect={setModelName}
                  isLoading={fetchStatus === 'fetching'}
                  showFreeOnly={showFreeOnly}
                />
              </div>
            )}
          </div>
        </div>

        {/* Language Selector */}
        {setLocalePref && (
          <div ref={localeRef} style={{ marginTop: tokens.space[6], padding: `0 ${tokens.grid.blockPad}px`, position: 'relative' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setLocaleOpen(v => !v)}
            >
              <span style={{ fontSize: tokens.fontSize[1], color: 'var(--gray-9)' }}>{t.language}</span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: tokens.space[1],
                fontSize: tokens.fontSize[1],
                color: 'var(--gray-11)',
              }}>
                {LOCALE_PREF_LABELS[localePref || 'auto']}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                  style={{ transition: 'var(--transition-normal)', transform: localeOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </div>
            {localeOpen && (
              <div
                className="popover-content"
                style={{
                  position: 'absolute',
                  right: 0,
                  top: `calc(100% + ${tokens.space[1]}px)`,
                  width: 160,
                  zIndex: tokens.zIndex.popover,
                  padding: tokens.space[1],
                }}
              >
                {LOCALE_PREFS.map(p => {
                  const isSelected = (localePref || 'auto') === p;
                  return (
                    <div
                      key={p}
                      className={`popover-item ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => { setLocalePref(p); setLocaleOpen(false); }}
                    >
                      <span style={{ flex: 1 }}>{LOCALE_PREF_LABELS[p]}</span>
                      {isSelected && <Check size={14} strokeWidth={2.5} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Developer Tools (Dogfood) */}
        <div style={{ marginTop: tokens.space[6], padding: `0 ${tokens.grid.blockPad}px` }}>
          <div
            onClick={() => setShowDeveloper(!showDeveloper)}
            style={{
              fontSize: tokens.fontSize[1],
              color: 'var(--gray-9)',
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[1],
              cursor: 'pointer',
              opacity: 0.6
            }}
          >
            <span style={motion.rotate(showDeveloper)}><ChevronDown size={12} /></span>
            {t.developerTools}
          </div>
          <div style={motion.disclosure(showDeveloper)}>
            <div style={motion.disclosureContent}>
              <div style={{ marginTop: tokens.space[3] }}>
                <DeveloperPanel
                  onLogout={onLogout}
                  onRestoreSession={onRestoreSession}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== FOOTER (Pinned to Bottom) ===== */}
      <div className="settings-footer" style={{ borderTop: 'var(--border-main)', background: 'var(--color-background)', padding: '12px 0' }}>
        <div style={{ fontWeight: tokens.fontWeight.medium, color: 'var(--gray-11)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          © 2026 Genable
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <a href="https://github.com/Muse404" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Github size={12} />
            Muse404
          </a>
          <span style={{ color: 'var(--gray-a4)' }}>|</span>
          <span style={{ color: 'var(--gray-9)' }}>v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
