import { h, Fragment } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';
import { tokens } from '../design-system/tokens';
import { grid } from '../design-system/tokens/layout';

type ProviderName = 'gemini' | 'openrouter' | 'dashscope';
type OnboardStep = 'idle' | 'connecting' | 'error';

/** Detect provider from API key prefix */
function detectProvider(key: string): { provider: ProviderName; label: string } | null {
  const k = key.trim();
  if (k.startsWith('AIzaSy')) return { provider: 'gemini', label: 'Google Gemini' };
  if (k.startsWith('sk-or-v1-')) return { provider: 'openrouter', label: 'OpenRouter' };
  if (k.startsWith('sk-ant-')) return { provider: 'openrouter', label: 'Anthropic' }; // OpenAI-compatible via proxy
  if (k.length > 10) return { provider: 'dashscope', label: 'OpenAI Compatible' }; // fallback
  return null;
}

/** Mask API key for display */
function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return key.slice(0, 10) + '••••••••';
}

interface OnboardingViewProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  providerName: ProviderName;
  setProviderName: (name: ProviderName) => void;
  onComplete: (apiKey: string) => void;
  onFetchModels: (apiKey: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
}

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
  const [step, setStep] = useState<OnboardStep>('idle');
  const [localError, setLocalError] = useState<string | null>(null);
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);
  const [maskedKey, setMaskedKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset error when typing
  useEffect(() => {
    if (step === 'error') {
      setStep('idle');
      setLocalError(null);
    }
  }, [apiKey]);

  const handleSubmit = async () => {
    const key = apiKey.trim();
    if (!key) return;

    const detected = detectProvider(key);
    if (detected) {
      setProviderName(detected.provider);
      setDetectedLabel(detected.label);
    }
    setMaskedKey(maskKey(key));
    setStep('connecting');
    setLocalError(null);

    try {
      await onFetchModels(key);
      onComplete(key);
    } catch (e) {
      setStep('error');
      setLocalError(e instanceof Error ? e.message : 'Failed to connect');
    }
  };

  const displayError = error || localError;
  const showKey = step === 'connecting' || step === 'error';
  const showInput = step === 'idle' || step === 'error';
  const pad = grid.blockPad; // 10px — text padding inside body

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--color-background)',
    }}>
      {/* Spacer — pushes body to bottom */}
      <div style={{ flex: 1 }} />

      {/* Body — all content as one block, min-height locks position */}
      <div style={{
        flexShrink: 0,
        padding: `0 ${grid.scrollPad}px ${grid.scrollPad}px`,
        minHeight: 300,
      }}>
        {/* Title */}
        <div style={{
          paddingLeft: pad,
          fontSize: 32,
          fontWeight: 400,
          fontFamily: "var(--typography-font-family-emphasis)",
          color: 'var(--gray-12)',
          lineHeight: 1.25,
          letterSpacing: '-0.2px',
        }}>
          Build something<br />great.
        </div>

        {/* Subtitle — changes per state */}
        <div style={{
          paddingLeft: pad,
          fontSize: tokens.fontSize[1],
          color: 'var(--gray-9)',
          marginTop: tokens.space[1],
          lineHeight: tokens.lineHeight[2],
        }}>
          {step === 'idle' && (
            <Fragment>
              Paste your API key to connect.{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-11)', textDecoration: 'none' }}
              >Get one free</a>
            </Fragment>
          )}
          {step === 'connecting' && (
            <span className="thinking-shimmer">Connecting...</span>
          )}
          {step === 'error' && (
            <Fragment>
              <span style={{ color: 'var(--error-11)' }}>Invalid key.</span>{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-11)', textDecoration: 'none' }}
              >Get a new one</a>
            </Fragment>
          )}
        </div>

        {/* Key display — shown after paste */}
        {showKey && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.space[2],
            padding: `${tokens.space[2]}px ${pad}px`,
            background: 'var(--gray-3)',
            borderRadius: 'var(--radius-3)',
            fontSize: tokens.fontSize[1],
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--gray-11)',
            letterSpacing: '0.2px',
            marginTop: tokens.space[3],
            border: step === 'error' ? '1px solid var(--error-3)' : 'none',
          }}>
            <span>{maskedKey}</span>
            <span style={{
              fontSize: 10,
              fontWeight: 500,
              fontFamily: tokens.font.sans,
              color: step === 'error' ? 'var(--error-11)' : 'var(--accent-11)',
              letterSpacing: 0,
              marginLeft: 'auto',
              flexShrink: 0,
            }}>
              {step === 'error' ? 'Failed' : detectedLabel || 'Detecting...'}
            </span>
          </div>
        )}

        {/* Input — shown in idle and error states */}
        {showInput && (
          <div style={{ marginTop: tokens.space[3] }}>
            <div style={{
              position: 'relative',
              borderRadius: 'var(--radius-4)',
              boxShadow: step === 'error'
                ? '0 0 0 1px rgba(233,61,130,0.2)'
                : `0 0 0 1px var(--gray-a4)`,
            }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="Paste API key..."
                value={apiKey}
                onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && apiKey.trim()) handleSubmit();
                }}
                style={{
                  width: '100%',
                  height: 40,
                  padding: `0 40px 0 ${pad}px`,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: tokens.fontSize[1],
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--gray-12)',
                  letterSpacing: '0.2px',
                  borderRadius: 'var(--radius-4)',
                }}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!apiKey.trim() || isLoading}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  borderRadius: 'var(--radius-4)',
                  background: apiKey.trim() ? 'var(--gray-12)' : 'transparent',
                  color: apiKey.trim() ? 'var(--color-background)' : 'var(--gray-8)',
                  cursor: apiKey.trim() ? 'pointer' : 'default',
                  transition: 'var(--transition-crisp)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--gray-9)',
              marginTop: tokens.space[2],
              paddingLeft: pad,
            }}>
              Stored locally in Figma.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
