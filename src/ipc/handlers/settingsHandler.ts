/**
 * @file settingsHandler.ts
 * @description IPC handlers for settings. Direct figma.clientStorage — no
 * service/repo layers.
 *
 * Storage model (Phase 5):
 *   - PROVIDERS_V2:        JSON.stringify(ProviderConfig[]) — source of truth
 *   - ACTIVE_PROVIDER_ID:  string — id of the currently active provider
 *   - USER_LOCALE / USER_THEME: unchanged
 *
 * Legacy keys (GEMINI_API_KEY_*, MODEL_*, GEMINI_PROVIDER_NAME) are read-only
 * migration sources. They are read once on first-load if PROVIDERS_V2 is
 * absent, converted to V2, and then ignored. They are NOT updated on save.
 * Phase 9 deletes them after one release cycle.
 *
 * The emit shape includes both V2 fields (providers, activeProviderId) and
 * legacy fields (apiKey, apiKeys, modelName, modelNames, providerName) derived
 * from V2, so the existing UI keeps working until Phase 7 lands.
 */

import { Settings, SettingsLoadedHandler, SendLogHandler } from '../../types';
import type { ProviderConfig, Protocol } from '../../types/provider';
import { emit } from '@create-figma-plugin/utilities';

// ── Storage keys ──
const K = {
  // V2
  PROVIDERS_V2:       'PROVIDERS_V2',
  ACTIVE_PROVIDER_ID: 'ACTIVE_PROVIDER_ID',

  // Legacy (read-only migration source post-Phase-5)
  LEGACY:           'GEMINI_API_KEY',
  GEMINI:           'GEMINI_API_KEY_GEMINI',
  OPENROUTER:       'GEMINI_API_KEY_OPENROUTER',
  DASHSCOPE:        'GEMINI_API_KEY_DASHSCOPE',
  CLAUDE:           'GEMINI_API_KEY_CLAUDE',
  MODEL_GEMINI:     'MODEL_GEMINI',
  MODEL_OPENROUTER: 'MODEL_OPENROUTER',
  MODEL_DASHSCOPE:  'MODEL_DASHSCOPE',
  MODEL_CLAUDE:     'MODEL_CLAUDE',
  MODEL_LEGACY:     'GEMINI_MODEL_NAME',
  PROVIDER:         'GEMINI_PROVIDER_NAME',

  // Prefs
  LOCALE: 'USER_LOCALE',
  THEME:  'USER_THEME',
} as const;

const DEFAULT_MODEL = 'gemini-2.5-flash';

// Legacy provider name → preset id (used when migrating)
const LEGACY_TO_PRESET: Record<string, string> = {
  gemini:     'gemini-aistudio',
  openrouter: 'openrouter',
  dashscope:  'dashscope-openai',
  claude:     'anthropic',           // overridden below if key is non-sk-ant-
};

// ── Helpers ──

function upsert(key: string, value: string | undefined): Promise<void> {
  return value
    ? figma.clientStorage.setAsync(key, value)
    : figma.clientStorage.deleteAsync(key);
}

/**
 * Generate a stable provider id. crypto.randomUUID() is available in modern
 * Figma plugin sandboxes; fall back to a timestamp+random combo if not.
 */
function newProviderId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a ProviderConfig from a legacy provider name + key + model. Mirrors
 * the conventions in ProviderFactory.legacyToConfig() but with stable ids.
 */
function buildLegacyConfig(
  providerName: string,
  apiKey: string,
  modelId: string | undefined,
): ProviderConfig {
  switch (providerName) {
    case 'openrouter':
      return {
        id: newProviderId(),
        name: 'OpenRouter',
        protocol: 'openai',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        modelId,
        presetId: 'openrouter',
        headers: {
          'HTTP-Referer': 'https://github.com/musepy/genable',
          'X-Title':      'Genable Figma Plugin',
        },
      };

    case 'dashscope':
      return {
        id: newProviderId(),
        name: 'DashScope',
        protocol: 'openai',
        baseURL: 'https://coding.dashscope.aliyuncs.com/v1',
        apiKey,
        modelId,
        presetId: 'dashscope-openai',
        headers: { 'User-Agent': 'claude-cli/2.0.57 (external, cli)' },
      };

    case 'claude': {
      const isNative = apiKey.startsWith('sk-ant-');
      return {
        id: newProviderId(),
        name: isNative ? 'Claude' : 'Claude (DashScope)',
        protocol: 'anthropic',
        baseURL: isNative
          ? 'https://api.anthropic.com/v1'
          : 'https://dashscope.aliyuncs.com/apps/anthropic/v1',
        apiKey,
        modelId,
        presetId: isNative ? 'anthropic' : 'dashscope-anthropic',
      };
    }

    case 'gemini':
    default:
      return {
        id: newProviderId(),
        name: 'Gemini',
        protocol: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey,
        modelId,
        presetId: 'gemini-aistudio',
      };
  }
}

