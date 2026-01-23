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

export interface SettingsPanelProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  modelName: string;
  setModelName: (name: string) => void;
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
      onFetchModels();
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
      background: tokens.colors.bg1, // Migrated from colors.background
      fontFamily: tokens.font.sans,
      position: 'absolute',
      inset: 0,
      zIndex: 100,
    }}>
      
      {/* ===== HEADER (Simplified) ===== */}
      <div style={{ 
        padding: tokens.space[4],
        borderBottom: `1px solid ${tokens.colors.border}`,
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
            placeholder="Enter Gemini API Key"
            fullWidth
            style={{
              borderColor: fetchStatus === 'fail' ? tokens.colors.destructive : undefined
            }}
            rightElement={getStatusIndicator()}
          />
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
            color: tokens.colors.destructive,
            fontSize: tokens.fontSize[1],
            padding: tokens.space[2],
            background: tokens.colors.destructiveMuted,
            borderRadius: 'var(--radius-4)',
          }}>
            {settingsError}
          </div>
        )}
      </div>

      {/* ===== FOOTER ===== */}
      <div style={{ 
        padding: tokens.space[4],
        borderTop: `1px solid ${tokens.colors.border}`,
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
