/**
 * @file providerPresets.ts
 * @description Typed loader for provider-presets.json.
 *
 * Adding a new provider preset is a JSON edit at provider-presets.json — no code
 * change required here unless the schema (ProviderPreset interface) evolves.
 *
 * Manifest note: the host in `baseURL` MUST also be added to
 * `package.json#figma.networkAccess.allowedDomains`, otherwise Figma blocks the
 * request at the network layer (regardless of how the plugin code is written).
 */

import type { ProviderPreset } from '../types/provider';
import presetsRaw from './provider-presets.json';

export const PROVIDER_PRESETS: ReadonlyArray<ProviderPreset> = presetsRaw as ProviderPreset[];

export function findPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(p => p.id === id);
}