/**
 * One-time migration: read all legacy keys, build a ProviderConfig[] from
 * whichever ones have non-empty API keys, write to PROVIDERS_V2, set
 * ACTIVE_PROVIDER_ID. Returns the new V2 state.
 *
 * The legacy keys are NOT deleted — they remain as a fallback in case a
 * downgrade is needed. Phase 9 cleans them up.
 */
async function migrateLegacyToV2(): Promise<{
  providers: ProviderConfig[];
  activeProviderId: string | null;
}> {
  const [legacy, gemini, openrouter, dashscope, claude,
         modelGemini, modelOpenrouter, modelDashscope, modelClaude, modelLegacy,
         provider] = await Promise.all([
    figma.clientStorage.getAsync(K.LEGACY),
    figma.clientStorage.getAsync(K.GEMINI),
    figma.clientStorage.getAsync(K.OPENROUTER),
    figma.clientStorage.getAsync(K.DASHSCOPE),
    figma.clientStorage.getAsync(K.CLAUDE),
    figma.clientStorage.getAsync(K.MODEL_GEMINI),
    figma.clientStorage.getAsync(K.MODEL_OPENROUTER),
    figma.clientStorage.getAsync(K.MODEL_DASHSCOPE),
    figma.clientStorage.getAsync(K.MODEL_CLAUDE),
    figma.clientStorage.getAsync(K.MODEL_LEGACY),
    figma.clientStorage.getAsync(K.PROVIDER),
  ]);

  // Resolve effective gemini key (newer key wins over legacy single-key fallback)
  const geminiKey = gemini || legacy;

  const providers: ProviderConfig[] = [];
  if (geminiKey)   providers.push(buildLegacyConfig('gemini',     geminiKey,   modelGemini || modelLegacy || undefined));
  if (openrouter)  providers.push(buildLegacyConfig('openrouter', openrouter,  modelOpenrouter || undefined));
  if (dashscope)   providers.push(buildLegacyConfig('dashscope',  dashscope,   modelDashscope || undefined));
  if (claude)      providers.push(buildLegacyConfig('claude',     claude,      modelClaude || undefined));

  // Active provider: pick by legacy PROVIDER key, else first configured, else null
  let activeProviderId: string | null = null;
  if (provider && providers.length > 0) {
    const protocolForLegacyName = (n: string): Protocol =>
      n === 'gemini' ? 'gemini' : n === 'claude' ? 'anthropic' : 'openai';
    const wantedProtocol = protocolForLegacyName(provider);
    // Find first matching protocol; fall back to first overall
    activeProviderId =
      (providers.find(p => p.presetId === LEGACY_TO_PRESET[provider]) ||
       providers.find(p => p.protocol === wantedProtocol) ||
       providers[0])?.id ?? null;
  } else if (providers.length > 0) {
    activeProviderId = providers[0].id;
  }

  // Persist the migrated state
  await Promise.all([
    figma.clientStorage.setAsync(K.PROVIDERS_V2, JSON.stringify(providers)),
    activeProviderId
      ? figma.clientStorage.setAsync(K.ACTIVE_PROVIDER_ID, activeProviderId)
      : figma.clientStorage.deleteAsync(K.ACTIVE_PROVIDER_ID),
  ]);

  return { providers, activeProviderId };
}

/**
 * Derive the legacy emit shape (apiKey/apiKeys/modelName/modelNames/providerName)
 * from a V2 state, so the pre-Phase-7 SettingsPanel keeps working.
 */
