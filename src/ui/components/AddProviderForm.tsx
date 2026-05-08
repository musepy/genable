/**
 * @file AddProviderForm.tsx
 * @description Add/Edit a ProviderConfig.
 *
 * Preset-only flow: user picks a known provider from the dropdown and fills in
 * the API key. Display name + endpoint + protocol + headers come from
 * src/config/provider-presets.json. Model id is pre-filled from the preset's
 * defaultModel and editable; if the probe's list-models call returns
 * suggestions the field gains a datalist of those.
 *
 * A "Custom endpoint" flow used to live here; it was removed because the
 * Figma plugin manifest's allowedDomains whitelist makes user-supplied hosts
 * unreliable (network-layer block before the request even hits CORS). New
 * providers are added by editing provider-presets.json and shipping a
 * manifest update.
 */
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { X, Trash2 } from 'lucide-preact';
import type { ProviderConfig, ProviderPreset, ProviderProbeResult, Protocol } from '../../types/provider';
import { PROVIDER_PRESETS, findPresetById } from '../../config/providerPresets';
import { ValidationBanner, type ProbeState } from './ValidationBanner';

/** What a probe URL looks like (informational only — for the pending banner). */
function probeUrlFor(protocol: Protocol, baseURL: string): string {
  if (!baseURL) return '';
  if (protocol === 'gemini') return `GET ${baseURL}/models`;
  if (protocol === 'anthropic') return `POST ${baseURL}/messages`;
  return `POST ${baseURL}/chat/completions`;
}

export interface AddProviderFormProps {
  mode: 'add' | 'edit';
  /** When mode === 'edit', the existing config to pre-fill. */
  initial?: ProviderConfig;
  /** Save callback — receives the (validated) config. id is omitted on add. */
  onSave: (config: Omit<ProviderConfig, 'id'>) => void;
  /** Edit-only: remove this provider entirely. */
  onRemove?: () => void;
  /** Cancel + close the form. */
  onCancel: () => void;
  /** Probe a config — preset has been selected so protocol is known. */
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
  // Preset selection drives form visibility.
  // - '' (empty) on add → only the dropdown is shown
  // - real preset id    → form fields appear (Model ID + API Key)
  //
  // In edit mode for a legacy entry whose presetId no longer matches any known
  // preset, we fall back to '' so the user is forced to pick a current preset
  // (or remove the entry).
  const initialPresetState =
    mode === 'edit' && initial?.presetId && findPresetById(initial.presetId)
      ? initial.presetId
      : '';
  const [presetId, setPresetId] = useState<string>(initialPresetState);

  // Model ID + API Key are the only two user-editable fields. Name + baseURL
  // come from the preset; we still track them in state so they thread through
  // buildProbeConfig and buildSaveConfig without special-casing.
  const [modelId, setModelId] = useState<string>(initial?.modelId ?? '');
  const [apiKey, setApiKey] = useState<string>(initial?.apiKey ?? '');

  // Probe + form lifecycle state
  const [probeState, setProbeState] = useState<ProbeState>({ kind: 'idle' });
  const [probing, setProbing] = useState(false);
  /** Set after credits-error so the user can confirm "save anyway". */
  const [allowSaveAnyway, setAllowSaveAnyway] = useState(false);
  /** Models surfaced by the last successful probe — fed into Model ID datalist. */
  const [discoveredModels, setDiscoveredModels] = useState<string[]>(initial?.availableModels ?? []);

  const preset: ProviderPreset | undefined = useMemo(
    () => (presetId ? findPresetById(presetId) : undefined),
    [presetId],
  );

  const isPresetSelected = !!preset;
  // Until a preset is chosen, only the dropdown is visible.
  const showFields = isPresetSelected;

