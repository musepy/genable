import './utils/compatibility'
import { render } from '@create-figma-plugin/ui'
import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'

// Hooks
import { usePluginData } from './hooks/usePluginData'
import { useModelSettings } from './hooks/useModelSettings'
import { useMcpBridge } from './dev/useMcpBridge'

// Features
import { ChatFeature } from './features/chat'
import { SettingsPanel } from './ui/SettingsPanel'
import { OnboardingView } from './ui/components/OnboardingView'
import { PromptInput } from './ui/components/PromptInput'

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

  // 2. Settings & Auth (V2 protocol-based)
  const settings = useModelSettings()
  const {
    locale, localePref, setLocalePref,
    theme, setTheme,
    // V2
    providers, activeProviderId, addProvider, updateProvider, removeProvider,
    setActiveProviderId, validateProvider, activeProvider,
    // Legacy derived (still needed for AgentOrchestrator + ModelPopover fallback)
    apiKey, modelName, setModelName, providerName,
    // Lifecycle
    hasConfig, isInitialized, showSettings, setShowSettings,
    logout,
  } = settings

  // Key for remounting ChatFeature (replaces window.location.reload)
  const [chatKey, setChatKey] = useState(0)

  // MCP bridge — single connection shared across the plugin. Lifted from
  // useChat so the WS relay stays connected regardless of which view is
  // active (Onboarding/Chat/Settings). Status returns are unused for now
  // (no UI consumer); the hook noops when not inside a Figma plugin iframe.
  useMcpBridge()

  // Dev bridge model switching — exposed via window global for cross-component access.
  // Updates the active provider's modelId. Provider switching by name is no longer
  // first-class (V2 routes by config id, not by legacy bucket).
  useEffect(() => {
    (window as any).__GENABLE_SWITCH_PROVIDER__ = (_provider: string, model: string) => {
      if (model) setModelName(model)
    }
    return () => { delete (window as any).__GENABLE_SWITCH_PROVIDER__ }
  }, [setModelName])

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
          providers={providers}
          activeProviderId={activeProviderId}
          addProvider={addProvider}
          updateProvider={updateProvider}
          removeProvider={removeProvider}
          setActiveProviderId={setActiveProviderId}
          validateProvider={validateProvider}
          onLogout={logout}
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

  // Dev-only: render OnboardingView without clearing storage. Lets developers
  // verify empty-state visuals while keeping API keys intact for SSE/E2E runs.
  // Toggle via window.previewEmptyState() in DevTools console; refresh resets.
  const [isPreviewingEmptyState, setIsPreviewingEmptyState] = useState(false)

  useEffect(() => {
    (window as any).previewEmptyState = () => {
      setIsPreviewingEmptyState(prev => {
        const next = !prev
        console.log('[dev] empty state preview:', next)
        return next
      })
    }
    return () => { delete (window as any).previewEmptyState }
  }, [])

  // 4. Router / Switcher
  const renderContent = () => {
    // 0. Wait for initialization (prevents flash)
    if (!isInitialized) {
      return null // Or <LoadingSpinner /> if desired
    }

    // A. Settings View moved to main render for overlay/animation

    // B. Onboarding View (real empty state OR dev preview)
    if (!hasConfig || isPreviewingEmptyState) {
      return (
        <Iso style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <OnboardingView
            addProvider={addProvider}
            validateProvider={validateProvider}
            onOpenSettings={() => setShowSettings(true)}
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
            providerName={providerName}
            providerConfig={activeProvider ?? undefined}
            pluginData={pluginData}
            setModelName={setModelName}
            suggestedModels={
              // Hand the active provider's probed model list to the popover.
              // ModelPopover falls back to its hardcoded SUPPORTED_MODELS when
              // this is empty (Anthropic protocol, fresh install before probe).
              (activeProvider?.availableModels ?? []).map(m => ({ name: m, displayName: m }))
            }
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
            providers={providers}
            activeProviderId={activeProviderId}
            addProvider={addProvider}
            updateProvider={updateProvider}
            removeProvider={removeProvider}
            setActiveProviderId={setActiveProviderId}
            validateProvider={validateProvider}
            onLogout={logout}
            onClose={() => {
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
