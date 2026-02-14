/**
 * @file settingsHandler.ts
 * @description IPC handlers for settings-related events.
 */

import { Settings, SettingsLoadedHandler, SendLogHandler, ResetSettingsHandler } from '../../types';
import { settingsService } from '../../engine/services';
import { emit } from '@create-figma-plugin/utilities';

/**
 * Handle LOAD_SETTINGS event.
 */
export async function handleLoadSettings(): Promise<void> {
  try {
    const settings = await settingsService.loadSettings();
    emit<SettingsLoadedHandler>('SETTINGS_LOADED', settings);
  } catch (e: any) {
    console.error('Error loading settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to load settings: ${e.message}`, type: 'warn' });
  }
}

/**
 * Handle SAVE_SETTINGS event.
 */
export async function handleSaveSettings(settings: Settings): Promise<void> {
  try {
    await settingsService.saveSettings(settings);
  } catch (e: any) {
    console.error('Error saving settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to save settings: ${e.message}`, type: 'warn' });
  }
}

/**
 * Handle RESET_SETTINGS event.
 */
export async function handleResetSettings(): Promise<void> {
  try {
    console.log('[IPC] Resetting settings...');
    await settingsService.clearSettings();
    
    // Load default settings (which will now be empty/defaults)
    const freshSettings = await settingsService.loadSettings();
    
    // Notify UI to update state (should trigger onboarding)
    emit<SettingsLoadedHandler>('SETTINGS_LOADED', freshSettings);
    
    emit<SendLogHandler>('SEND_LOG', { message: 'Settings reset successfully. Returning to onboarding.', type: 'success' });
  } catch (e: any) {
    console.error('Error resetting settings', e);
    emit<SendLogHandler>('SEND_LOG', { message: `Failed to reset settings: ${e.message}`, type: 'warn' });
  }
}