  // Reset probe state whenever the preset (and therefore baseURL/protocol/
  // headers) changes, or the apiKey changes. modelId is deliberately omitted —
  // picking a model from the discovered datalist doesn't invalidate a probe
  // result for the same preset+key, and resetting would force a wasteful
  // second round-trip.
  useEffect(() => {
    if (probeState.kind !== 'idle') {
      setProbeState({ kind: 'idle' });
      setAllowSaveAnyway(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, apiKey]);

  /** Apply a preset's defaults to the form. */
  const handlePresetChange = (id: string) => {
    setPresetId(id);
    // Discovered models are tied to the previous preset+key. On any preset
    // switch they're stale, except when going back to the original preset in
    // edit mode (then we restore the cached list so the datalist isn't empty).
    if (mode === 'edit' && id === initial?.presetId) {
      setDiscoveredModels(initial?.availableModels ?? []);
    } else {
      setDiscoveredModels([]);
    }
    if (!id) {
      // Cleared selection — drop modelId so the next preset's defaultModel
      // takes over. apiKey is preserved.
      setModelId('');
      return;
    }
    const p = findPresetById(id);
    if (!p) return;
    // Always seed modelId from the new preset so the user sees a clean default.
    setModelId(p.defaultModel || '');
  };

  /** Build the in-flight ProviderConfig used for probing. */
  const buildProbeConfig = (): ProviderConfig | null => {
    if (!preset) return null;
    return {
      id: initial?.id ?? 'pending',
      name: preset.name,
      protocol: preset.protocol,
      baseURL: preset.baseURL,
      apiKey: apiKey.trim(),
      modelId: modelId.trim() || undefined,
      presetId: preset.id,
      headers: preset.headers,
      requiresProxy: preset.requiresProxy,
    };
  };

  /** Build the saved config — protocol always comes from the selected preset. */
  const buildSaveConfig = (probeResult?: ProviderProbeResult): Omit<ProviderConfig, 'id'> | null => {
    const c = buildProbeConfig();
    if (!c) return null;
    // Prefer freshly probed models; fall back to whatever the form already had
    // (covers Save Anyway after a credits-error, where probeResult has no models).
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
    if (probing) return;
    if (!preset) return; // Save button is disabled in this state, but defend.
    if (!apiKey.trim()) {
      setProbeState({
        kind: 'result',
        result: { kind: 'auth-error', message: 'Enter an API key first.' },
        keyUrl: preset.keyUrl,
      });
      return;
    }

    // Short-circuit: if we already have a clean ok for the current preset+key
    // (the reset effect clears probeState whenever those change), skip the
    // second round-trip and just save with the picked modelId.
    if (probeState.kind === 'result' && probeState.result.kind === 'ok') {
      const saveCfg = buildSaveConfig(probeState.result);
      if (saveCfg) onSave(saveCfg);
      return;
    }

    const cfg = buildProbeConfig();
    if (!cfg) return;
    // Banner shows the upstream URL the user picked, not the (possibly
    // worker-proxied) URL the request actually goes through. Showing the
    // proxy URL is technically accurate but leaks the worker subdomain into
    // the user-visible UI for no debugging value — DevTools network tab
    // shows the real URL anyway.
    setProbing(true);
    setProbeState({
      kind: 'pending',
      probeUrl: probeUrlFor(cfg.protocol, cfg.baseURL),
    });
    setAllowSaveAnyway(false);

    let result: ProviderProbeResult;
    try {
      result = await onValidate(cfg);
    } catch (e: any) {
      result = { kind: 'network-error', message: e?.message || 'Probe failed' };
    }
    setProbing(false);
    setProbeState({ kind: 'result', result, keyUrl: preset.keyUrl });

    // Capture discovered models (OpenAI/Gemini list endpoints) so the datalist
    // suggestions show up even if the user re-opens the form later.
    if (result.kind === 'ok' && result.models && result.models.length > 0) {
      setDiscoveredModels(result.models);
    }

    // Auto-save on a clean ok after a brief moment — UNLESS we just discovered
    // a model list and the user hasn't picked one yet. In that case, hold the
    // form open so they can pick from the datalist; saving with an empty model
    // would silently fall back to the provider default.
    if (result.kind === 'ok') {
      const justDiscoveredModels = (result.models?.length ?? 0) > 0;
      const userNeedsToPick = justDiscoveredModels && !modelId.trim();
      if (userNeedsToPick) return;
      setTimeout(() => {
        const saveCfg = buildSaveConfig(result);
        if (saveCfg) onSave(saveCfg);
      }, 600);
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

  const formTitle = mode === 'add' ? 'Add Provider' : 'Edit Provider';
  const primaryLabel = probing ? 'Testing…' : 'Save & Test';

  // All editable fields hinge on a preset being selected.
  const showModelField = isPresetSelected;
  const showApiKeyField = isPresetSelected;
  const showActionRow = showFields;

  return (
    <div className="add-form" role="dialog" aria-label={formTitle}>
      <div className="add-form-title">
        <span>{formTitle}</span>
        <button
          type="button"
          className="add-form-close"
          aria-label="Close form"
          onClick={onCancel}
        >
          <X size={12} strokeWidth={1.8} />
        </button>
      </div>

      {/* Provider picker — always visible, drives everything else */}
      <div className="add-form-field">
        <label className="add-form-label" htmlFor="prov-preset">Provider</label>
        <select
          id="prov-preset"
          className="add-form-select"
          value={presetId}
          onChange={(e) => handlePresetChange((e.target as HTMLSelectElement).value)}
        >
          {!presetId && <option value="">Choose a provider…</option>}
          {PROVIDER_PRESETS.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Model ID — pre-filled from preset.defaultModel; datalist on probe ok */}
      {showModelField && (
        <div className="add-form-field">
          <label className="add-form-label" htmlFor="prov-model">
            Model ID<span className="add-form-optional"> · optional</span>
            {discoveredModels.length > 0 && (
              <span className="add-form-optional">
                {' · '}
                {discoveredModels.length} from this key
              </span>
            )}
          </label>
          <input
            id="prov-model"
            className="add-form-input"
            type="text"
            placeholder={preset?.defaultModel || (discoveredModels[0] ?? 'leave blank to use default')}
            value={modelId}
            onInput={(e) => setModelId((e.target as HTMLInputElement).value)}
            list={discoveredModels.length > 0 ? 'prov-model-suggestions' : undefined}
            autoComplete="off"
          />
          {discoveredModels.length > 0 && (
            <datalist id="prov-model-suggestions">
              {discoveredModels.map(m => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </div>
      )}

      {/* API Key — the only field the user always has to fill */}
      {showApiKeyField && (
        <div className="add-form-field">
          <label className="add-form-label" htmlFor="prov-key">
            API Key
            {preset?.keyUrl && (
              <Fragment>
                {' · '}
                <a
                  href={preset.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="add-form-keylink"
                >
                  Get key
                </a>
              </Fragment>
            )}
          </label>
          <input
            id="prov-key"
            className="add-form-input"
            type="password"
            placeholder="paste your key…"
            value={apiKey}
            onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
          />
        </div>
      )}

      {showFields && <ValidationBanner state={probeState} />}

      {showActionRow && (
        <div className="add-form-actions">
          {mode === 'edit' && onRemove && (
            <button
              type="button"
              className="add-form-btn add-form-btn-danger"
              onClick={onRemove}
              aria-label="Remove provider"
              title="Remove provider"
            >
              <Trash2 size={12} strokeWidth={1.6} />
            </button>
          )}
          <button
            type="button"
            className="add-form-btn add-form-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          {allowSaveAnyway ? (
            <button
              type="button"
              className="add-form-btn add-form-btn-primary"
              onClick={handleSaveAnyway}
            >
              Save anyway
            </button>
          ) : (
            <button
              type="button"
              className="add-form-btn add-form-btn-primary"
              onClick={handleTestAndSave}
              disabled={probing}
              style={{ opacity: probing ? 0.6 : 1 }}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
