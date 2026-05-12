/**
 * @file AddProviderForm.tsx
 * @description Row-based provider picker, lives inside the .provider-list card.
 * Two stages:
 *   stage 1 (no presetId)  — Choose provider: list of .pop-row presets
 *   stage 2 (presetId set) — Picked preset summary + API key input + Save/Remove
 *
 * Layout settled in tools/ui-preview/settings-refactor-ab.html v4. Aesthetic
 * mirrors ModelPopover (.pop-row), single 11px font, 8px four-side padding.
 */
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { X, Trash2, ChevronRight } from 'lucide-preact';
import type { ProviderConfig, ProviderPreset, ProviderProbeResult, Protocol } from '../../types/provider';
import { PROVIDER_PRESETS, findPresetById } from '../../config/providerPresets';
import { ValidationBanner, type ProbeState } from './ValidationBanner';

function probeUrlFor(protocol: Protocol, baseURL: string): string {
  if (!baseURL) return '';
  if (protocol === 'gemini') return `GET ${baseURL}/models`;
  if (protocol === 'anthropic') return `POST ${baseURL}/messages`;
  return `POST ${baseURL}/chat/completions`;
}

function compactBaseURL(baseURL: string): string {
  return baseURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export interface AddProviderFormProps {
  mode: 'add' | 'edit';
  initial?: ProviderConfig;
  onSave: (config: Omit<ProviderConfig, 'id'>) => void;
  onRemove?: () => void;
  onCancel: () => void;
  onValidate: (config: ProviderConfig) => Promise<ProviderProbeResult>;
}

export function AddProviderForm({
  mode,
  initial,
  onSave,
  onRemove,
  onCancel,
  onValidate,
}: AddProviderFormProps) {
  const initialPresetState =
    mode === 'edit' && initial?.presetId && findPresetById(initial.presetId)
      ? initial.presetId
      : '';
  const [presetId, setPresetId] = useState<string>(initialPresetState);
  const [apiKey, setApiKey] = useState<string>(initial?.apiKey ?? '');
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });
  const [probing, setProbing] = useState(false);
  const [allowSaveAnyway, setAllowSaveAnyway] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>(initial?.availableModels ?? []);

  const preset: ProviderPreset | undefined = useMemo(
    () => (presetId ? findPresetById(presetId) : undefined),
    [presetId],
  );

  // Reset probe state when preset or key changes — same invariant as before.
  useEffect(() => {
    if (probeState.kind !== 'idle') {
      setProbeState({ kind: 'idle' });
      setAllowSaveAnyway(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, apiKey]);

  const handlePickPreset = (id: string) => {
    setPresetId(id);
    if (mode === 'edit' && id === initial?.presetId) {
      setDiscoveredModels(initial?.availableModels ?? []);
    } else {
      setDiscoveredModels([]);
    }
  };

  const handleChangePreset = () => {
    setPresetId('');
    setProbeState({ kind: 'idle' });
    setAllowSaveAnyway(false);
  };

  const buildProbeConfig = (): ProviderConfig | null => {
    if (!preset) return null;
    return {
      id: initial?.id ?? 'pending',
      name: preset.name,
      protocol: preset.protocol,
      baseURL: preset.baseURL,
      apiKey: apiKey.trim(),
      // Default model from preset; user changes it later via chat header popover.
      modelId: initial?.modelId || preset.defaultModel || undefined,
      presetId: preset.id,
      headers: preset.headers,
      requiresProxy: preset.requiresProxy,
    };
  };

  const buildSaveConfig = (probeResult?: ProviderProbeResult): Omit<ProviderConfig, 'id'> | null => {
    const c = buildProbeConfig();
    if (!c) return null;
    const probeModels = probeResult && probeResult.kind === 'ok' ? probeResult.models : undefined;
    const availableModels = probeModels && probeModels.length > 0
      ? probeModels
      : (discoveredModels.length > 0 ? discoveredModels : undefined);
    return {
      name: c.name,
      protocol: c.protocol,
      baseURL: c.baseURL,
      apiKey: c.apiKey,
      modelId: c.modelId,
      presetId: c.presetId,
      headers: c.headers,
      availableModels,
      requiresProxy: c.requiresProxy,
    };
  };

  const handleTestAndSave = async () => {
    if (probing || !preset) return;
    if (!apiKey.trim()) {
      setProbeState({
        kind: 'result',
        result: { kind: 'auth-error', message: 'Enter an API key first.' },
        keyUrl: preset.keyUrl,
      });
      return;
    }

    // Short-circuit: if we already have a clean ok for the current preset+key, save without re-probing.
    if (probeState.kind === 'result' && probeState.result.kind === 'ok') {
      const saveCfg = buildSaveConfig(probeState.result);
      if (saveCfg) onSave(saveCfg);
      return;
    }

    const cfg = buildProbeConfig();
    if (!cfg) return;
    setProbing(true);
    setProbeState({ kind: 'pending', probeUrl: probeUrlFor(cfg.protocol, cfg.baseURL) });
    setAllowSaveAnyway(false);

    let result: ProviderProbeResult;
    try {
      result = await onValidate(cfg);
    } catch (e: any) {
      result = { kind: 'network-error', message: e?.message || 'Probe failed' };
    }
    setProbing(false);
    setProbeState({ kind: 'result', result, keyUrl: preset.keyUrl });

    if (result.kind === 'ok' && result.models && result.models.length > 0) {
      setDiscoveredModels(result.models);
    }

    // v4 §3.α — auto-save on probe ok, no 600ms delay. Banner is visible
    // during probe so user already sees the success state.
    if (result.kind === 'ok') {
      const saveCfg = buildSaveConfig(result);
      if (saveCfg) onSave(saveCfg);
      return;
    }
    if (result.kind === 'credits-error') {
      setAllowSaveAnyway(true);
    }
  };

  const handleSaveAnyway = () => {
    const last = probeState.kind === 'result' ? probeState.result : undefined;
    const saveCfg = buildSaveConfig(last);
    if (saveCfg) onSave(saveCfg);
  };

  // Hide self-preset from the choose list (avoid letting user "add" the one they're editing).
  const presetsToShow = mode === 'edit'
    ? PROVIDER_PRESETS
    : PROVIDER_PRESETS;
  const stage = preset ? 'entering' : 'picking';
  const headerLabel = stage === 'picking'
    ? 'Choose provider'
    : (mode === 'edit' ? `Edit ${preset!.name}` : `Add ${preset!.name}`);

  return (
    <div className="add-picker" role="dialog" aria-label={headerLabel}>
      <div className="add-picker-header">
        <span className="lhs">{headerLabel}</span>
        <button
          type="button"
          className="add-picker-close"
          aria-label="Close"
          onClick={onCancel}
        >
          <X size={12} strokeWidth={1.6} />
        </button>
      </div>

      {stage === 'picking' && (
        <Fragment>
          {presetsToShow.map(p => (
            <button
              key={p.id}
              type="button"
              className="pop-row"
              onClick={() => handlePickPreset(p.id)}
            >
              <span className="pop-name">{p.name}</span>
              <span className="pop-meta">{compactBaseURL(p.baseURL)}</span>
              <span className="pop-chevron">
                <ChevronRight size={14} strokeWidth={1.5} />
              </span>
            </button>
          ))}
        </Fragment>
      )}

      {stage === 'entering' && preset && (
        <Fragment>
          {/* Header already shows "Add {preset.name}" — this row just confirms
              the baseURL and offers a way back to picker. */}
          <div className="picked-preset">
            <span className="pop-meta">{compactBaseURL(preset.baseURL)}</span>
            {mode === 'add' && (
              <button
                type="button"
                className="change-btn"
                onClick={handleChangePreset}
              >
                Change
              </button>
            )}
          </div>

          <div className="key-input-row">
            <input
              className="key-input"
              type="password"
              placeholder="paste API key…"
              value={apiKey}
              onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (allowSaveAnyway) handleSaveAnyway();
                  else handleTestAndSave();
                }
              }}
              autoFocus
            />
            {allowSaveAnyway ? (
              <button
                type="button"
                className="key-save"
                onClick={handleSaveAnyway}
              >
                Save anyway
              </button>
            ) : (
              <button
                type="button"
                className="key-save"
                onClick={handleTestAndSave}
                disabled={probing || !apiKey.trim()}
              >
                {probing ? 'Testing…' : 'Save'}
              </button>
            )}
            {mode === 'edit' && onRemove && (
              <button
                type="button"
                className="key-remove"
                onClick={onRemove}
                aria-label="Remove provider"
                title="Remove provider"
              >
                <Trash2 size={12} strokeWidth={1.6} />
              </button>
            )}
          </div>

          <ValidationBanner state={probeState} />

          {preset.keyUrl && probeState.kind === 'idle' && (
            <div className="key-help">
              Need a key? <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer">Get one ↗</a>
            </div>
          )}
        </Fragment>
      )}
    </div>
  );
}
