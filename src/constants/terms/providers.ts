export const PROVIDER_NAMES = {
  GEMINI: 'Gemini',
  OPENROUTER: 'OpenRouter',
  DASHSCOPE: 'DashScope',
} as const;

export const PROVIDER_IDS = {
  GEMINI: 'gemini',
  OPENROUTER: 'openrouter',
  DASHSCOPE: 'dashscope',
} as const;

export const MODEL_FAMILIES = {
  GEMINI_2_5_FLASH: 'gemini-2.5-flash',
  GEMINI_2_5_PRO: 'gemini-2.5-pro',
  GEMINI_2_5_FLASH_PREVIEW_05_20: 'gemini-2.5-flash-preview-05-20',
  GEMINI_2_5_PRO_PREVIEW_05_06: 'gemini-2.5-pro-preview-05-06',
  CLAUDE_3_5_SONNET: 'anthropic/claude-3.5-sonnet',
  GPT_4O: 'openai/gpt-4o',
  DEEPSEEK_R1_FREE: 'deepseek/deepseek-r1:free',
  GEMINI_2_0_FLASH_FREE: 'google/gemini-2.0-flash-exp:free',
  DEEPSEEK_CHIMERA_FREE: 'tng/deepseek-r1-t2-chimera:free'
} as const;

export type ProviderName = typeof PROVIDER_NAMES[keyof typeof PROVIDER_NAMES];
export type ProviderId = typeof PROVIDER_IDS[keyof typeof PROVIDER_IDS];
export type ModelFamily = typeof MODEL_FAMILIES[keyof typeof MODEL_FAMILIES];