function deriveLegacyShape(
  providers: ProviderConfig[],
  activeProviderId: string | null,
): {
  apiKey: string;
  apiKeys: Record<string, string>;
  modelName: string;
  modelNames: Record<string, string>;
  providerName: 'gemini' | 'openrouter' | 'dashscope' | 'claude';
} {
  // Find one provider per legacy bucket (preferring matching presetId)
  function pickByPreset(presetIds: string[]): ProviderConfig | undefined {
    for (const id of presetIds) {
      const found = providers.find(p => p.presetId === id);
      if (found) return found;
    }
    return undefined;
  }

  const gem = pickByPreset(['gemini-aistudio']);
  const ant = pickByPreset(['anthropic', 'dashscope-anthropic', 'opencode-zen']);
  const ds  = pickByPreset(['dashscope-openai']);
  const or  = pickByPreset(['openrouter']);

  const apiKeys = {
    gemini:     gem?.apiKey ?? '',
    openrouter: or?.apiKey ?? '',
    dashscope:  ds?.apiKey ?? '',
    claude:     ant?.apiKey ?? '',
  };

  const modelNames = {
    gemini:     gem?.modelId ?? DEFAULT_MODEL,
    openrouter: or?.modelId ?? '',
    dashscope:  ds?.modelId ?? '',
    claude:     ant?.modelId ?? '',
  };

  // Map active config back to legacy bucket name
  const active = providers.find(p => p.id === activeProviderId);
  let providerName: 'gemini' | 'openrouter' | 'dashscope' | 'claude' = 'gemini';
  if (active) {
    if (active === gem) providerName = 'gemini';
    else if (active === or) providerName = 'openrouter';
    else if (active === ds) providerName = 'dashscope';
    else if (active === ant) providerName = 'claude';
    else {
      // Fall back by protocol if active doesn't fit a legacy bucket (e.g. Moonshot)
      providerName = active.protocol === 'gemini' ? 'gemini'
        : active.protocol === 'anthropic' ? 'claude'
        : 'openrouter';
    }
  }

  return {
    apiKey: active?.apiKey ?? '',
    apiKeys,
    modelName: active?.modelId ?? modelNames[providerName] ?? DEFAULT_MODEL,
    modelNames,
    providerName,
  };
}

// ── Handlers ──

