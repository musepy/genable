import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import { h, render } from 'preact';

/**
 * Headless UI Capture Script
 * This script runs in Node.js, renders components in JSDOM, 
 * and uses DomCapture to generate Figma-compatible NodeLayer JSON.
 */

async function main() {
  console.log('🚀 Starting Build-time UI Capture...');

  // 1. Setup JSDOM
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="capture-root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true
  });
  
  const { window } = dom;
  global.window = window as any;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement as any;
  global.Node = window.Node as any;
  
  // Use defineProperty for navigator as it might be read-only in some environments
  Object.defineProperty(global, 'navigator', {
    value: window.navigator,
    configurable: true,
    writable: true
  });

  // Mock RequestAnimationFrame for Preact/Motion
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);

  // 2. Load Tokens and Styles
  const { cssTokens } = require('../src/ui/design-system/tokens/css');
  const style = document.createElement('style');
  style.textContent = cssTokens;
  document.head.appendChild(style);

  // 3. Import Utilities (Needs to be after globals are set)
  const { DomCapture } = require('../src/ui/utils/DomCapture');
  const { TokenResolver } = require('../src/ui/utils/TokenResolver');

  // 4. Define Components to Capture
  // Importing real components from the project
  const { Header } = require('../src/ui/components/Header');
  const { OnboardingView } = require('../src/ui/components/OnboardingView');
  const { Button } = require('../src/ui/components/Button');
  const { PromptInput } = require('../src/ui/components/PromptInput');
  const { SettingsPanel } = require('../src/ui/SettingsPanel');
  const { MessageRenderer } = require('../src/ui/components/MessageRenderer');

  const registry: Record<string, any> = {};

  const componentsToCapture = [
    { 
      id: 'header', 
      name: 'Plugin Header', 
      render: () => h(Header, { 
        theme: 'light', 
        onToggleTheme: () => {}, 
        onNewChat: () => {}, 
        onSettingsClick: () => {}, 
        newChatVisible: true, 
        newChatEnabled: true 
      }) 
    },
    { 
      id: 'onboarding', 
      name: 'Onboarding View', 
      render: () => h(OnboardingView, { 
        onComplete: () => {}, 
        onFetchModels: () => {}, 
        isLoading: false 
      }) 
    },
    {
      id: 'button',
      name: 'Standard Button',
      render: () => h(Button, {}, 'Action Button')
    },
    {
      id: 'prompt-input',
      name: 'Prompt Input',
      render: () => h(PromptInput, {
        onSubmit: () => {},
        loading: false,
        value: '',
        onChange: () => {},
        canSubmit: true
      })
    },
    {
      id: 'settings-panel',
      name: 'Settings Panel',
      render: () => h(SettingsPanel, {
        apiKey: 'demo-key',
        setApiKey: () => {},
        modelName: 'gemini-pro',
        setModelName: () => {},
        suggestedModels: [],
        fetchStatus: 'idle',
        onFetchModels: () => {},
        onSave: () => {},
        localComponents: []
      })
    },
    {
      id: 'chat-message',
      name: 'Chat Message',
      render: () => h(MessageRenderer, {
        content: 'Hello, this is a captured message!',
        level: 'L1' // Use L1 for easier capture in JSDOM
      })
    }
  ];

  TokenResolver.init(document);

  for (const comp of componentsToCapture) {
    console.log(`📸 Capturing: ${comp.name}...`);
    const container = document.getElementById('capture-root')!;
    container.innerHTML = '';
    
    // Mount the component
    try {
      render(comp.render(), container);

      const element = container.firstElementChild as HTMLElement;
      if (!element) {
        console.warn(`⚠️ Warning: Component ${comp.name} rendered no root element.`);
        continue;
      }

      const layers = await DomCapture.captureElement(element);
      registry[comp.id] = {
        name: comp.name,
        layers: [layers],
        timestamp: new Date().toISOString()
      };
    } catch (e) {
      console.error(`❌ Failed to capture ${comp.name}:`, e);
    }
  }

  // 5. Save Registry
  const outputPath = path.join(__dirname, '../src/generated/ui-registry.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(registry, null, 2));

  console.log(`✅ UI Registry saved to ${outputPath}`);
}

main().catch(err => {
  console.error('❌ Capture Failed:', err);
  process.exit(1);
});
