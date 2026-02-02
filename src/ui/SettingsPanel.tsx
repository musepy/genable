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
  onClose,
  localComponents = []
}: SettingsPanelProps) {
  
  const debouncedApiKey = useDebounce(apiKey, 800);
  
  useEffect(() => {
    if (debouncedApiKey && debouncedApiKey.length >= 20 && fetchStatus !== 'fetching') {
      // usage of void-returning async function
      Promise.resolve(onFetchModels()).catch(e => {
        console.warn('Silent fetch error caught in SettingsPanel:', e);
      });
    }
  }, [debouncedApiKey]);

  const getStatusIndicator = () => {
    if (fetchStatus === 'fetching') return (
      <div className="loading-dots" style={{ display: 'flex', gap: tokens.space[1] }}>
        <span style={{ width: 4, height: 4, background: tokens.colors.textSecondary, borderRadius: '50%' }} />
        <span style={{ width: 4, height: 4, background: tokens.colors.textSecondary, borderRadius: '50%' }} />
        <span style={{ width: 4, height: 4, background: tokens.colors.textSecondary, borderRadius: '50%' }} />
      </div>
    );
    // Remove success/fail icons - they add visual noise without clear purpose
    return null;
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: tokens.colors.background, // Migrated from colors.background
      fontFamily: tokens.font.sans,
      position: 'absolute',
      inset: 0,
      zIndex: 100,
    }}>
      
      {/* ===== HEADER (Simplified) ===== */}
      <div style={{ 
        padding: tokens.space[4],
        borderBottom: `1px solid ${tokens.colors.grayBorder}`,
        // No background - avoid dark mode color mismatch
      }}>
        <span style={{ 
          fontSize: tokens.fontSize[3], 
          fontWeight: tokens.fontWeight.semibold,
          color: tokens.colors.textPrimary,
        }}>
          Settings
        </span>
      </div>

      {/* ===== CONTENT (Flat Layout, No Grouping) ===== */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: tokens.space[4],
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space[5],
      }}>
        
        {/* API Key Section */}
        <div>
          <label style={{ 
            fontSize: tokens.fontSize[1], 
            fontWeight: tokens.fontWeight.medium, 
            color: tokens.colors.textPrimary,
            display: 'block',
            marginBottom: tokens.space[2],
          }}>
            API Key
          </label>
          <Input 
            type="password"
            value={apiKey}
            onInput={(e: Event) => setApiKey((e.currentTarget as HTMLInputElement).value)}
            placeholder={`Enter ${providerName === 'gemini' ? 'Gemini' : 'OpenRouter'} API Key`}
            fullWidth
            style={{
              borderColor: fetchStatus === 'fail' ? tokens.colors.error : undefined
            }}
            rightElement={getStatusIndicator()}
          />
        </div>

        {/* Provider Selection */}
        <div>
          <label style={{ 
            fontSize: tokens.fontSize[1], 
            fontWeight: tokens.fontWeight.medium, 
            color: tokens.colors.textPrimary,
            display: 'block',
            marginBottom: tokens.space[2],
          }}>
            Provider
          </label>
          <div style={{ 
            display: 'flex', 
            background: tokens.colors.surface, 
            padding: 2, 
            borderRadius: 'var(--radius-3)',
            border: `1px solid ${tokens.colors.grayBorder}`,
          }}>
      <button 
              onClick={() => {
                console.log('[Settings] Switching to Gemini (Current:', providerName, ')');
                setProviderName('gemini');
              }}
              style={{
                flex: 1,
                padding: `${tokens.space[1]}px 0`,
                fontSize: tokens.fontSize[1],
                border: 'none',
                background: providerName === 'gemini' ? tokens.colors.background : 'transparent',
                color: providerName === 'gemini' ? tokens.colors.textPrimary : tokens.colors.textSecondary,
                borderRadius: 'var(--radius-2)',
                cursor: 'pointer',
                fontWeight: providerName === 'gemini' ? tokens.fontWeight.semibold : tokens.fontWeight.regular,
                boxShadow: providerName === 'gemini' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              Gemini
            </button>
            <button 
              onClick={() => {
                console.log('[Settings] Switching to OpenRouter (Current:', providerName, ')');
                setProviderName('openrouter');
              }}
              style={{
                flex: 1,
                padding: `${tokens.space[1]}px 0`,
                fontSize: tokens.fontSize[1],
                border: 'none',
                background: providerName === 'openrouter' ? tokens.colors.background : 'transparent',
                color: providerName === 'openrouter' ? tokens.colors.textPrimary : tokens.colors.textSecondary,
                borderRadius: 'var(--radius-2)',
                cursor: 'pointer',
                fontWeight: providerName === 'openrouter' ? tokens.fontWeight.semibold : tokens.fontWeight.regular,
                boxShadow: providerName === 'openrouter' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              OpenRouter
            </button>
          </div>
        </div>

        {/* Model Section */}
        <div>
          <label style={{ 
            fontSize: tokens.fontSize[1], 
            fontWeight: tokens.fontWeight.medium, 
            color: tokens.colors.textPrimary,
            display: 'block',
            marginBottom: tokens.space[2],
          }}>
            Model
          </label>
          <ModelSelector 
            models={suggestedModels}
            selectedModel={modelName}
            onSelect={setModelName}
            isLoading={fetchStatus === 'fetching'}
          />
        </div>
        {/* Error Display */}
        {settingsError && (
          <div style={{ 
            color: tokens.colors.error,
            fontSize: tokens.fontSize[1],
            padding: tokens.space[2],
            background: tokens.colors.errorMuted,
            borderRadius: 'var(--radius-4)',
          }}>
            {settingsError}
          </div>
        )}

        <DeveloperPanel />
      </div>

      {/* ===== FOOTER ===== */}
      <div style={{ 
        padding: tokens.space[4],
        borderTop: `1px solid ${tokens.colors.grayBorder}`,
        // No background - avoid dark mode color mismatch
      }}>
        <Button 
          variant="primary" 
          fullWidth 
          size="lg" 
          onClick={onSave}
          style={{ 
            borderRadius: 'var(--radius-5)',
            height: tokens.size.button.lg,
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