export async function handleLoadSettings(): Promise<void> {
  try {
    const [v2Json, activeIdRaw, locale, theme] = await Promise.all([
      figma.clientStorage.getAsync(K.PROVIDERS_V2),
      figma.clientStorage.getAsync(K.ACTIVE_PROVIDER_ID),
      figma.clientStorage.getAsync(K.LOCALE),
      figma.clientStorage.getAsync(K.THEME),
    ]);

    let providers: ProviderConfig[];
    let activeProviderId: string | null;

    if (typeof v2Json === 'string' && v2Json) {
      try {
        providers = JSON.parse(v2Json) as ProviderConfig[];
      } catch (parseErr: any) {
        console.error('[settings] PROVIDERS_V2 parse failed; falling back to legacy migration', parseErr);
        const migrated = await migrateLegacyToV2();
        providers = migrated.providers;
        activeProviderId = migrated.activeProviderId;
        const legacyShape = deriveLegacyShape(providers, activeProviderId);
        emit<SettingsLoadedHandler>('SETTINGS_LOADED', {
          providers, activeProviderId,
          ...legacyShape,
          locale: locale || undefined,
          theme: theme || undefined,
        });
        return;
      }
      activeProviderId = (typeof activeIdRaw === 'string' && activeIdRaw)
        ? activeIdRaw
        : (providers[0]?.id ?? null);
    } else {
      // First load — migrate from legacy keys
      const migrated = await migrateLegacyToV2();
      providers = migrated.providers;
      activeProviderId = migrated.activeProviderId;
    }

    const legacyShape = deriveLegacyShape(providers, activeProviderId);

    emit<SettingsLoadedHandler>('SETTINGS_LOADED', {
      providers,
      activeProviderId,
      ...legacyShape,
      locale: locale || undefined,
      theme: theme || undefined,
    });
  } catch (e: any) {
    console.error('Error loading settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to load settings: ${e.message}`, type: 'warn' });
  }
}

export async function handleSaveSettings(settings: Settings): Promise<void> {
  try {
    // Two write paths:
    //   1. New shape: settings.providers + settings.activeProviderId → write V2 directly
    //   2. Legacy shape: build V2 from current storage, patch the field that changed,
    //      then write V2. This lets the pre-Phase-7 SettingsPanel work unchanged.

    if (Array.isArray(settings.providers)) {
      // New shape — settings is V2-native
      await Promise.all([
        figma.clientStorage.setAsync(K.PROVIDERS_V2, JSON.stringify(settings.providers)),
        settings.activeProviderId
          ? figma.clientStorage.setAsync(K.ACTIVE_PROVIDER_ID, settings.activeProviderId)
          : figma.clientStorage.deleteAsync(K.ACTIVE_PROVIDER_ID),
        settings.locale ? upsert(K.LOCALE, settings.locale) : Promise.resolve(),
        settings.theme  ? upsert(K.THEME, settings.theme)   : Promise.resolve(),
      ]);
      return;
    }

    // Legacy shape — load current V2 (or migrate), patch by buckets, write back.
    const v2Json = await figma.clientStorage.getAsync(K.PROVIDERS_V2);
    let providers: ProviderConfig[];
    let activeProviderId: string | null;
    if (typeof v2Json === 'string' && v2Json) {
      providers = JSON.parse(v2Json) as ProviderConfig[];
      const ai = await figma.clientStorage.getAsync(K.ACTIVE_PROVIDER_ID);
      activeProviderId = (typeof ai === 'string' && ai) ? ai : (providers[0]?.id ?? null);
    } else {
      const migrated = await migrateLegacyToV2();
      providers = migrated.providers;
      activeProviderId = migrated.activeProviderId;
    }

    const writeBucket = (bucket: 'gemini' | 'openrouter' | 'dashscope' | 'claude') => {
      const newKey = settings.apiKeys?.[bucket];
      if (newKey == null) return;
      const presetIds: string[] =
        bucket === 'gemini'     ? ['gemini-aistudio'] :
        bucket === 'openrouter' ? ['openrouter'] :
        bucket === 'dashscope'  ? ['dashscope-openai'] :
                                  ['anthropic', 'dashscope-anthropic'];
      const idx = providers.findIndex(p => p.presetId && presetIds.includes(p.presetId));
      if (newKey === '') {
        if (idx >= 0) providers.splice(idx, 1);  // removing key = removing provider
        return;
      }
      if (idx >= 0) {
        providers[idx] = { ...providers[idx], apiKey: newKey };
      } else {
        providers.push(buildLegacyConfig(bucket, newKey, settings.modelNames?.[bucket]));
      }
    };

    writeBucket('gemini');
    writeBucket('openrouter');
    writeBucket('dashscope');
    writeBucket('claude');

    // Update active provider's modelId from settings.modelName
    if (settings.modelName && settings.providerName) {
      const presetIds: string[] =
        settings.providerName === 'gemini'     ? ['gemini-aistudio'] :
        settings.providerName === 'openrouter' ? ['openrouter'] :
        settings.providerName === 'dashscope'  ? ['dashscope-openai'] :
                                                 ['anthropic', 'dashscope-anthropic'];
      const idx = providers.findIndex(p => p.presetId && presetIds.includes(p.presetId));
      if (idx >= 0) providers[idx] = { ...providers[idx], modelId: settings.modelName };
    }

    // Update active provider id from settings.providerName
    if (settings.providerName) {
      const presetIds: string[] =
        settings.providerName === 'gemini'     ? ['gemini-aistudio'] :
        settings.providerName === 'openrouter' ? ['openrouter'] :
        settings.providerName === 'dashscope'  ? ['dashscope-openai'] :
                                                 ['anthropic', 'dashscope-anthropic'];
      const match = providers.find(p => p.presetId && presetIds.includes(p.presetId));
      if (match) activeProviderId = match.id;
    }

    await Promise.all([
      figma.clientStorage.setAsync(K.PROVIDERS_V2, JSON.stringify(providers)),
      activeProviderId
        ? figma.clientStorage.setAsync(K.ACTIVE_PROVIDER_ID, activeProviderId)
        : figma.clientStorage.deleteAsync(K.ACTIVE_PROVIDER_ID),
      settings.locale ? upsert(K.LOCALE, settings.locale) : Promise.resolve(),
      settings.theme  ? upsert(K.THEME, settings.theme)   : Promise.resolve(),
    ]);
  } catch (e: any) {
    console.error('Error saving settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to save settings: ${e.message}`, type: 'warn' });
  }
}

export async function handleResetSettings(): Promise<void> {
  try {
    // Wipe both V2 and all legacy keys so reset is total.
    await Promise.all(Object.values(K).map(k => figma.clientStorage.deleteAsync(k)));

    emit<SettingsLoadedHandler>('SETTINGS_LOADED', {
      providers: [],
      activeProviderId: null,
      apiKey: '',
      apiKeys: { gemini: '', openrouter: '', dashscope: '', claude: '' },
      modelName: DEFAULT_MODEL,
      modelNames: { gemini: DEFAULT_MODEL, openrouter: '', dashscope: '', claude: '' },
      providerName: 'gemini',
    });
  } catch (e: any) {
    console.error('Error resetting settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to reset settings: ${e.message}`, type: 'warn' });
  }
}
