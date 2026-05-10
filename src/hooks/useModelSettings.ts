/**
 * @file useModelSettings.ts
 * @description V2 (protocol-based) settings hook. Source of truth is the
 * `providers: ProviderConfig[]` array + `activeProviderId`. Legacy fields
 * (apiKey, modelName, providerName) are derived live from the active provider
 * for back-compat with AgentOrchestrator and ModelPopover.
 *
 * Replaces the per-vendor map model. The settingsHandler emits both shapes
 * during the transition; we only consume the V2 fields here.
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler,
  ResetSettingsHandler,
  ValidateProviderHandler,
  ValidateProviderResultHandler,
} from '../types'
import type { ProviderConfig, ProviderProbeResult } from '../types/provider'
import { DEFAULT_MODEL } from '../ui/constants/models'
import { useToast } from '../ui/components/ui'
import { resolveLocale, type Locale, type LocalePreference } from '../ui/i18n'

type LegacyProviderName = 'gemini' | 'openrouter' | 'dashscope' | 'claude'
type ThemePref = 'auto' | 'light' | 'dark'

/** UUID for new ProviderConfig entries. Falls back if crypto.randomUUID is missing. */
function newProviderId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Map a ProviderConfig to a legacy provider-name bucket. Used so AgentOrchestrator
 * (which still keys on 'gemini' | 'openrouter' | 'dashscope' | 'claude') keeps
 * working unchanged. Heuristics:
 *  - protocol gemini    → 'gemini'
 *  - protocol anthropic → 'claude'
 *  - protocol openai    → 'openrouter' (the only generic-OpenAI legacy bucket)
 *
 * For more accurate routing, the dispatch should move to protocol-based, but
 * that's a separate phase.
 */
function deriveLegacyProviderName(config: ProviderConfig | null): LegacyProviderName {
  if (!config) return 'gemini'
  if (config.presetId === 'dashscope-openai') return 'dashscope'
  if (config.protocol === 'gemini') return 'gemini'
  if (config.protocol === 'anthropic') return 'claude'
  return 'openrouter'
}

