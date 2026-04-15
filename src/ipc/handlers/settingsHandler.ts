/**
 * @file settingsHandler.ts
 * @description IPC handlers for settings. Direct figma.clientStorage — no service/repo layers.
 */

import { Settings, SettingsLoadedHandler, SendLogHandler } from '../../types';
import { emit } from '@create-figma-plugin/utilities';

// ── Storage keys ──
const K = {
  LEGACY:     'GEMINI_API_KEY',
  GEMINI:     'GEMINI_API_KEY_GEMINI',
  OPENROUTER: 'GEMINI_API_KEY_OPENROUTER',
  DASHSCOPE:  'GEMINI_API_KEY_DASHSCOPE',
  CLAUDE:     'GEMINI_API_KEY_CLAUDE',
  MODEL_GEMINI:     'MODEL_GEMINI',
  MODEL_OPENROUTER: 'MODEL_OPENROUTER',
  MODEL_DASHSCOPE:  'MODEL_DASHSCOPE',
  MODEL_CLAUDE:     'MODEL_CLAUDE',
  MODEL_LEGACY:     'GEMINI_MODEL_NAME',
  PROVIDER:   'GEMINI_PROVIDER_NAME',
  LOCALE:     'USER_LOCALE',
} as const;

const MODEL_KEY_FOR_PROVIDER: Record<string, string> = {
  gemini:     K.MODEL_GEMINI,
  openrouter: K.MODEL_OPENROUTER,
  dashscope:  K.MODEL_DASHSCOPE,
  claude:     K.MODEL_CLAUDE,
};

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ── Helpers ──

/** Set or delete a clientStorage key based on whether value is truthy. */
function upsert(key: string, value: string | undefined): Promise<void> {
  return value
    ? figma.clientStorage.setAsync(key, value)
    : figma.clientStorage.deleteAsync(key);
}

// ── Handlers ──

export async function handleLoadSettings(): Promise<void> {
  try {
    const [legacy, gemini, openrouter, dashscope, claude,
           modelGemini, modelOpenrouter, modelDashscope, modelClaude, modelLegacy,
           provider, locale] = await Promise.all([
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
      figma.clientStorage.getAsync(K.LOCALE),
    ]);

    const providerName = provider ?? 'gemini';
    const geminiKey   = gemini   ?? legacy ?? '';
    const openrouterKey = openrouter ?? '';
    const dashscopeKey = dashscope ?? '';
    const claudeKey = claude ?? '';
    const activeKey = providerName === 'openrouter' ? openrouterKey
      : providerName === 'dashscope' ? dashscopeKey
      : providerName === 'claude' ? claudeKey
      : geminiKey;

    // Per-provider model names (fall back to legacy global key for migration)
    const modelNames: Record<string, string> = {
      gemini:     modelGemini ?? modelLegacy ?? DEFAULT_MODEL,
      openrouter: modelOpenrouter ?? '',
      dashscope:  modelDashscope ?? '',
      claude:     modelClaude ?? '',
    };

    emit<SettingsLoadedHandler>('SETTINGS_LOADED', {
      apiKey: activeKey,
      apiKeys: { gemini: geminiKey, openrouter: openrouterKey, dashscope: dashscopeKey, claude: claudeKey },
      modelName: modelNames[providerName] || DEFAULT_MODEL,
      modelNames,
      providerName,
      locale: locale || undefined,
    });
  } catch (e: any) {
    console.error('Error loading settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to load settings: ${e.message}`, type: 'warn' });
  }
}

export async function handleSaveSettings(settings: Settings): Promise<void> {
  try {
    const geminiKey     = settings.apiKeys?.gemini;
    const openrouterKey = settings.apiKeys?.openrouter;
    const dashscopeKey  = settings.apiKeys?.dashscope;
    const claudeKey     = settings.apiKeys?.claude;
    const provider      = settings.providerName || 'gemini';

    // Save model name to the per-provider key
    const modelKey = MODEL_KEY_FOR_PROVIDER[provider];

    await Promise.all([
      // Provider-specific API keys
      geminiKey     !== undefined ? upsert(K.GEMINI, geminiKey)         : Promise.resolve(),
      openrouterKey !== undefined ? upsert(K.OPENROUTER, openrouterKey) : Promise.resolve(),
      dashscopeKey  !== undefined ? upsert(K.DASHSCOPE, dashscopeKey)   : Promise.resolve(),
      claudeKey     !== undefined ? upsert(K.CLAUDE, claudeKey)         : Promise.resolve(),
      // Legacy key — synced with gemini key
      upsert(K.LEGACY, geminiKey ?? settings.apiKey),
      // Per-provider model name
      modelKey ? upsert(modelKey, settings.modelName) : Promise.resolve(),
      // Active provider
      upsert(K.PROVIDER, provider),
      // Locale
      settings.locale ? upsert(K.LOCALE, settings.locale) : Promise.resolve(),
    ]);
  } catch (e: any) {
    console.error('Error saving settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to save settings: ${e.message}`, type: 'warn' });
  }
}

export async function handleResetSettings(): Promise<void> {
  try {
    await Promise.all(Object.values(K).map(k => figma.clientStorage.deleteAsync(k)));

    emit<SettingsLoadedHandler>('SETTINGS_LOADED', {
      apiKey: '',
      apiKeys: { gemini: '', openrouter: '', dashscope: '', claude: '' },
      modelName: DEFAULT_MODEL,
      providerName: 'gemini',
    });
  } catch (e: any) {
    console.error('Error resetting settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to reset settings: ${e.message}`, type: 'warn' });
  }
}
