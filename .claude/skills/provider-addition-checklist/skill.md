---
name: provider-addition-checklist
description: Checklist for adding a new LLM provider — ensures all 14 coupled files are updated together
trigger: (新增provider|加provider|add provider|new provider|接入模型|接入API|provider change|新模型接入)
---

# Provider Addition Checklist

When adding a new LLM provider, 14 files must be updated in sync. Missing any one causes type errors, runtime failures, or UI gaps.

## Wire Format Decision

First: does the new provider use an existing wire format or a new one?

| Format | Shared adapter | Providers using it |
|--------|---------------|-------------------|
| OpenAI | `shared/openaiFormat.ts` (`mapMessagesToOpenAI` + `mapOpenAIToLLMResponse`) | OpenRouter, DashScope |
| Gemini | `gemini/geminiFormat.ts` | GeminiProvider, ProxyProvider |
| Anthropic | Inline in `anthropic.ts` (`mapMessagesToAnthropic` + `mapAnthropicToLLMResponse`) | AnthropicProvider |

- OpenAI-compatible: ~50 lines (import shared format)
- Own format: ~100-150 lines (write mapMessages + mapToLLMResponse)

## File Chain (14 files, all must be consistent)

### 1. Provider Implementation
`src/engine/llm-client/providers/{name}.ts`
- Implement `LLMProvider` interface (generate, formatResponse, formatToolResults, getToolSystemInstruction, getCapabilities)
- Constructor: `(apiKey: string, modelName: string, baseUrl?: string)`
- Use `formatResponseDefault()` / `formatToolResultsDefault()` unless provider has special requirements
- Set `contextWindow` in `getCapabilities()` to the model's actual context window

### 2. Config Constants
`src/engine/llm-client/config.ts`
- Add `{NAME}_CONFIG = { BASE_URL, DEFAULT_MODEL, ... } as const`
- If provider has alternative endpoints (e.g., DashScope Anthropic-compat), add those too

### 3. Provider Constants
`src/constants/terms/providers.ts`
- Add to `PROVIDER_IDS`: `{NAME}: '{name}'`
- Add to `PROVIDER_NAMES`: `{NAME}: '{Display Name}'`
- Type derivation (`ProviderId`, `ProviderName`) auto-updates via `as const`

### 4. Module Exports
`src/engine/llm-client/index.ts`
- Export provider class: `export { {Name}Provider } from './providers/{name}'`
- Export config: add to `OPENROUTER_CONFIG, DASHSCOPE_CONFIG, ...` export line

### 5. Provider Registration
`src/engine/services/AgentOrchestrator.ts`
- Import provider class + config
- Add `else if (providerName === '{name}')` branch in `createAgent()`
- Include `emit('SEND_LOG', ...)` for observability
- If provider supports alternative base URLs, add auto-detection logic here

### 6. Model List
`src/engine/llm-client/modelFilter.ts`
- Add `fetch{Name}Models(apiKey)` function (static list or API call)
- Add `if (provider === '{name}')` branch in `fetchModels()`
- Update `fetchModels()` type signature to include new provider name

### 7. Settings Storage
`src/ipc/handlers/settingsHandler.ts`
- Add storage keys to `K`: `{NAME}: 'GEMINI_API_KEY_{NAME}'`, `MODEL_{NAME}: 'MODEL_{NAME}'`
- Add to `MODEL_KEY_FOR_PROVIDER` map
- Update `handleLoadSettings()`: add to Promise.all, destructuring, activeKey logic, modelNames
- Update `handleSaveSettings()`: add key extraction + upsert
- Update `handleResetSettings()`: add to apiKeys default

### 8. Settings Type
`src/types.ts`
- Extend `providerName` union: `'gemini' | 'openrouter' | 'dashscope' | '{name}'`

### 9. Model Settings Hook
`src/hooks/useModelSettings.ts`
- Extend `ProviderName` type
- Add to `ApiKeyMap` initial state: `{ ..., {name}: '' }`
- Add to SETTINGS_LOADED handler: `nextApiKeys.{name} = s.apiKeys?.{name} || ''`

### 10. Chat Hook
`src/features/chat/useChat.ts`
- Extend `providerName` type in `UseChatProps`

### 11. Settings UI
`src/ui/SettingsPanel.tsx`
- Extend `providerName` type in `SettingsPanelProps`
- Add to `providerMetaMap`: `{ label, keyUrl, keyLabel }`
- Add to tab array: `(['gemini', 'openrouter', 'dashscope', '{name}'] as const)`
- Extend `expandedProvider` state type

### 12. Onboarding Auto-detect
`src/ui/components/OnboardingView.tsx`
- Extend `ProviderName` type
- Add key prefix detection in `detectProvider()`: e.g., `sk-ant-` -> claude

### 13. Model Popover
`src/ui/components/ModelPopover.tsx`
- Extend `providerName` type in props

### 14. Network Access
`package.json` (NOT manifest.json — build.js generates manifest from package.json)
- Add provider's API domain to `networkAccess.allowedDomains`
- **IMPORTANT**: manifest.json is overwritten by `node build.js` — always edit package.json

## Verification

After all files updated:
1. `npx tsc --noEmit` — zero errors
2. `node build.js` — builds successfully
3. Check manifest.json has correct allowedDomains (auto-generated from package.json)
4. In Figma: Settings tab shows new provider, key auto-detection works, model list loads

## Common Gotchas

- **manifest.json is NOT source of truth** — package.json is. Build script overwrites manifest.
- **CORS**: Figma plugin runs in iframe sandbox. If provider API doesn't support CORS from browser, you need a proxy (Cloudflare Worker or `figma.fetch`).
- **`anthropic-dangerous-direct-browser-access` header**: Required for native Anthropic API from browser. DashScope-compat endpoint doesn't need it.
- **Alternating message turns**: Some APIs (Anthropic) require strict user/assistant alternation. Add merge logic in the format adapter.
- **Tool calling format differs per protocol**: OpenAI uses `tool_calls[]` + `tool` role, Anthropic uses `tool_use`/`tool_result` content blocks, Gemini uses `functionCall`/`functionResponse` parts.
- **Stream idle timeout was removed (commit 7658764)** — `StreamIdleTimeoutError` and `STREAM_IDLE_TIMEOUT_MS` no longer exist. `consumeStream` in `src/engine/llm-client/providers/shared/streamHandler.ts` is now a plain `for await` loop with signature `consumeStream(source, onChunk, { abortSignal })` — no `idleTimeoutMs` parameter. New providers do NOT need to set up any idle timer. Only two timeout concerns remain:
  1. **Connect timeout**: set `CONNECT_TIMEOUT_MS` in your provider (e.g., 90 s for slow cross-border APIs) and wrap your `fetch` with `withConnectTimeout`.
  2. **User cancel**: propagate the `AbortSignal` from `LLMGenerateOptions` into your `fetch` call and into `consumeStream`.
