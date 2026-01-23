import { render, VerticalSpace } from '@create-figma-plugin/ui'
import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'

// Hooks
import { usePluginData } from './hooks/usePluginData'
import { useModelSettings } from './hooks/useModelSettings'

// Features
import { ChatFeature } from './features/chat'
import { SettingsPanel } from './ui/SettingsPanel'
import { OnboardingView } from './ui/components/OnboardingView'

// Global UI Layout & Styles
import { Header } from './ui/components/Header'
import { Iso } from './ui/components/layout/Iso'
import { Stack } from './ui/components/layout/Stack'
import { tokens } from './ui/design-system/tokens'
import { cssTokens } from './ui/design-system/tokens/css'
import { thinkingStreamCss } from './ui/components/ThinkingStream'
import { ToastProvider } from './ui/components/ui'

// Global Styles
const containerStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: tokens.colors.bg1, // Migrated from colors.background
  color: tokens.colors.textPrimary, // Migrated from colors.foreground
  boxSizing: 'border-box',
  overflow: 'hidden', // Prevent scroll on main container
}

const mainContentStyle: h.JSX.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: `0 ${tokens.space[4]}px`,
  scrollBehavior: 'smooth',
  paddingBottom: tokens.space[6],
  position: 'relative',
  isolation: 'isolate',
  // Note: Removed mask-image as it was clipping content at top/bottom edges
}

function PluginContent() {
  // 1. Global Plugin Data (Subscriptions)
  const pluginData = usePluginData()
  
  // 2. Settings & Auth
  const settings = useModelSettings()
  const { 
    apiKey, setApiKey, modelName, setModelName, 
    suggestedModels, fetchStatus, settingsError,
    hasConfig, setHasConfig, isInitialized, showSettings, setShowSettings,
    handleSaveSettings, handleFetchModels
  } = settings

  // Key for remounting ChatFeature (replaces window.location.reload)
  const [chatKey, setChatKey] = useState(0)

  // 3. Theme State
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')

  // Inject CSS
  useEffect(() => {
    const styleEl = document.createElement('style')
    styleEl.textContent = cssTokens + thinkingStreamCss
    document.head.appendChild(styleEl)
    return () => { document.head.removeChild(styleEl) }
  }, [])

  // Theme Sync
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  // 4. Router / Switcher
  const renderContent = () => {
    // 0. Wait for initialization (prevents flash)
    if (!isInitialized) {
      return null // Or <LoadingSpinner /> if desired
    }
    
    // A. Settings View
    if (showSettings) {
      return (
        <Iso style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SettingsPanel
            apiKey={apiKey}
            setApiKey={setApiKey}
            modelName={modelName}
            setModelName={setModelName}
            suggestedModels={suggestedModels}
            fetchStatus={fetchStatus}
            settingsError={settingsError}
            onFetchModels={() => handleFetchModels()}
            onSave={handleSaveSettings}
            onClose={() => setShowSettings(false)}
            localComponents={pluginData.localComponents}
          />
        </Iso>
      )
    }

    // B. Onboarding View
    if (!hasConfig) {
      return (
        <Iso style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <OnboardingView
            onComplete={(key) => {
              setApiKey(key);
              setHasConfig(true);
              handleSaveSettings(); // Will save with current state
            }}
            onFetchModels={(key) => handleFetchModels(key)}
            isLoading={fetchStatus === 'fetching'}
            error={settingsError}
          />
        </Iso>
      )
    }

    // C. Chat Feature (Main)
    return (
      <Iso style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={mainContentStyle}>
          <ChatFeature
            key={chatKey} // Remount on New Chat click
            apiKey={apiKey}
            modelName={modelName}
            pluginData={pluginData}
            setModelName={setModelName}
            setApiKey={setApiKey}
            suggestedModels={suggestedModels}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>
      </Iso>
    )
  }

  return (
    <div style={containerStyle}>
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        onNewChat={() => {
          // Fix: Increment key to remount ChatFeature (clean reset without page reload)
          setChatKey(k => k + 1)
        }}
        newChatVisible={hasConfig && !showSettings}
        newChatEnabled={true}
        onSettingsClick={() => setShowSettings(true)}
      />
      
      {renderContent()}
    </div>
  )
}

function Plugin() {
  return (
    <ToastProvider>
      <PluginContent />
    </ToastProvider>
  )
}

export default render(Plugin)
