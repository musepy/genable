/**
 * @file provider.ts
 * @description Protocol-based provider configuration model.
 *
 * Replaces the per-vendor union `'gemini' | 'openrouter' | 'dashscope' | 'claude'`
 * with a generic list of ProviderConfig. The wire format dispatch key is
 * `protocol`, one of three: openai | anthropic | gemini. Adding a new vendor
 * (OpenCode Zen / Moonshot / DeepSeek / self-hosted vLLM) is a JSON edit, not
 * a code change.
 *
 * Path conventions:
 *   - openai handler:     POST <baseURL>/chat/completions
 *   - anthropic handler:  POST <baseURL>/messages
 *   - gemini handler:     uses @google/genai SDK; baseURL is informational
 *
 * baseURL always ends in /v1 (or /v1beta for Gemini AI Studio). Examples:
 *   - https://api.openai.com/v1
 *   - https://opencode.ai/zen/v1     (serves BOTH /chat/completions and /messages)
 *   - https://api.anthropic.com/v1
 *   - https://dashscope.aliyuncs.com/apps/anthropic/v1
 *   - https://generativelanguage.googleapis.com/v1beta
 */

/** Wire formats. Adding a 4th means writing a new protocol handler. */
export type Protocol = 'openai' | 'anthropic' | 'gemini';

/**
 * A configured LLM provider. Replaces the per-vendor enum + sibling key/model maps.
 *
 * Stored in figma.clientStorage under PROVIDERS_V2 as a JSON-stringified array.
 */
export interface ProviderConfig {
  /** UUID — stable across name edits and protocol changes. */
  id: string;

  /** User-visible display name. Free-form, not unique. e.g. "公司 Zen 备份". */
  name: string;

  /** Wire format. Determines which protocol handler runs. */
  protocol: Protocol;

  /** Endpoint base URL ending in /v1 (or /v1beta for Gemini AI Studio). */
  baseURL: string;

  /** API key. Stored locally only. */
  apiKey: string;

  /** Selected model id (e.g. "claude-sonnet-4-6"). Optional. */
  modelId?: string;

  /** Reference to the preset that seeded this config. Optional (custom entries omit it). */
  presetId?: string;

  /**
   * Vendor-specific extra HTTP headers. Spread into the request after auth headers.
   * Examples:
   *   - DashScope OpenAI:  { 'User-Agent': 'claude-cli/2.0.57 (external, cli)' }
   *   - OpenRouter:        { 'HTTP-Referer': '...', 'X-Title': '...' }
   *
   * Auth headers (Authorization / x-api-key / api-key) are added by the protocol
   * handler and MUST NOT be set here.
   */
  headers?: Record<string, string>;

  /**
   * Model IDs discovered by the most recent probe's list-models call. Used as
   * datalist suggestions in the Model ID field so the user doesn't have to
   * hand-type IDs after a successful key validation. Populated for OpenAI
   * (GET /models) and Gemini (GET /models) protocols; Anthropic has no public
   * list endpoint so this stays undefined.
   *
   * Stale entries are harmless — the field is suggestions, not a whitelist.
   * Re-probing in the Edit flow refreshes it.
   */
  availableModels?: string[];

  /**
   * If true, route requests through the Cloudflare Worker generic proxy. The
   * stored `baseURL` remains the real upstream — wrapping happens at request
   * time. Copied from the preset on save.
   *
   * Set for third-party OpenAI-compatible services that don't serve CORS
   * headers (DashScope, OpenCode Go, etc.). Native Anthropic / OpenAI / Gemini
   * speak CORS directly and leave this undefined.
   */
  requiresProxy?: boolean;
}

/**
 * Curated preset entry loaded from src/config/provider-presets.json.
 *
 * A preset is a "fill the form for me" helper — it pre-populates name / protocol /
 * baseURL / headers / defaultModel, leaving only the apiKey for the user to enter.
 * Custom (no preset) entries are equally first-class.
 */
export interface ProviderPreset {
  /** Stable preset id — used as ProviderConfig.presetId for tracking. */
  id: string;

  /** Default display name (user can edit after creation). */
  name: string;

  protocol: Protocol;
  baseURL: string;

  /** User-facing link to obtain an API key. Shown in the form. */
  keyUrl: string;

  /** Suggested initial model id. Optional — user can fetch list and pick. */
  defaultModel?: string;

  /** Vendor-specific headers (e.g. DashScope's User-Agent). */
  headers?: Record<string, string>;

  /**
   * If true, the upstream doesn't serve CORS headers from a browser origin (or
   * Figma manifest doesn't list it). Client wraps `baseURL` into a Worker
   * proxy URL at request time and the Worker forwards. The host portion of
   * `baseURL` MUST also appear in the Worker's PROXY_HOST_WHITELIST.
   */
  requiresProxy?: boolean;
}

/**
 * Result of probing a provider endpoint with a max_tokens:1 request.
 * Returned by the VALIDATE_PROVIDER IPC handler.
 */
export type ProviderProbeResult =
  | { kind: 'ok'; models?: string[] }
  | { kind: 'auth-error'; message: string }
  | { kind: 'credits-error'; message: string; billingUrl?: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'network-error'; message: string }
  | { kind: 'unknown'; status: number; message: string };
