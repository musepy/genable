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
import { tokens } from './design-system/tokens';
import { Button } from './components/Button';
import { Input } from './components/Input';
import { ModelSelector } from './components/ModelSelector';
import { useDebounce } from './hooks/useDebounce';
import { LocalComponent } from '../types';
import { DeveloperPanel } from './components/DeveloperPanel';
import { ChevronDown, ChevronUp, Github, ExternalLink, ChevronRight } from 'lucide-preact';
import { useState } from 'preact/hooks';

export interface SettingsPanelProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  modelName: string;
  setModelName: (name: string) => void;
  providerName: 'gemini' | 'openrouter'; // [NEW]
  setProviderName: (name: 'gemini' | 'openrouter') => void; // [NEW]
  suggestedModels: { name: string; displayName: string }[];
  fetchStatus: 'idle' | 'fetching' | 'success' | 'fail';
  settingsError: string | null;
  onFetchModels: () => void;
  onSave: () => void;
  onLogout?: () => void;
  onRestoreSession?: () => void;
  onClose?: () => void;
  localComponents?: LocalComponent[];
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
  localComponents = []
}: SettingsPanelProps) {
  
  const [expandedProvider, setExpandedProvider] = useState<'gemini' | 'openrouter' | null>(providerName);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showFreeOnly, setShowFreeOnly] = useState(false);
  
  const debouncedApiKey = useDebounce(apiKey, 800);
  
  useEffect(() => {
    if (debouncedApiKey && debouncedApiKey.length >= 20 && fetchStatus !== 'fetching') {
      onFetchModels();
    }
  }, [debouncedApiKey]);

  const providerMeta = providerName === 'openrouter'
    ? {
        label: 'OpenRouter',
        keyUrl: 'https://openrouter.ai/keys',
        keyLabel: 'OpenRouter Keys',
      }
    : {
        label: 'Gemini',
        keyUrl: 'https://aistudio.google.com/apikey',
        keyLabel: 'Google AI Studio',
      };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-background)' }}>
      {/* ===== CONTENT (Modular Stack) ===== */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        display: 'flex',
        flexDirection: 'column',
        padding: tokens.space[4],
      }}>
        
        {/* Unified Config Settings */}
        <div style={{ marginBottom: tokens.space[6] }}>
          
          {/* Provider Toggle */}
          <div style={{ 
            display: 'flex', 
            gap: tokens.space[4], 
            borderBottom: 'var(--border-default)',
            marginBottom: tokens.space[4],
          }}>
            {['gemini', 'openrouter'].map(p => {
              const isActive = providerName === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProviderName(p as 'gemini' | 'openrouter')}
                  style={{
                    padding: `0 0 ${tokens.space[2]}px 0`,
                    border: 'none',
                    background: 'transparent',
                    color: isActive ? 'var(--gray-12)' : 'var(--gray-9)',
                    fontSize: tokens.fontSize[1],
                    fontWeight: tokens.fontWeight.medium,
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  {p === 'gemini' ? 'Gemini' : 'OpenRouter'}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      bottom: -1,
                      left: 0,
                      right: 0,
                      height: 2,
                      background: 'var(--gray-12)',
                      borderRadius: '2px 2px 0 0',
                    }} />
                  )}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1] }}>
            {/* Input & Link */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.space[1] }}>
                <span style={{ fontSize: tokens.fontSize[1], fontWeight: tokens.fontWeight.medium, color: 'var(--gray-11)' }}>API Key</span>
                <a 
                  href={providerMeta.keyUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ fontSize: tokens.fontSize[1], color: 'var(--gray-9)', textDecoration: 'none' }}
                >
                  Get from {providerMeta.keyLabel}
                </a>
              </div>
              <Input 
                type="password"
                value={apiKey}
                onInput={(e: h.JSX.TargetedEvent<HTMLInputElement>) => {
                  setApiKey(e.currentTarget.value);
                }}
                placeholder={`Enter your ${providerMeta.label} API key`}
                fullWidth
              />
            </div>

            {/* Model Selector */}
            {suggestedModels.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: tokens.space[2] }}>
                  <label style={{ 
                    fontSize: tokens.fontSize[1],
                    color: 'var(--gray-9)', 
                    display: 'block',
                    fontWeight: tokens.fontWeight.regular
                  }}>
                    available models
                  </label>
                  {providerName === 'openrouter' && (
                    <label style={{ 
                      fontSize: tokens.fontSize[1], 
                      color: 'var(--gray-11)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: tokens.space[1],
                      cursor: 'pointer'
                    }}>
                      <input 
                        type="checkbox" 
                        checked={showFreeOnly}
                        onChange={(e) => setShowFreeOnly((e.target as HTMLInputElement).checked)}
                      />
                      Show free models only
                    </label>
                  )}
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

        {/* Developer Tools (Dogfood) */}
        <div style={{ marginTop: tokens.space[6], padding: `0 var(--space-3)` }}>
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
            {showDeveloper ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Developer Tools
          </div>
          {showDeveloper && (
            <div style={{ marginTop: tokens.space[3] }}>
              <DeveloperPanel
                onLogout={onLogout}
                onRestoreSession={onRestoreSession}
              />
            </div>
          )}
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
