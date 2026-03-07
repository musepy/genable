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
  MODEL:      'GEMINI_MODEL_NAME',
  PROVIDER:   'GEMINI_PROVIDER_NAME',
} as const;

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
    const [legacy, gemini, openrouter, dashscope, model, provider] = await Promise.all([
      figma.clientStorage.getAsync(K.LEGACY),
      figma.clientStorage.getAsync(K.GEMINI),
      figma.clientStorage.getAsync(K.OPENROUTER),
      figma.clientStorage.getAsync(K.DASHSCOPE),
      figma.clientStorage.getAsync(K.MODEL),
      figma.clientStorage.getAsync(K.PROVIDER),
    ]);

    const providerName = provider ?? 'gemini';
    // ?? (not ||) — empty string means "explicitly cleared", not "missing"
    const geminiKey   = gemini   ?? legacy ?? '';
    const openrouterKey = openrouter ?? '';
    const dashscopeKey = dashscope ?? '';
    const activeKey = providerName === 'openrouter' ? openrouterKey
      : providerName === 'dashscope' ? dashscopeKey
      : geminiKey;

    emit<SettingsLoadedHandler>('SETTINGS_LOADED', {
      apiKey: activeKey,
      apiKeys: { gemini: geminiKey, openrouter: openrouterKey, dashscope: dashscopeKey },
      modelName: model ?? DEFAULT_MODEL,
      providerName,
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

    await Promise.all([
      // Provider-specific keys
      geminiKey     !== undefined ? upsert(K.GEMINI, geminiKey)         : Promise.resolve(),
      openrouterKey !== undefined ? upsert(K.OPENROUTER, openrouterKey) : Promise.resolve(),
      dashscopeKey  !== undefined ? upsert(K.DASHSCOPE, dashscopeKey)   : Promise.resolve(),
      // Legacy key — always synced with gemini key (or cleaned up)
      upsert(K.LEGACY, geminiKey ?? settings.apiKey),
      // Model & provider
      upsert(K.MODEL, settings.modelName),
      upsert(K.PROVIDER, settings.providerName),
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
      apiKeys: { gemini: '', openrouter: '', dashscope: '' },
      modelName: DEFAULT_MODEL,
      providerName: 'gemini',
    });
  } catch (e: any) {
    console.error('Error resetting settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to reset settings: ${e.message}`, type: 'warn' });
  }
}
