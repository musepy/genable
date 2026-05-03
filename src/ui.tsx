import './utils/compatibility'
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
import { PromptInput } from './ui/components/PromptInput'
import { DeveloperPanel } from './ui/components/DeveloperPanel'

// i18n
import { LocaleContext } from './ui/i18n'

// Global UI Layout & Styles
import { Header } from './ui/components/Header'
import { Iso } from './ui/components/layout/Iso'
import { tokens, cssTokens, globalStyles } from './ui/design-system/tokens'
// ThinkingStream CSS moved to globalStyles.ts
import { ToastProvider } from './ui/components/ui'
import uiRegistry from './generated/ui-registry.json'
import { on, emit } from '@create-figma-plugin/utilities'
import { CaptureUIHandler, SendCapturedUIHandler } from './types'
import { DomCapture } from './ui/utils/DomCapture'
import { TokenResolver } from './ui/utils/TokenResolver'
import { WINDOW_WIDTH, getIdealHeight } from './ui/constants/layout'
import { ResizeHandler } from './types'

// Global Styles
const containerStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: tokens.colors.background, // Migrated from colors.background
  color: tokens.colors.textPrimary, // Migrated from colors.foreground
  boxSizing: 'border-box',
  overflow: 'hidden', // Prevent scroll on main container
}

const mainContentStyle: h.JSX.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0, // CRITICAL for Flexbox shrinking
  position: 'relative',
}

