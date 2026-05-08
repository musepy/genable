/**
 * @file proxyWrap.ts
 * @description Wraps a real-upstream baseURL into a Cloudflare Worker proxy URL
 * when a ProviderConfig has `requiresProxy: true`.
 *
 * Worker contract — see worker/src/index.ts handleGenericProxy:
 *
 *     POST/GET https://<worker>/api/proxy/<host>/<path...>
 *         → forwards to https://<host>/<path...>
 *
 * Example:
 *     baseURL = "https://opencode.ai/zen/go/v1"           (real upstream)
 *     wrapped = "https://<worker>/api/proxy/opencode.ai/zen/go/v1"
 *
 *     protocol handler appends "/chat/completions" →
 *         "https://<worker>/api/proxy/opencode.ai/zen/go/v1/chat/completions"
 *     worker matches the route and forwards to
 *         "https://opencode.ai/zen/go/v1/chat/completions"
 *
 * Design choice: the wrap is reversible (worker has the original host in the
 * path), and it composes naturally with `${baseURL}/<endpoint>` concatenation
 * used by all three protocol handlers — no special-casing in protocols.
 */

import type { ProviderConfig } from '../../types/provider';

/** Public Worker base. Override-via-env left for a future build flag. */
export const WORKER_PROXY_BASE = 'https://figma-ai-generator.muse40007.workers.dev/api/proxy';

/**
 * If the config opts into the Worker proxy, return a clone whose baseURL is
 * rewritten to go through it. Otherwise return the input unchanged.
 *
 * Idempotent: calling twice on an already-wrapped URL is a no-op (defensive).
 */
export function wrapBaseURLForProxy(config: ProviderConfig): ProviderConfig {
  if (!config.requiresProxy) return config;
  if (config.baseURL.startsWith(WORKER_PROXY_BASE)) return config;

  // Strip scheme — host + path go after "/api/proxy/"
  const stripped = config.baseURL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (!stripped) return config; // misconfigured — leave alone, probe will fail informatively

  return {
    ...config,
    baseURL: `${WORKER_PROXY_BASE}/${stripped}`,
  };
}
