/**
 * @file validateProviderHandler.ts
 * @description IPC handler for VALIDATE_PROVIDER. Receives a ProviderConfig
 * from the UI's "Save & Test" flow, runs probeProvider() in the sandbox, and
 * emits VALIDATE_PROVIDER_RESULT keyed by requestId.
 *
 * The requestId lets the UI correlate concurrent probes. Single-shot — no
 * retries here; the user can click Save & Test again.
 */
import { emit } from '@create-figma-plugin/utilities';
import type { ProviderConfig } from '../../types/provider';
import type { ValidateProviderResultHandler } from '../../types';
import { probeProvider } from '../../engine/llm-client/providerProbe';

export async function handleValidateProvider(
  data: { requestId: string; config: ProviderConfig },
): Promise<void> {
  const { requestId, config } = data;
  try {
    const result = await probeProvider(config);
    emit<ValidateProviderResultHandler>('VALIDATE_PROVIDER_RESULT', { requestId, result });
  } catch (e: any) {
    // probeProvider is supposed to never throw — but defend anyway so a stray
    // exception doesn't leave the UI hanging on a never-resolving requestId.
    emit<ValidateProviderResultHandler>('VALIDATE_PROVIDER_RESULT', {
      requestId,
      result: { kind: 'network-error', message: e?.message || 'Probe failed' },
    });
  }
}
