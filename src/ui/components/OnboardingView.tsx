import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ShieldCheck, Sparkles } from 'lucide-preact';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/Card';
import { Button } from './Button';
import { Input } from './Input';
import { tokens } from '../design-system/tokens';

interface OnboardingViewProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  providerName: 'gemini' | 'openrouter';
  setProviderName: (name: 'gemini' | 'openrouter') => void;
  onComplete: (apiKey: string) => void;
  onFetchModels: (apiKey: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

/**
 * OnboardingView - Welcome screen for first-time users
 * Displays a centered Card with API Key input
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

  const providerMeta = providerName === 'openrouter'
    ? {
        label: 'OpenRouter',
        placeholder: 'sk-or-v1-...',
        keyUrl: 'https://openrouter.ai/keys',
        keyLabel: 'OpenRouter Keys',
      }
    : {
        label: 'Gemini',
        placeholder: 'AIzaSy...',
        keyUrl: 'https://aistudio.google.com/apikey',
        keyLabel: 'Google AI Studio',
      };

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
      alignItems: 'flex-start',
      justifyContent: 'center',
      height: '100%',
      padding: `${tokens.space[6]}px ${tokens.space[5]}px ${tokens.space[5]}px`,
      background: 'var(--color-background)',
    }}>
      <Card style={{ width: '100%', maxWidth: 404 }}>
        <CardHeader>
          <div style={{
            fontSize: tokens.fontSize[1],
            color: 'var(--gray-10)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: tokens.space[1],
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            border: '1px solid var(--gray-6)',
            width: 'fit-content',
            marginBottom: tokens.space[2],
          }}>
            First-time setup
          </div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: tokens.space[2],
            marginBottom: tokens.space[1],
          }}>
            <Sparkles size={24} strokeWidth={1.5} style={{ color: 'var(--accent-9)' }} />
            <CardTitle>Connect {providerMeta.label}</CardTitle>
          </div>
          <CardDescription>
            Add your API key to start generating UI. You can switch providers now and keep using the same chat flow.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[3] }}>
            <div style={{ display: 'flex', gap: tokens.space[2] }}>
              <button
                type="button"
                onClick={() => setProviderName('gemini')}
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 'var(--radius-full)',
                  border: providerName === 'gemini' ? '1px solid var(--accent-7)' : '1px solid var(--gray-6)',
                  background: providerName === 'gemini' ? 'var(--accent-3)' : 'var(--gray-2)',
                  color: providerName === 'gemini' ? 'var(--accent-11)' : 'var(--gray-11)',
                  fontSize: tokens.fontSize[1],
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Gemini
              </button>
              <button
                type="button"
                onClick={() => setProviderName('openrouter')}
                style={{
                  flex: 1,
                  height: 30,
                  borderRadius: 'var(--radius-full)',
                  border: providerName === 'openrouter' ? '1px solid var(--accent-7)' : '1px solid var(--gray-6)',
                  background: providerName === 'openrouter' ? 'var(--accent-3)' : 'var(--gray-2)',
                  color: providerName === 'openrouter' ? 'var(--accent-11)' : 'var(--gray-11)',
                  fontSize: tokens.fontSize[1],
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                OpenRouter
              </button>
            </div>

            <div>
              <div style={{ fontSize: tokens.fontSize[1], color: 'var(--gray-10)', marginBottom: tokens.space[2] }}>
                API Key
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
                      padding: 0,
                    }}
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                }
                style={{ 
                  borderColor: displayError ? 'var(--error-9)' : undefined,
                }}
              />
            </div>

            <div style={{ fontSize: tokens.fontSize[1], color: 'var(--gray-10)' }}>
              Get your key from{' '}
              <a 
                href={providerMeta.keyUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-9)', textDecoration: 'underline' }}
              >
                {providerMeta.keyLabel}
              </a>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: tokens.space[2],
              fontSize: tokens.fontSize[1],
              color: 'var(--gray-10)',
              padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
              background: 'var(--gray-2)',
              borderRadius: 'var(--radius-2)',
              border: '1px solid var(--gray-5)',
            }}>
              <ShieldCheck size={14} />
              Keys are stored in Figma client storage only.
            </div>

            {displayError && (
              <div style={{
                fontSize: tokens.fontSize[1],
                color: 'var(--error-9)',
                padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
                background: 'var(--error-3)',
                borderRadius: 'var(--radius-2)',
              }}>
                {displayError}
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <Button 
            variant="primary" 
            size="lg" 
            fullWidth 
            isLoading={isLoading}
            disabled={!canSubmit}
            onClick={handleConnect}
          >
            Connect & Start
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
