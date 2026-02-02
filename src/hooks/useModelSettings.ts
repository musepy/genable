import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler,
} from '../types'
import { fetchModels } from '../engine/llm-client'
import { DEFAULT_MODEL, SUPPORTED_MODELS, MODEL_CACHE_TTL_MS } from '../ui/constants/models'
import { useToast } from '../ui/components/ui'

/**
 * Model Settings Hook with SWR (Stale-While-Revalidate) Pattern
 * 
 * Key Design:
 * 1. getModels() - Always returns models instantly (cache → static fallback)
 * 2. Background refresh when cache > 24h stale
 * 3. Auto-refresh on API key change
 */
export function useModelSettings() {
  const { toast } = useToast()
  
  const [apiKey, setApiKey] = useState<string>('')
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({ gemini: '', openrouter: '' })
  const [modelName, setModelName] = useState<string>(DEFAULT_MODEL)
  const [providerName, setProviderName] = useState<'gemini' | 'openrouter'>('gemini')
  const [suggestedModels, setSuggestedModels] = useState<{ name: string, displayName: string }[]>([])
  const [cacheTimestamp, setCacheTimestamp] = useState<number>(0)
  
  const [hasConfig, setHasConfig] = useState<boolean>(false)
  const [isInitialized, setIsInitialized] = useState<boolean>(false)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'success' | 'fail'>('idle')
  
  // Track if background refresh is in progress
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
      const ms = await fetchModels(providerName, key)
      if (ms.length > 0) {
        setSuggestedModels(ms)
        setCacheTimestamp(Date.now())
        // Persist to storage (will be saved on next handleSaveSettings)
      }
    } catch (e) {
      // Silent fail for background refresh - don't disrupt UI
      console.warn('[SWR] Background model refresh failed:', e)
    } finally {
      isRefreshingRef.current = false
    }
  }, [providerName])

  /**
   * Listen for settings updates
   * Re-binds when dependencies change (like refreshModelsInBackground)
   */
  useEffect(() => {
    return on<SettingsLoadedHandler>('SETTINGS_LOADED', (s) => {
      // 1. Update Keys
      if (s.apiKeys) {
        setApiKeys(s.apiKeys)
        // Only set apiKey if we don't have one or if we're initializing
        // This prevents overwriting user input during a refresh
        if (!isInitialized) {
          const initialKey = s.providerName === 'openrouter' ? s.apiKeys.openrouter : s.apiKeys.gemini;
          setApiKey(initialKey || s.apiKey || '')
          setHasConfig(!!(initialKey || s.apiKey))
        }
      } else if (s.apiKey) {
        // Legacy single key support
        if (!isInitialized) {
          setApiKey(s.apiKey)
          setHasConfig(true)
        }
        setApiKeys(prev => ({ ...prev, [s.providerName || 'gemini']: s.apiKey }))
      } else {
        setShowSettings(true)
      }

      // 2. Update Model/Provider if not user-initiated
      // Only sync these on initial load to avoid overwriting user selection
      if (!isInitialized) {
        if (s.modelName) setModelName(s.modelName)
        if (s.providerName) setProviderName(s.providerName)
      }

      if (s.availableModels && s.availableModels.length > 0) {
        setSuggestedModels(s.availableModels)
      }
      if (s.cacheTimestamp) {
        setCacheTimestamp(s.cacheTimestamp)
      }
      
      // SWR: Trigger background refresh if cache is stale and we have an API key
      if (s.apiKey && isCacheStale(s.cacheTimestamp || 0)) {
        // Delay slightly to not block initial render
        setTimeout(() => refreshModelsInBackground(s.apiKey), 100)
      }
      
      setIsInitialized(true)
    })
  }, [isCacheStale, refreshModelsInBackground, isInitialized])

  /**
   * Initial Load Trigger
   * Only runs once on mount
   */
  useEffect(() => {
    emit<LoadSettingsHandler>('LOAD_SETTINGS')
  }, [])

  /**
   * Sync active apiKey when providerName changes
   */
  useEffect(() => {
    const activeKey = providerName === 'openrouter' ? apiKeys.openrouter : apiKeys.gemini;
    setApiKey(activeKey || '');
    
    // [FIX] Reset state when switching providers to prevent stale models (Coupling Fix)
    setSuggestedModels([]); 
    setFetchStatus('idle');
    setSettingsError(null);
  }, [providerName]); // Removed apiKeys from deps to avoid resetting on key type interaction, only on provider switch

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
    emit<SaveSettingsHandler>('SAVE_SETTINGS', { 
      apiKey, 
      apiKeys,
      modelName, 
      providerName,
      availableModels: suggestedModels,
      cacheTimestamp 
    })
    setHasConfig(true)
    setShowSettings(false)
    toast('Settings saved successfully', 'success')
  }

  /**
   * Explicit model fetch - used during onboarding/settings
   * Shows loading state (unlike background refresh)
   */
  const handleFetchModels = async (keyOverride?: string) => {
    // [FIX] Resolve key from map if not overridden, ensuring match with providerName
    // This prevents race condition where providerName updates but apiKey state is stale
    const keyToUse = keyOverride || apiKeys[providerName] || apiKey;
    setFetchStatus('fetching')
    try {
      const ms = await fetchModels(providerName, keyToUse)
      setSuggestedModels(ms)
      setCacheTimestamp(Date.now())
      setFetchStatus('success')
      
      // If current model is not in the fetched list, auto-select the best one
      if (ms.length > 0 && !ms.find(m => m.name === modelName)) {
        setModelName(ms[0].name)
      }
    } catch (e: unknown) {
      setFetchStatus('fail')
      setSettingsError(e instanceof Error ? e.message : 'Unknown error')
      throw e // Re-throw for OnboardingView to catch
    }
  }

  return {
    apiKey,
    setApiKey: updateApiKey,
    apiKeys,
    setApiKeys,
    modelName,
    setModelName,
    providerName,
    setProviderName: (name: 'gemini' | 'openrouter') => {
      console.log('[useModelSettings] setProviderName called with:', name);
      setProviderName(name);
    },
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
    handleFetchModels,
    // New SWR additions
    getModels,
    refreshModelsInBackground,
    isCacheStale: isCacheStale(cacheTimestamp),
  }
}
