import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button } from './Button';
import { Input } from './Input';
import { tokens } from '../design-system/tokens';

interface OnboardingViewProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  providerName: 'gemini' | 'openrouter' | 'dashscope';
  setProviderName: (name: 'gemini' | 'openrouter' | 'dashscope') => void;
  onComplete: (apiKey: string) => void;
  onFetchModels: (apiKey: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

/**
 * OnboardingView - Welcome screen for first-time users
 * Displays a concise form to connect an API key
 */
export function OnboardingView({ 
  apiKey,
  setApiKey,
  providerName,
  setProviderName,
  onComplete, 
  onFetchModels, 
  isLoading = false, 
  error,
}: OnboardingViewProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    setLocalError(null);
  }, [providerName]);

  const providerMetaMap: Record<string, { label: string; placeholder: string; keyUrl: string; keyLabel: string }> = {
    gemini: { label: 'Gemini', placeholder: 'AIzaSy...', keyUrl: 'https://aistudio.google.com/apikey', keyLabel: 'Google AI Studio' },
    openrouter: { label: 'OpenRouter', placeholder: 'sk-or-v1-...', keyUrl: 'https://openrouter.ai/keys', keyLabel: 'OpenRouter Keys' },
    dashscope: { label: 'DashScope', placeholder: 'sk-...', keyUrl: 'https://bailian.console.aliyun.com/', keyLabel: 'Alibaba Cloud Bailian' },
  };
  const providerMeta = providerMetaMap[providerName] || providerMetaMap.gemini;

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      setLocalError('Please enter your API key');
      return;
    }
    
    setLocalError(null);
    
    try {
      // Verify key first by fetching models
      await onFetchModels(apiKey);
      // If successful, complete onboarding
      onComplete(apiKey);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to connect');
    }
  };

  const displayError = error || localError;
  const canSubmit = apiKey.trim().length > 0 && !isLoading;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: `${tokens.space[4]}px ${tokens.space[3]}px`,  // 16px vertical, 12px horizontal (scroll pad)
      background: 'var(--color-background)',
      boxSizing: 'border-box',
    }}>
      <div style={{ marginBottom: tokens.space[5] }}>
        <h2 style={{ fontSize: tokens.fontSize[2], fontWeight: tokens.fontWeight.medium, margin: 0, color: 'var(--gray-12)' }}>
          Setup Connection
        </h2>
      </div>

      <div style={{ 
        display: 'flex', 
        gap: tokens.space[4], 
        borderBottom: 'var(--border-default)',
        marginBottom: tokens.space[4],
      }}>
        {(['gemini', 'openrouter', 'dashscope'] as const).map(p => {
          const isActive = providerName === p;
          const label = p === 'gemini' ? 'Gemini' : p === 'openrouter' ? 'OpenRouter' : 'DashScope';
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
              }}
            >
              {label}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          type={showApiKey ? 'text' : 'password'}
          placeholder={providerMeta.placeholder}
          value={apiKey}
          onInput={(e) => {
            setApiKey((e.target as HTMLInputElement).value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              handleConnect();
            }
          }}
          rightElement={
            <button
              type="button"
              onClick={() => setShowApiKey(prev => !prev)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--gray-10)',
                cursor: 'pointer',
                fontSize: tokens.fontSize[1],
                padding: '0 4px',
              }}
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          }
          style={{ borderColor: displayError ? 'var(--error-9)' : undefined }}
        />
        
        <div style={{ fontSize: '10px', color: 'var(--gray-9)' }}>
          Keys are stored locally in Figma client storage.
        </div>
      </div>

      {displayError && (
        <div style={{
          fontSize: tokens.fontSize[1],
          color: 'var(--error-11)',
          padding: `${tokens.space[2]}px`,
          background: 'var(--error-3)',
          borderRadius: 'var(--radius-2)',
          border: '1px solid var(--error-6)',
        }}>
          {displayError}
        </div>
      )}

      <div style={{ marginTop: 'auto', paddingTop: tokens.space[4] }}>
        <Button 
          variant="primary" 
          fullWidth 
          isLoading={isLoading}
          disabled={!canSubmit}
          onClick={handleConnect}
        >
          Connect & Start
        </Button>
      </div>
    </div>
  );
}
