import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Sparkles } from 'lucide-preact';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/Card';
import { Button } from './Button';
import { Input } from './Input';
import { tokens } from '../design-system/tokens';

interface OnboardingViewProps {
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
  onComplete, 
  onFetchModels, 
  isLoading = false, 
  error 
}: OnboardingViewProps) {
  const [apiKey, setApiKey] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

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

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: tokens.space[5],
      background: 'var(--color-background)',
    }}>
      <Card style={{ width: '100%', maxWidth: 360 }}>
        <CardHeader>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: tokens.space[2],
            marginBottom: tokens.space[1],
          }}>
            <Sparkles size={24} strokeWidth={1.5} style={{ color: 'var(--accent-9)' }} />
            <CardTitle>Connect Gemini AI</CardTitle>
          </div>
          <CardDescription>
            Enter your API key to start designing with AI.
            Get your key from{' '}
            <a 
              href="https://aistudio.google.com/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-9)', textDecoration: 'underline' }}
            >
              Google AI Studio
            </a>
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[4] }}>
            <Input
              type="password"
              placeholder="AIzaSy..."
              value={apiKey}
              onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
              style={{ 
                borderColor: displayError ? 'var(--error-9)' : undefined,
              }}
            />
            
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
            onClick={handleConnect}
          >
            Connect & Start
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
