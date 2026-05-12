/**
 * @file OnboardingView.tsx
 * @description V2 onboarding — paste an API key, auto-detect a preset by key
 * prefix, probe via VALIDATE_PROVIDER, and create a ProviderConfig on success.
 *
 * This replaces the legacy version's setApiKey/setProviderName/onFetchModels
 * call chain with a single addProvider + validateProvider hand-off.
 */
import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { tokens } from '../design-system/tokens';
import { grid } from '../design-system/tokens/layout';
import { useTranslations } from '../i18n';
import { PROVIDER_PRESETS, findPresetById } from '../../config/providerPresets';
import type { ProviderConfig, ProviderPreset, ProviderProbeResult } from '../../types/provider';

type OnboardStep = 'idle' | 'connecting' | 'error';

/**
 * Detect a preset from an API key prefix. Falls back to OpenAI-protocol presets
 * when no recognizable prefix matches (most generic OpenAI-compat services use
 * `sk-…`). Returns undefined for keys we can't even guess at.
 */
function detectPreset(key: string): ProviderPreset | undefined {
  const k = key.trim();
  if (!k) return undefined;

  if (k.startsWith('AIzaSy')) return findPresetById('gemini-aistudio');
  if (k.startsWith('sk-or-v1-')) return findPresetById('openrouter');
  if (k.startsWith('sk-ant-')) return findPresetById('anthropic');
  if (k.startsWith('sk-deepseek-')) return findPresetById('deepseek');
  if (k.length > 10) {
    // Heuristic: most "sk-…" custom keys ride OpenAI protocol. Default to OpenAI preset.
    return findPresetById('openai');
  }
  return undefined;
}

function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return key.slice(0, 10) + '••••••••';
}

interface OnboardingViewProps {
  /** Add a fully-validated provider, returning its new id. */
  addProvider: (cfg: Omit<ProviderConfig, 'id'>) => string;
  /** Probe a provider config; returns the probe result. */
  validateProvider: (cfg: ProviderConfig) => Promise<ProviderProbeResult>;
  /** Open Settings (for users who want manual config). */
  onOpenSettings: () => void;
}

export function OnboardingView({
  addProvider,
  validateProvider,
  onOpenSettings,
}: OnboardingViewProps) {
  const t = useTranslations();
  const [apiKey, setApiKey] = useState('');
  const [step, setStep] = useState<OnboardStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detectedPreset, setDetectedPreset] = useState<ProviderPreset | undefined>(undefined);
  const [maskedKey, setMaskedKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset error on typing
  useEffect(() => {
    if (step === 'error') {
      setStep('idle');
      setErrorMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const handleSubmit = async () => {
    const key = apiKey.trim();
    if (!key) return;

    const preset = detectPreset(key);
    setDetectedPreset(preset);
    setMaskedKey(maskKey(key));
    setStep('connecting');
    setErrorMessage(null);

    if (!preset) {
      setStep('error');
      setErrorMessage('Unrecognized key format. Use Settings to configure manually.');
      return;
    }

    const cfgForProbe: ProviderConfig = {
      id: 'pending',
      name: preset.name,
      protocol: preset.protocol,
      baseURL: preset.baseURL,
      apiKey: key,
      modelId: preset.defaultModel,
      presetId: preset.id,
      headers: preset.headers,
    };

    try {
      const result = await validateProvider(cfgForProbe);
      if (result.kind === 'ok' || result.kind === 'credits-error') {
        // Save even on credits-error (key is good); user can fund later.
        const { id: _ignored, ...rest } = cfgForProbe;
        addProvider(rest);
        // The hook will flip hasConfig and the parent re-routes to ChatFeature.
        return;
      }
      setStep('error');
      setErrorMessage(
        result.kind === 'auth-error' ? 'Invalid API key.'
        : result.kind === 'not-found' ? 'Endpoint unreachable. Try Settings.'
        : result.kind === 'rate-limited' ? 'Rate limited. Try again shortly.'
        : result.kind === 'network-error' ? 'Network error. Check your connection.'
        : `HTTP ${result.status}: ${result.message}`,
      );
    } catch (e: any) {
      setStep('error');
      setErrorMessage(e?.message || 'Failed to connect');
    }
  };

  const showKey = step === 'connecting' || step === 'error';
  const showInput = step === 'idle' || step === 'error';
  const pad = grid.blockPad;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--color-background)',
    }}>
      <div style={{ flex: 1 }} />

      <div style={{
        flexShrink: 0,
        padding: `0 ${grid.scrollPad}px ${grid.scrollPad}px`,
        minHeight: 300,
      }}>
        <div style={{
          paddingLeft: pad,
          fontSize: 32,
          fontWeight: 400,
          fontFamily: 'var(--typography-font-family-emphasis)',
          color: 'var(--gray-12)',
          lineHeight: 1.05,
          letterSpacing: '-0.4px',
        }}>
          {t.buildSomething}<br />{t.great}
        </div>

        <div style={{
          paddingLeft: pad,
          fontSize: tokens.fontSize[1],
          color: 'var(--gray-a11)',
          marginTop: tokens.space[3],
          lineHeight: tokens.lineHeight[2],
        }}>
          {step === 'idle' && t.storedLocally}
          {step === 'connecting' && (
            <span className="thinking-shimmer">{t.connecting}</span>
          )}
          {step === 'error' && (
            <Fragment>
              <span style={{ color: 'var(--error-11)' }}>{errorMessage || t.invalidKey}</span>{' '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onOpenSettings(); }}
                style={{ color: 'var(--accent-11)', textDecoration: 'none', cursor: 'pointer' }}
              >
                Open Settings
              </a>
            </Fragment>
          )}
        </div>

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
              {step === 'error' ? t.failed : detectedPreset?.name || t.detecting}
            </span>
          </div>
        )}

        {showInput && (
          <div style={{ marginTop: tokens.space[4] }}>
            <div style={{
              position: 'relative',
              borderRadius: 'var(--radius-4)',
              boxShadow: step === 'error'
                ? '0 0 0 1px rgba(233,61,130,0.2)'
                : '0 0 0 1px var(--gray-a4)',
            }}>
              <input
                ref={inputRef}
                type="text"
                placeholder={t.pasteApiKey}
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
                disabled={!apiKey.trim()}
                className={`icon-btn ${apiKey.trim() ? 'submit-btn-active' : 'submit-btn-disabled'}`}
                style={{
                  position: 'absolute',
                  right: 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  borderRadius: 'var(--radius-5)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={apiKey.trim() ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
            <div style={{
              marginTop: tokens.space[2],
              paddingLeft: pad,
              fontSize: 10,
              color: 'var(--gray-a11)',
            }}>
              Or{' '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onOpenSettings(); }}
                style={{ color: 'var(--gray-12)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                configure manually in Settings
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
