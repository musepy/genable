/**
 * @file configManager.ts
 * @description Unified configuration access point.
 */

import { FEATURE_FLAGS, FeatureFlag } from '../constants/featureFlags';
import { VIEWPORT_DEFAULTS, STREAM_CONFIG, UI_DEFAULTS } from './defaults';

class ConfigManager {
  /**
   * Check if a feature is enabled
   */
  isEnabled(flag: FeatureFlag): boolean {
    return FEATURE_FLAGS[flag] || false;
  }

  /**
   * Get viewport defaults based on mode
   */
  getViewport(isMobile: boolean) {
    return isMobile ? VIEWPORT_DEFAULTS.MOBILE : VIEWPORT_DEFAULTS.DESKTOP;
  }

  /**
   * Get streaming rhythm configuration
   */
  getStreamConfig() {
    return STREAM_CONFIG;
  }

  /**
   * Get UI loading sequence
   */
  getLoadingSteps() {
    return UI_DEFAULTS.LOADING_STEPS;
  }
}

export const configManager = new ConfigManager();
