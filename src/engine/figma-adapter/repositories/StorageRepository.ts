/**
 * @file StorageRepository.ts
 * @description Repository layer for Figma Client Storage operations.
 * 
 * [RESPONSIBILITY]: Encapsulate all figma.clientStorage calls.
 * [PATTERN]: Repository Pattern
 */

export interface SettingsData {
  apiKey?: string;
  apiKeys?: {
    gemini?: string;
    openrouter?: string;
  };
  modelName?: string;
  providerName?: 'gemini' | 'openrouter';
}

export class StorageRepository {
  private readonly LEGACY_KEY = 'GEMINI_API_KEY';
  private readonly GEMINI_KEY = 'GEMINI_API_KEY_GEMINI';
  private readonly OPENROUTER_KEY = 'GEMINI_API_KEY_OPENROUTER';
  private readonly MODEL_NAME_KEY = 'GEMINI_MODEL_NAME';
  private readonly PROVIDER_NAME_KEY = 'GEMINI_PROVIDER_NAME';

  /**
   * Load settings from client storage
   */
  async loadSettings(defaultModel: string): Promise<SettingsData> {
    const legacyKey = await figma.clientStorage.getAsync(this.LEGACY_KEY) || '';
    const geminiKey = await figma.clientStorage.getAsync(this.GEMINI_KEY) || legacyKey;
    const openrouterKey = await figma.clientStorage.getAsync(this.OPENROUTER_KEY) || '';
    
    const modelName = await figma.clientStorage.getAsync(this.MODEL_NAME_KEY) || defaultModel;
    const providerName = await figma.clientStorage.getAsync(this.PROVIDER_NAME_KEY) || 'gemini';
    
    // Choose active key based on current provider with strict isolation
    const apiKey = providerName === 'openrouter' ? openrouterKey : geminiKey;

    return {
      apiKey,
      apiKeys: {
        gemini: geminiKey,
        openrouter: openrouterKey
      },
      modelName,
      providerName: providerName as 'gemini' | 'openrouter'
    };
  }

  /**
   * Save settings to client storage
   */
  async saveSettings(settings: SettingsData): Promise<void> {
    // Save specific provider keys
    if (settings.apiKeys) {
      if (settings.apiKeys.gemini !== undefined) {
        await figma.clientStorage.setAsync(this.GEMINI_KEY, settings.apiKeys.gemini);
      }
      if (settings.apiKeys.openrouter !== undefined) {
        await figma.clientStorage.setAsync(this.OPENROUTER_KEY, settings.apiKeys.openrouter);
      }
    }

    // Handle Legacy Compatibility
    // Only update legacy key if we are explicitly saving a Gemini key, or if we are in Gemini mode
    if (settings.providerName === 'gemini' && settings.apiKey) {
      await figma.clientStorage.setAsync(this.LEGACY_KEY, settings.apiKey);
    } else if (settings.apiKeys?.gemini) {
      await figma.clientStorage.setAsync(this.LEGACY_KEY, settings.apiKeys.gemini);
    }

    if (settings.modelName) {
      await figma.clientStorage.setAsync(this.MODEL_NAME_KEY, settings.modelName);
    }
    if (settings.providerName) {
      await figma.clientStorage.setAsync(this.PROVIDER_NAME_KEY, settings.providerName);
    }
  }

  /**
   * Get a generic value from storage
   */
  async get<T>(key: string): Promise<T | undefined> {
    return figma.clientStorage.getAsync(key);
  }

  /**
   * Set a generic value in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    return figma.clientStorage.setAsync(key, value);
  }
}

// Export singleton instance
export const storageRepository = new StorageRepository();
