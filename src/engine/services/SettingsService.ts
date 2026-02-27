/**
 * @file SettingsService.ts
 * @description Service layer for plugin settings.
 * 
 * [RESPONSIBILITY]: Business logic for settings management.
 * [PATTERN]: Service Layer
 */

import { storageRepository } from '../figma-adapter/repositories';
import { DEFAULT_MODEL } from '../../ui/constants/models';

export interface SettingsResult {
  apiKey: string;
  apiKeys: {
    gemini: string;
    openrouter: string;
  };
  modelName: string;
  providerName: 'gemini' | 'openrouter';
  telemetryEndpoint: string;
  telemetryApiKey: string;
}

export interface SaveSettingsInput {
  apiKey?: string;
  apiKeys?: {
    gemini?: string;
    openrouter?: string;
  };
  modelName?: string;
  providerName?: 'gemini' | 'openrouter';
  telemetryEndpoint?: string;
  telemetryApiKey?: string;
}

/**
 * Service for settings management.
 */
export class SettingsService {
  private repository = storageRepository;

  /**
 * Load settings with defaults.
   */
  async loadSettings(): Promise<SettingsResult> {
    const data = await this.repository.loadSettings(DEFAULT_MODEL);
    return {
      apiKey: data.apiKey || '',
      apiKeys: {
        gemini: data.apiKeys?.gemini || '',
        openrouter: data.apiKeys?.openrouter || ''
      },
      modelName: data.modelName || DEFAULT_MODEL,
      providerName: data.providerName || 'gemini',
      telemetryEndpoint: data.telemetryEndpoint || '',
      telemetryApiKey: data.telemetryApiKey || ''
    };
  }

  /**
   * Save settings with validation.
   */
  async saveSettings(settings: SaveSettingsInput): Promise<void> {
    await this.repository.saveSettings({
      apiKey: settings.apiKey,
      apiKeys: settings.apiKeys,
      modelName: settings.modelName,
      providerName: settings.providerName,
      telemetryEndpoint: settings.telemetryEndpoint,
      telemetryApiKey: settings.telemetryApiKey
    });
  }

  /**
   * Clear all settings.
   */
  async clearSettings(): Promise<void> {
    await this.repository.clearSettings();
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
