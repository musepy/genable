import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler,
  ResetSettingsHandler,
} from '../types'
import { ModelService } from '../services/ModelService'
import { DEFAULT_MODEL, SUPPORTED_MODELS, MODEL_CACHE_TTL_MS } from '../ui/constants/models'
import { useToast } from '../ui/components/ui'

type ApiKeyMap = Record<'gemini' | 'openrouter', string>

export function useModelSettings() {
  const { toast } = useToast()

  const [apiKey, setApiKey] = useState<string>('')
  const [apiKeys, setApiKeys] = useState<ApiKeyMap>({ gemini: '', openrouter: '' })
  const [modelName, setModelName] = useState<string>(DEFAULT_MODEL)
  const [providerName, setProviderName] = useState<'gemini' | 'openrouter'>('gemini')
  const [suggestedModels, setSuggestedModels] = useState<{ name: string, displayName: string }[]>([])
  const [cacheTimestamp, setCacheTimestamp] = useState<number>(0)

  const [hasConfig, setHasConfig] = useState<boolean>(false)
  const [isInitialized, setIsInitialized] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)

  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'success' | 'fail'>('idle')

  const isRefreshingRef = useRef(false)

  /**
   * Check if cache is stale (> 24h)
   */
  const isCacheStale = useCallback((timestamp: number): boolean => {
    if (timestamp === 0) return true
    return Date.now() - timestamp > MODEL_CACHE_TTL_MS
  }, [])

  /**
   * Get models synchronously - NEVER blocks UI
   * Priority: cached/fetched models → static manifest
   */
  const getModels = useCallback((): { name: string, displayName: string }[] => {
    return suggestedModels.length > 0 ? suggestedModels : (SUPPORTED_MODELS[providerName] || SUPPORTED_MODELS.gemini)
  }, [suggestedModels, providerName])

  /**
   * Background refresh - non-blocking, updates cache silently
   */
  const refreshModelsInBackground = useCallback(async (key: string) => {
    if (isRefreshingRef.current || !key) return
    
    isRefreshingRef.current = true
    try {
      // Use Service's silent warmCache method
      await ModelService.warmCache(providerName, key)
      
      // Get refreshed models (will return from cache if just updated)
      const result = await ModelService.getModels(providerName, key, false)
      if (result.success && result.models.length > 0) {
        setSuggestedModels(result.models)
        setCacheTimestamp(Date.now())
      }
    } catch (e) {
      // Silent fail for background refresh - don't disrupt UI
      console.warn('[SWR] Background model refresh failed:', e)
    } finally {
      isRefreshingRef.current = false
    }
  }, [providerName])

  const loadSettings = useCallback(() => {
    emit<LoadSettingsHandler>('LOAD_SETTINGS')
  }, [])

  const persistSettings = useCallback((next: {
    apiKey: string;
    apiKeys: ApiKeyMap;
    modelName: string;
    providerName: 'gemini' | 'openrouter';
  }) => {
    emit<SaveSettingsHandler>('SAVE_SETTINGS', {
      apiKey: next.apiKey,
      apiKeys: next.apiKeys,
      modelName: next.modelName,
      providerName: next.providerName,
      availableModels: suggestedModels,
      cacheTimestamp
    })
  }, [suggestedModels, cacheTimestamp])

  /**
   * Listen for settings updates
   * Re-binds when dependencies change (like refreshModelsInBackground)
   */
  useEffect(() => {
    return on<SettingsLoadedHandler>('SETTINGS_LOADED', (s) => {
      const nextProvider = s.providerName || 'gemini'
      const nextApiKeys: ApiKeyMap = {
        gemini: s.apiKeys?.gemini || '',
        openrouter: s.apiKeys?.openrouter || '',
      }

      // Legacy single key support
      if (!s.apiKeys && s.apiKey) {
        nextApiKeys[nextProvider] = s.apiKey
      }

      const activeKey = nextProvider === 'openrouter' ? nextApiKeys.openrouter : nextApiKeys.gemini
      const hasAnyKey = Boolean(nextApiKeys.gemini || nextApiKeys.openrouter || s.apiKey)

      setApiKeys(nextApiKeys)

      // Force-sync empty state after reset even when already initialized
      if (!isInitialized || !hasAnyKey) {
        setProviderName(nextProvider)
        setApiKey(activeKey || '')
        setHasConfig(Boolean(activeKey))
        setShowSettings(false)
        setSettingsError(null)
        setFetchStatus('idle')
      }

      if (!isInitialized && s.modelName) {
        setModelName(s.modelName)
      } else if (!hasAnyKey) {
        setModelName(DEFAULT_MODEL)
      }

      if (s.availableModels && s.availableModels.length > 0) {
        setSuggestedModels(s.availableModels)
      } else if (!hasAnyKey) {
        setSuggestedModels(ModelService.getStaticModels(nextProvider))
      }

      if (s.cacheTimestamp) {
        setCacheTimestamp(s.cacheTimestamp)
      } else if (!hasAnyKey) {
        setCacheTimestamp(0)
      }
      
      // SWR: Trigger background refresh if cache is stale and we have an API key
      if (activeKey && isCacheStale(s.cacheTimestamp || 0)) {
        // Delay slightly to not block initial render
        setTimeout(() => refreshModelsInBackground(activeKey), 100)
      }
      
      setIsInitialized(true)
    })
  }, [isCacheStale, refreshModelsInBackground, isInitialized])

  /**
   * Initial Load Trigger
   * Only runs once on mount
   */
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  /**
   * Sync active apiKey when providerName changes
   */
  useEffect(() => {
    const activeKey = providerName === 'openrouter' ? apiKeys.openrouter : apiKeys.gemini;
    setApiKey(activeKey || '');
    
    // [FIX] Show static models first when switching providers to prevent flicker
    const staticModels = ModelService.getStaticModels(providerName);
    setSuggestedModels(staticModels); 
    setFetchStatus('idle');
    setSettingsError(null);

    // Trigger background refresh for the new provider
    if (activeKey) {
      refreshModelsInBackground(activeKey);
    }
  }, [providerName, refreshModelsInBackground]);

  /**
   * Update specific provider key
   */
  const updateApiKey = (key: string) => {
    setApiKey(key);
    setApiKeys(prev => ({
      ...prev,
      [providerName]: key
    }));
  };

  const handleSaveSettings = () => {
    persistSettings({
      apiKey,
      apiKeys,
      modelName,
      providerName
    })
    // FIX: hasConfig based on whether active key is non-empty
    const activeKey = providerName === 'openrouter' ? apiKeys.openrouter : apiKeys.gemini
    setHasConfig(Boolean(activeKey))
    setShowSettings(false)
  }

  const completeOnboarding = useCallback((key: string) => {
    const nextApiKeys: ApiKeyMap = {
      ...apiKeys,
      [providerName]: key,
    }
    setApiKey(key)
    setApiKeys(nextApiKeys)
    setHasConfig(true)
    setShowSettings(false)
    persistSettings({
      apiKey: key,
      apiKeys: nextApiKeys,
      modelName,
      providerName,
    })
    toast('Connected successfully', 'success')
  }, [apiKeys, modelName, persistSettings, providerName, toast])

  /**
   * Explicit model fetch - used during onboarding/settings
   * Shows loading state (unlike background refresh)
   */
  const handleFetchModels = async (keyOverride?: string) => {
    const keyToUse = keyOverride || apiKeys[providerName] || apiKey;
    setFetchStatus('fetching')
    
    try {
      const result = await ModelService.getModels(providerName, keyToUse, true)
      
      if (result.success) {
        setSuggestedModels(result.models)
        setCacheTimestamp(Date.now())
        setFetchStatus('success')
        
        // Auto-select model if current one is not in the list
        if (result.models.length > 0 && !result.models.find(m => m.name === modelName)) {
          setModelName(result.models[0].name)
        }
      } else {
        // Fallback models are already in result.models if success is false
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

  /** Clear all stored keys and return to onboarding. */
  const logout = useCallback(() => {
    emit<ResetSettingsHandler>('RESET_SETTINGS')
    toast('Logged out', 'default')
  }, [toast])

  const restoreSavedSession = useCallback(() => {
    setIsInitialized(false)
    setSettingsError(null)
    setFetchStatus('idle')
    loadSettings()
    toast('Restored saved session', 'success')
  }, [loadSettings, toast])

  return {
    apiKey,
    setApiKey: updateApiKey,
    apiKeys,
    setApiKeys,
    modelName,
    setModelName,
    providerName,
    setProviderName: (name: 'gemini' | 'openrouter') => setProviderName(name),
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
    isCacheStale: isCacheStale(cacheTimestamp),
    logout,
    restoreSavedSession,
  }
}
