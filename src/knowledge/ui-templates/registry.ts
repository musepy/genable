import { ProjectTemplate } from '../../types';
import HeaderTemplate from './components/Header.template.json';
import ChatMessageTemplate from './components/ChatMessage.template.json';
import PromptInputTemplate from './components/PromptInput.template.json';
import ButtonTemplate from './components/Button.template.json';
import SettingsPanelTemplate from './components/SettingsPanel.template.json';
import DeveloperPanelTemplate from './components/DeveloperPanel.template.json';

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'header',
    name: 'Header (顶部工具栏)',
    version: '1.0.0',
    path: 'src/ui/components/Header.tsx',
    data: HeaderTemplate as any
  },
  {
    id: 'button',
    name: 'Button (多状态变体)',
    version: '1.1.0',
    path: 'src/ui/components/Button.tsx',
    variants: [
      { name: 'Variant=Primary, State=Default', data: (ButtonTemplate as any).primary_default },
      { name: 'Variant=Primary, State=Loading', data: (ButtonTemplate as any).primary_loading },
      { name: 'Variant=Secondary, State=Default', data: (ButtonTemplate as any).secondary_default },
      { name: 'Variant=Ghost, State=Default', data: (ButtonTemplate as any).ghost_default }
    ]
  },
  {
    id: 'settings-panel',
    name: 'Settings (设置面板)',
    version: '1.0.0',
    path: 'src/ui/SettingsPanel.tsx',
    data: SettingsPanelTemplate as any
  },
  {
    id: 'developer-panel',
    name: 'Developer Tool (开发者工具)',
    version: '1.0.0',
    path: 'src/ui/components/DeveloperPanel.tsx',
    data: DeveloperPanelTemplate as any
  },
  {
    id: 'chat-message',
    name: 'Chat Message (聊天消息)',
    version: '1.0.0',
    path: 'src/ui/components/MessageRenderer.tsx',
    data: ChatMessageTemplate as any
  },
  {
    id: 'prompt-input',
    name: 'Prompt Input (输入框)',
    version: '1.0.0',
    path: 'src/ui/components/PromptInput.tsx',
    data: PromptInputTemplate as any
  }
];
