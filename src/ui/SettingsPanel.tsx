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
  onSimulateLogout?: () => void;
  onSimulateEmptyState?: () => void;
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
  onSimulateLogout,
  onSimulateEmptyState,
  onRestoreSession,
  onClose,
  localComponents = []
}: SettingsPanelProps) {
  
  const [expandedProvider, setExpandedProvider] = useState<'gemini' | 'openrouter' | null>(providerName);
  const [showDeveloper, setShowDeveloper] = useState(false);
  
  const debouncedApiKey = useDebounce(apiKey, 800);
  
  useEffect(() => {
    if (debouncedApiKey && debouncedApiKey.length >= 20 && fetchStatus !== 'fetching') {
      onFetchModels();
    }
  }, [debouncedApiKey]);

  const renderApiModule = (name: string, provider: 'gemini' | 'openrouter') => {
    const isExpanded = expandedProvider === provider;
    const isCurrent = providerName === provider;
    
    const ArrowIcon = ({ expanded }: { expanded: boolean }) => (
      <svg 
        width="10" 
        height="10" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2.5"
        style={{
          transition: 'transform 200ms ease',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          color: 'var(--gray-9)'
        }}
      >
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );

    return (
      <div className={`api-module-box ${isExpanded ? 'is-expanded' : ''} ${isCurrent ? 'is-selected' : ''}`}>
        <div 
          className="api-module-header" 
          onClick={() => {
            setExpandedProvider(isExpanded ? null : provider);
            setProviderName(provider);
          }}
        >
          <div className="api-module-title" style={{ fontSize: tokens.fontSize[2], fontWeight: 400 }}>
            <span style={{ color: 'var(--gray-11)' }}>{name} API Key</span>
          </div>
          <ArrowIcon expanded={isExpanded} />
        </div>
        
        <div className="api-module-content">
          <div className="api-expand-inner">
            <div style={{ marginBottom: tokens.space[4] }}>
              <Input 
                type="password"
                value={isCurrent ? apiKey : ''}
                onInput={(e: h.JSX.TargetedEvent<HTMLInputElement>) => {
                  if (!isCurrent) setProviderName(provider);
                  setApiKey(e.currentTarget.value);
                }}
                placeholder="Enter your API key"
                fullWidth
                style={{ 
                  height: 32,
                  fontSize: tokens.fontSize[1],
                  border: 'var(--border-main)', 
                  borderRadius: 'var(--radius-5)'
                }}
              />
            </div>
            
            <div style={{ marginBottom: tokens.space[1] }}>
              <label style={{ 
                fontSize: tokens.fontSize[1],
                color: 'var(--gray-9)', 
                marginBottom: tokens.space[2], 
                display: 'block',
                fontWeight: 400
              }}>
                available
              </label>
              <ModelSelector 
                models={isCurrent ? suggestedModels : []}
                selectedModel={isCurrent ? modelName : ''}
                onSelect={setModelName}
                isLoading={isCurrent && fetchStatus === 'fetching'}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-background)' }}>
      {/* ===== CONTENT (Modular Stack) ===== */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Modular API Stack */}
        <div className="api-stack-container">
          {renderApiModule('Gemini', 'gemini')}
          {renderApiModule('OpenRouter', 'openrouter')}
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
                onSimulateLogout={onSimulateLogout}
                onSimulateEmptyState={onSimulateEmptyState}
                onRestoreSession={onRestoreSession}
              />
            </div>
          )}
        </div>
      </div>

      {/* ===== FOOTER (Pinned to Bottom) ===== */}
      <div className="settings-footer" style={{ borderTop: 'var(--border-main)', background: 'var(--color-background)', padding: '12px 0' }}>
        <div style={{ fontWeight: 500, color: 'var(--gray-11)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
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