function PluginContent() {
  // 1. Global Plugin Data (Subscriptions)
  const pluginData = usePluginData()
  
  // 2. Settings & Auth
  const settings = useModelSettings()
  const {
    locale, localePref, setLocalePref,
    theme, setTheme,
    apiKey, setApiKey, setApiKeyFor, apiKeys, modelName, setModelName,
    providerName, setProviderName,
    suggestedModels, fetchStatus, settingsError,
    hasConfig, isInitialized, showSettings, setShowSettings,
    handleSaveSettings, completeOnboarding, handleFetchModels,
    logout, restoreSavedSession
  } = settings

  // Key for remounting ChatFeature (replaces window.location.reload)
  const [chatKey, setChatKey] = useState(0)

  // Dev bridge model switching — exposed via window global for cross-component access
  useEffect(() => {
    (window as any).__GENABLE_SWITCH_PROVIDER__ = (provider: string, model: string) => {
      const validProviders = ['gemini', 'openrouter', 'dashscope'] as const
      if (validProviders.includes(provider as any)) {
        setProviderName(provider as any)
        setModelName(model)
      }
    }
    return () => { delete (window as any).__GENABLE_SWITCH_PROVIDER__ }
  }, [setProviderName, setModelName])

  // 3. UI Animation State (theme now persisted in useModelSettings)
  const [isSettingsClosing, setIsSettingsClosing] = useState(false)

  // Inject CSS
  useEffect(() => {
    const styleEl = document.createElement('style')
    styleEl.textContent = cssTokens + globalStyles
    document.head.appendChild(styleEl)
    return () => { document.head.removeChild(styleEl) }
  }, [])

  // Theme Sync — 'auto' follows system preference (no data-theme attr); 'light'/'dark' explicit
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
  }, [theme])

  // L2: Capture Orchestrator
  const [captureTarget, setCaptureTarget] = useState<string | null>(null);
  
  useEffect(() => {
    const uncapture = on<CaptureUIHandler>('CAPTURE_UI', async (data) => {
      console.log('[UI] Received CAPTURE_UI for:', data.componentId);
      
      // 1. Check Registry (High Fidelity Build-time Snapshot)
      const cached = (uiRegistry as any)[data.componentId] || (uiRegistry as any)[data.componentId.replace(/-/g, '')];
      if (cached && cached.layers) {
        console.log('[UI] Using Registry Snapshot for:', data.componentId);
        emit<SendCapturedUIHandler>('SEND_CAPTURED_UI', {
          templateId: data.componentId,
          layers: cached.layers
        });
        return;
      }

      // 2. Fallback to Sandbox (Fragile Runtime Capture)
      console.log('[UI] Fallback to Sandbox capture for:', data.componentId);
      setCaptureTarget(data.componentId);
      
      // Wait for mount
      setTimeout(async () => {
        const el = document.getElementById('capture-sandbox-content');
        if (el && el.firstElementChild) {
          TokenResolver.init();
          const layers = await DomCapture.captureElement(el.firstElementChild as HTMLElement);
          console.log('[UI] Captured Layers:', layers);
          emit<SendCapturedUIHandler>('SEND_CAPTURED_UI', {
            templateId: data.componentId,
            layers: [layers]
          });
        }
        setCaptureTarget(null);
      }, 300); // Give it time to render
    });

    return uncapture;
  }, []);

  // L3: Window Resize Recovery
  // When Figma compresses the plugin iframe (console drag, window resize),
  // it does NOT restore the iframe height automatically. We detect this
  // via window 'resize' event and request the ideal height back.
  useEffect(() => {
    const idealHeight = getIdealHeight();
    let compressed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      const h = window.innerHeight;
      if (h < idealHeight - 5) {
        compressed = true;
      }
      // When resize events stop (user stopped dragging), check if we need to restore
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (compressed) {
          emit<ResizeHandler>('RESIZE', { height: idealHeight });
          compressed = false;
        }
      }, 400);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, []);

  const renderCaptureSandbox = () => {
    if (!captureTarget) return null;

    let content = null;
    if (captureTarget === 'SettingsPanel' || captureTarget === 'settings-panel') {
      content = (
        <SettingsPanel
          apiKey={apiKey}
          setApiKey={setApiKey}
          apiKeys={apiKeys}
          setApiKeyFor={setApiKeyFor}
          modelName={modelName}
          setModelName={setModelName}
          providerName={providerName}
          setProviderName={setProviderName}
          suggestedModels={suggestedModels}
          fetchStatus={fetchStatus}
          settingsError={settingsError}
          onFetchModels={() => handleFetchModels()}
          onSave={handleSaveSettings}
          onLogout={logout}
          onRestoreSession={restoreSavedSession}
          localComponents={pluginData.localComponents}
          localePref={localePref}
          setLocalePref={setLocalePref}
          theme={theme}
          setTheme={setTheme}
        />
      );
    } else if (captureTarget === 'header') {
      content = (
        <Header 
          theme={theme} 
          onToggleTheme={() => {}} 
          onNewChat={() => {}} 
          onSettingsClick={() => {}} 
          newChatVisible={true} 
          newChatEnabled={true} 
        />
      );
    } else if (captureTarget === 'button') {
      content = <button className="chip">Capture Candidate</button>;
    } else if (captureTarget === 'developer-panel') {
      content = <DeveloperPanel onLogout={() => {}} onRestoreSession={() => {}} />;
    } else if (captureTarget === 'prompt-input') {
      content = (
        <PromptInput 
          onSubmit={() => {}} 
          loading={false} 
          value="" 
          onChange={() => {}} 
          canSubmit={true} 
        />
      );
    }
    // Add more components as needed

    return (
      <div id="capture-sandbox" style={{ 
        position: 'absolute', 
        left: -5000, 
        top: 0, 
        width: WINDOW_WIDTH, 
        opacity: 0,
        pointerEvents: 'none' 
      }}>
        <div id="capture-sandbox-content">
          {content}
        </div>
      </div>
    );
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  // L3: Dogfood Tools State
  const [showDeveloperTools, setShowDeveloperTools] = useState(false);
  
  useEffect(() => {
    (window as any).toggleDeveloperPanel = () => setShowDeveloperTools(prev => !prev);
  }, []);

  // 4. Router / Switcher
  const renderContent = () => {
    // 0. Wait for initialization (prevents flash)
    if (!isInitialized) {
      return null // Or <LoadingSpinner /> if desired
    }

    if (showDeveloperTools) {
      return (
        <Iso style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={mainContentStyle}>
            <DeveloperPanel
              onLogout={logout}
              onRestoreSession={restoreSavedSession}
            />
            <VerticalSpace space="large" />
            <button className="chip" onClick={() => setShowDeveloperTools(false)} style={{ width: '100%', justifyContent: 'center' }}>
              Back to Chat
            </button>
          </div>
        </Iso>
      );
    }
    
    // A. Settings View moved to main render for overlay/animation
    
    // B. Onboarding View
    if (!hasConfig) {
      return (
        <Iso style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <OnboardingView
            apiKey={apiKey}
            setApiKey={setApiKey}
            providerName={providerName}
            setProviderName={setProviderName}
            onComplete={completeOnboarding}
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
            providerName={providerName} // [NEW]
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
    <LocaleContext.Provider value={locale}>
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
        onSettingsClick={() => {
          if (showSettings) {
             handleSaveSettings();
             setIsSettingsClosing(true);
             setTimeout(() => {
               setShowSettings(false);
               setIsSettingsClosing(false);
             }, 200); // Unified 200ms for crisp feedback
          } else {
             setShowSettings(true);
          }
        }}
        isSettingsOpen={showSettings} // Keep X icon during closing
      />
      
      {renderContent()}

      {/* Settings Panel Overlay - Slide-in animation source */}
      {showSettings && (
        <div className={`settings-container ${isSettingsClosing ? 'is-closing' : ''}`}>
          <SettingsPanel
            apiKey={apiKey}
            setApiKey={setApiKey}
            apiKeys={apiKeys}
            setApiKeyFor={setApiKeyFor}
            modelName={modelName}
            setModelName={setModelName}
            providerName={providerName}
            setProviderName={setProviderName}
            suggestedModels={suggestedModels}
            fetchStatus={fetchStatus}
            settingsError={settingsError}
            onFetchModels={() => handleFetchModels()}
            onSave={handleSaveSettings}
            onLogout={logout}
            onRestoreSession={restoreSavedSession}
            onClose={() => {
              handleSaveSettings();
              setIsSettingsClosing(true);
              setTimeout(() => {
                setShowSettings(false);
                setIsSettingsClosing(false);
              }, 200);
            }}
            localComponents={pluginData.localComponents}
            localePref={localePref}
            setLocalePref={setLocalePref}
            theme={theme}
            setTheme={setTheme}
          />
        </div>
      )}

      {renderCaptureSandbox()}
    </div>
    </LocaleContext.Provider>
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