export function useModelSettings() {
  const { toast } = useToast()

  // --- V2 core state (source of truth) ---
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [activeProviderId, setActiveProviderIdState] = useState<string | null>(null)

  // --- Locale state ---
  const [localePref, setLocalePref] = useState<LocalePreference>('auto')
  const locale: Locale = resolveLocale(localePref)

  // --- Theme state ---
  const [theme, setThemeState] = useState<ThemePref>('auto')

  // --- UI state ---
  const [isInitialized, setIsInitialized] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)

  // --- Pending probe correlation ---
  const probeWaitersRef = useRef<Map<string, (r: ProviderProbeResult) => void>>(new Map())

  // --- Derived ---
  const activeProvider: ProviderConfig | null =
    providers.find(p => p.id === activeProviderId) ?? null
  const hasConfig = providers.length > 0
  const apiKey = activeProvider?.apiKey ?? ''
  const modelName = activeProvider?.modelId || DEFAULT_MODEL
  const providerName: LegacyProviderName = deriveLegacyProviderName(activeProvider)

  // --- Persistence helper ---
  const persistV2 = useCallback(
    (next: {
      providers?: ProviderConfig[]
      activeProviderId?: string | null
      locale?: LocalePreference
      theme?: ThemePref
    }) => {
      const payload = {
        providers: next.providers ?? providers,
        activeProviderId:
          next.activeProviderId !== undefined ? next.activeProviderId : activeProviderId,
        locale: next.locale ?? localePref,
        theme: next.theme ?? theme,
      }
      // Required-but-derived legacy fields. settingsHandler ignores them when
      // settings.providers is an array, but the Settings interface requires them.
      const active = (payload.providers || []).find(p => p.id === payload.activeProviderId) || null
      emit<SaveSettingsHandler>('SAVE_SETTINGS', {
        providers: payload.providers,
        activeProviderId: payload.activeProviderId,
        apiKey: active?.apiKey || '',
        modelName: active?.modelId || DEFAULT_MODEL,
        locale: payload.locale,
        theme: payload.theme,
      })
    },
    [providers, activeProviderId, localePref, theme],
  )

  // --- V2 mutations ---

  const addProvider = useCallback(
    (cfg: Omit<ProviderConfig, 'id'>): string => {
      const id = newProviderId()
      const next: ProviderConfig = { id, ...cfg }
      const nextProviders = [...providers, next]
      // First provider added becomes active; otherwise keep current active
      const nextActive = activeProviderId ?? id
      setProviders(nextProviders)
      setActiveProviderIdState(nextActive)
      persistV2({ providers: nextProviders, activeProviderId: nextActive })
      return id
    },
    [providers, activeProviderId, persistV2],
  )

  const updateProvider = useCallback(
    (id: string, patch: Partial<ProviderConfig>): void => {
      const nextProviders = providers.map(p =>
        p.id === id ? { ...p, ...patch, id: p.id } : p,
      )
      setProviders(nextProviders)
      persistV2({ providers: nextProviders })
    },
    [providers, persistV2],
  )

  const removeProvider = useCallback(
    (id: string): void => {
      const nextProviders = providers.filter(p => p.id !== id)
      let nextActive = activeProviderId
      if (activeProviderId === id) {
        nextActive = nextProviders[0]?.id ?? null
      }
      setProviders(nextProviders)
      setActiveProviderIdState(nextActive)
      persistV2({ providers: nextProviders, activeProviderId: nextActive })
    },
    [providers, activeProviderId, persistV2],
  )

  const setActiveProviderId = useCallback(
    (id: string): void => {
      if (!providers.find(p => p.id === id)) return
      setActiveProviderIdState(id)
      persistV2({ activeProviderId: id })
    },
    [providers, persistV2],
  )

  // --- Legacy compatibility setter (used by AgentOrchestrator path / ModelPopover) ---

  /** Update the active provider's modelId. */
  const setModelName = useCallback(
    (name: string): void => {
      if (!activeProviderId) return
      const nextProviders = providers.map(p =>
        p.id === activeProviderId ? { ...p, modelId: name } : p,
      )
      setProviders(nextProviders)
      persistV2({ providers: nextProviders })
    },
    [providers, activeProviderId, persistV2],
  )

  // --- Locale ---
  const handleSetLocalePref = useCallback(
    (pref: LocalePreference): void => {
      setLocalePref(pref)
      persistV2({ locale: pref })
    },
    [persistV2],
  )

  // --- Theme ---
  const setTheme = useCallback(
    (next: ThemePref): void => {
      setThemeState(next)
      persistV2({ theme: next })
    },
    [persistV2],
  )

  // --- Validation (probe) ---

  /** Wraps the VALIDATE_PROVIDER round-trip into a Promise<ProviderProbeResult>.
   *
   *  Protocol is taken from the preset, so a single probe is always enough. */
  const validateProvider = useCallback(
    (cfg: ProviderConfig): Promise<ProviderProbeResult> => {
      return new Promise(resolve => {
        const requestId = `probe-${newProviderId()}`
        probeWaitersRef.current.set(requestId, resolve)
        emit<ValidateProviderHandler>('VALIDATE_PROVIDER', {
          requestId,
          config: cfg,
        })
        // Defensive timeout in case the sandbox never responds. 15s covers
        // cold-start latency on free-tier model queues plus Figma's network
        // proxy overhead.
        setTimeout(() => {
          const waiter = probeWaitersRef.current.get(requestId)
          if (waiter) {
            probeWaitersRef.current.delete(requestId)
            waiter({ kind: 'network-error', message: 'Probe timed out' })
          }
        }, 15_000)
      })
    },
    [],
  )

  // Listen for validate results
  useEffect(() => {
    return on<ValidateProviderResultHandler>('VALIDATE_PROVIDER_RESULT', ({ requestId, result }) => {
      const waiter = probeWaitersRef.current.get(requestId)
      if (waiter) {
        probeWaitersRef.current.delete(requestId)
        waiter(result)
      }
    })
  }, [])

  // --- Settings load / hydration ---

  useEffect(() => {
    emit<LoadSettingsHandler>('LOAD_SETTINGS')
  }, [])

  useEffect(() => {
    return on<SettingsLoadedHandler>('SETTINGS_LOADED', (s) => {
      const nextProviders: ProviderConfig[] = Array.isArray(s.providers) ? s.providers : []
      const nextActiveId: string | null =
        s.activeProviderId !== undefined ? (s.activeProviderId ?? null) :
        (nextProviders[0]?.id ?? null)

      setProviders(nextProviders)
      setActiveProviderIdState(nextActiveId)

      // Locale + theme only on first load
      if (!isInitialized) {
        if (s.locale) setLocalePref(s.locale as LocalePreference)
        if (s.theme) setThemeState(s.theme as ThemePref)
      }

      setIsInitialized(true)
    })
  }, [isInitialized])

  // --- Lifecycle ---

  const logout = useCallback(() => {
    emit<ResetSettingsHandler>('RESET_SETTINGS')
    toast('Signed out', 'default')
  }, [toast])

  return {
    // V2 (primary)
    providers,
    activeProviderId,
    activeProvider,
    addProvider,
    updateProvider,
    removeProvider,
    setActiveProviderId,
    validateProvider,

    // Legacy derived (for AgentOrchestrator + ModelPopover compatibility)
    apiKey,
    modelName,
    setModelName,
    providerName,

    // Prefs
    locale,
    localePref,
    setLocalePref: handleSetLocalePref,
    theme,
    setTheme,

    // Lifecycle
    hasConfig,
    isInitialized,
    showSettings,
    setShowSettings,
    logout,
  }
}
