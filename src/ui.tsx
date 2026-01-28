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
import { Button } from './ui/components/Button'
import { PromptInput } from './ui/components/PromptInput'
import { MessageRenderer } from './ui/components/MessageRenderer'
import { DeveloperPanel } from './ui/components/DeveloperPanel'

// Global UI Layout & Styles
import { Header } from './ui/components/Header'
import { Iso } from './ui/components/layout/Iso'
import { Stack } from './ui/components/layout/Stack'
import { tokens } from './ui/design-system/tokens'
import { cssTokens } from './ui/design-system/tokens/css'
import { thinkingStreamCss } from './ui/components/ThinkingStream'
import { ToastProvider } from './ui/components/ui'
import uiRegistry from './generated/ui-registry.json'
import { on, emit } from '@create-figma-plugin/utilities'
import { CaptureUIHandler, SendCapturedUIHandler } from './types'
import { DomCapture } from './ui/utils/DomCapture'
import { TokenResolver } from './ui/utils/TokenResolver'

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

  const renderCaptureSandbox = () => {
    if (!captureTarget) return null;

    let content = null;
    if (captureTarget === 'SettingsPanel' || captureTarget === 'settings-panel') {
      content = (
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
          localComponents={pluginData.localComponents}
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
      content = <Button>Capture Candidate</Button>;
    } else if (captureTarget === 'developer-panel') {
      content = <DeveloperPanel />;
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
    } else if (captureTarget === 'chat-message') {
      content = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MessageRenderer content="Hello!" />
          <MessageRenderer content="Hi there, I am Genable." />
        </div>
      );
    }
    // Add more components as needed

    return (
      <div id="capture-sandbox" style={{ 
        position: 'absolute', 
        left: -5000, 
        top: 0, 
        width: 340, 
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
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
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
            <DeveloperPanel />
            <VerticalSpace space="large" />
            <Button variant="secondary" fullWidth onClick={() => setShowDeveloperTools(false)}>
              Back to Chat
            </Button>
          </div>
        </Iso>
      );
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
      {renderCaptureSandbox()}
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
