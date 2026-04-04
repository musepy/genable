import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler,
  ResetSettingsHandler,
} from '../types'
import { ModelService } from '../services/ModelService'
import { DEFAULT_MODEL, SUPPORTED_MODELS } from '../ui/constants/models'
import { useToast } from '../ui/components/ui'

type ProviderName = 'gemini' | 'openrouter' | 'dashscope' | 'claude'
type ApiKeyMap = Record<ProviderName, string>
type ModelNameMap = Record<string, string>

export function useModelSettings() {
  const { toast } = useToast()

  // --- Core state ---
  const [apiKeys, setApiKeys] = useState<ApiKeyMap>({ gemini: '', openrouter: '', dashscope: '', claude: '' })
  const [providerName, setProviderName] = useState<ProviderName>('gemini')
  const [modelNames, setModelNames] = useState<ModelNameMap>({})  // per-provider model names
  const [suggestedModels, setSuggestedModels] = useState<{ name: string, displayName: string }[]>([])

  // --- UI state ---
  const [hasConfig, setHasConfig] = useState<boolean>(false)
  const [isInitialized, setIsInitialized] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'success' | 'fail'>('idle')

  const isRefreshingRef = useRef(false)

  // --- Derived ---
  const apiKey = apiKeys[providerName] || ''
  const modelName = modelNames[providerName] || DEFAULT_MODEL

  // --- Helpers ---

  /** Update model name for the current provider */
  const setModelName = useCallback((name: string) => {
    setModelNames(prev => ({ ...prev, [providerName]: name }))
  }, [providerName])

  /** Get model list synchronously — static fallback if empty */
  const getModels = useCallback((): { name: string, displayName: string }[] => {
    return suggestedModels.length > 0 ? suggestedModels : (SUPPORTED_MODELS[providerName] || SUPPORTED_MODELS.gemini)
  }, [suggestedModels, providerName])

  /** Background SWR refresh */
  const refreshModelsInBackground = useCallback(async (key: string) => {
    if (isRefreshingRef.current || !key) return
    isRefreshingRef.current = true
    try {
      await ModelService.warmCache(providerName, key)
      const result = await ModelService.getModels(providerName, key, false)
      if (!result.error && result.models.length > 0) {
        setSuggestedModels(result.models)
      }
    } catch (e) {
      console.warn('[SWR] Background model refresh failed:', e)
    } finally {
      isRefreshingRef.current = false
    }
  }, [providerName])

  // --- Persistence ---

  const persistSettings = useCallback(() => {
    emit<SaveSettingsHandler>('SAVE_SETTINGS', {
      apiKey: apiKeys[providerName] || '',
      apiKeys,
      modelName,
      providerName,
    })
  }, [apiKeys, modelName, providerName])

  // --- Settings load ---

  useEffect(() => {
    emit<LoadSettingsHandler>('LOAD_SETTINGS')
  }, [])

  useEffect(() => {
    return on<SettingsLoadedHandler>('SETTINGS_LOADED', (s) => {
      const nextProvider = s.providerName || 'gemini'
      const nextApiKeys: ApiKeyMap = {
        gemini: s.apiKeys?.gemini || '',
        openrouter: s.apiKeys?.openrouter || '',
        dashscope: s.apiKeys?.dashscope || '',
        claude: s.apiKeys?.claude || '',
      }
      // Legacy single key support
      if (!s.apiKeys && s.apiKey) {
        nextApiKeys[nextProvider] = s.apiKey
      }

      const activeKey = nextApiKeys[nextProvider] || ''
      const hasAnyKey = Boolean(nextApiKeys.gemini || nextApiKeys.openrouter || nextApiKeys.dashscope)

      setApiKeys(nextApiKeys)

      if (!isInitialized || !hasAnyKey) {
        setProviderName(nextProvider)
        setHasConfig(Boolean(activeKey))
        setShowSettings(false)
        setSettingsError(null)
        setFetchStatus('idle')
      }

      // Per-provider model names from storage
      if (!isInitialized && s.modelNames) {
        setModelNames(s.modelNames)
      } else if (!isInitialized && s.modelName) {
        // Migration: old single modelName → current provider
        setModelNames(prev => ({ ...prev, [nextProvider]: s.modelName }))
      } else if (!hasAnyKey) {
        setModelNames({})
      }

      // Model list set by provider switch effect (runs after this state update)
      // Don't call refreshModelsInBackground here — stale closure over providerName

      setIsInitialized(true)
    })
  }, [isInitialized])

  // --- Provider switch: sync model list + trigger SWR ---

  useEffect(() => {
    if (!isInitialized) return
    setSuggestedModels(ModelService.getStaticModels(providerName))
    setFetchStatus('idle')
    setSettingsError(null)

    const key = apiKeys[providerName] || ''
    if (key) {
      refreshModelsInBackground(key)
    }
  }, [providerName, isInitialized, apiKeys, refreshModelsInBackground])

  // --- Actions ---

  const updateApiKey = (key: string) => {
    setApiKeys(prev => ({ ...prev, [providerName]: key }))
  }

  const handleSaveSettings = () => {
    persistSettings()
    setHasConfig(Boolean(apiKeys[providerName]))
    setShowSettings(false)
  }

  const completeOnboarding = useCallback((key: string) => {
    const nextApiKeys: ApiKeyMap = { ...apiKeys, [providerName]: key }
    setApiKeys(nextApiKeys)
    setHasConfig(true)
    setShowSettings(false)
    emit<SaveSettingsHandler>('SAVE_SETTINGS', {
      apiKey: key,
      apiKeys: nextApiKeys,
      modelName,
      providerName,
    })
    toast('Connected successfully', 'success')
  }, [apiKeys, modelName, providerName, toast])

  /** Explicit model fetch — shows loading state */
  const handleFetchModels = async (keyOverride?: string) => {
    const keyToUse = keyOverride || apiKeys[providerName] || ''
    setFetchStatus('fetching')

    try {
      const result = await ModelService.getModels(providerName, keyToUse, true)

      if (!result.error) {
        setSuggestedModels(result.models)
        setFetchStatus('success')

        // Auto-select if current model not in list
        if (result.models.length > 0 && !result.models.find(m => m.name === modelName)) {
          setModelName(result.models[0].name)
        }
      } else {
        setSuggestedModels(result.models)
        setFetchStatus('fail')
        setSettingsError(result.error || 'Failed to fetch models')
        if (keyOverride) {
          throw new Error(result.error || 'Invalid API key')
        }
      }
    } catch (e: unknown) {
      setFetchStatus('fail')
      setSettingsError(e instanceof Error ? e.message : 'Unknown error')
      throw e
    }
  }

  const logout = useCallback(() => {
    emit<ResetSettingsHandler>('RESET_SETTINGS')
    toast('Logged out', 'default')
  }, [toast])

  const restoreSavedSession = useCallback(() => {
    setIsInitialized(false)
    setSettingsError(null)
    setFetchStatus('idle')
    emit<LoadSettingsHandler>('LOAD_SETTINGS')
    toast('Restored saved session', 'success')
  }, [toast])

  return {
    apiKey,
    setApiKey: updateApiKey,
    apiKeys,
    setApiKeys,
    modelName,
    setModelName,
    providerName,
    setProviderName: (name: ProviderName) => setProviderName(name),
    suggestedModels,
    setSuggestedModels,
    hasConfig,
    setHasConfig,
    isInitialized,
    showSettings,
    setShowSettings,
    settingsError,
    fetchStatus,
    handleSaveSettings,
    completeOnboarding,
    handleFetchModels,
    getModels,
    refreshModelsInBackground,
    isCacheStale: false, // No longer tracked — SWR always refreshes on load
    logout,
    restoreSavedSession,
  }
}
