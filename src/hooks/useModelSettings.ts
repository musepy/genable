import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler,
} from '../types'
import { fetchGeminiModels } from '../engine/llm-client'
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
  const [modelName, setModelName] = useState<string>(DEFAULT_MODEL)
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
    return suggestedModels.length > 0 ? suggestedModels : SUPPORTED_MODELS
  }, [suggestedModels])

  /**
   * Background refresh - non-blocking, updates cache silently
   */
  const refreshModelsInBackground = useCallback(async (key: string) => {
    if (isRefreshingRef.current || !key) return
    
    isRefreshingRef.current = true
    try {
      const ms = await fetchGeminiModels(key)
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
  }, [])

  useEffect(() => {
    const stopSettings = on<SettingsLoadedHandler>('SETTINGS_LOADED', (s) => {
      if (s.apiKey) {
        setApiKey(s.apiKey)
        setHasConfig(true)
      } else {
        setShowSettings(true)
      }
      if (s.modelName) setModelName(s.modelName)
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
    
    emit<LoadSettingsHandler>('LOAD_SETTINGS')
    
    return () => {
      stopSettings()
    }
  }, [isCacheStale, refreshModelsInBackground])

  const handleSaveSettings = () => {
    emit<SaveSettingsHandler>('SAVE_SETTINGS', { 
      apiKey, 
      modelName, 
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
    const keyToUse = keyOverride || apiKey
    setFetchStatus('fetching')
    try {
      const ms = await fetchGeminiModels(keyToUse)
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
    setApiKey,
    modelName,
    setModelName,
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
