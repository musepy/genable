/**
 * @file DeveloperPanel.tsx
 * @description Developer-only panel for synchronization and dogfooding tools.
 */

import { h } from 'preact';
import { emit, on } from '@create-figma-plugin/utilities';
import { tokens } from '../design-system/tokens';
import { cssTokens } from '../design-system/tokens/css';
import { 
  ImportTokensHandler, 
  ExportTokensHandler, 
  SendExportedTokensHandler,
  SerializeSelectionHandler,
  SendSerializedSelectionHandler,
  CombineVariantsHandler,
  GetSnapshotHistoryHandler,
  SendSnapshotHistoryHandler,
  ProjectTemplate,
  GetProjectTemplatesHandler,
  SendProjectTemplatesHandler,
  ImportProjectTemplateHandler,
  CaptureUIHandler,
  ResetSettingsHandler
} from '../../types';
import { useEffect, useState } from 'preact/hooks';

const panelStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space[4],
  padding: tokens.space[4],
  background: tokens.colors.surface,
  border: `1px solid ${tokens.colors.grayBorder}`,
  borderRadius: 'var(--radius-4)',
  marginTop: tokens.space[4],
};

const buttonStyle: h.JSX.CSSProperties = {
  padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
  background: tokens.colors.surface,
  color: tokens.colors.textPrimary,
  border: `1px solid ${tokens.colors.grayBorder}`,
  borderRadius: 'var(--radius-3)',
  cursor: 'pointer',
  fontSize: tokens.fontSize[1],
  fontWeight: 500,
  textAlign: 'center',
  transition: 'var(--transition-crisp)',
};

const ghostButtonStyle: h.JSX.CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  border: `1px solid ${tokens.colors.grayBorder}`,
  color: tokens.colors.textSecondary,
};

const jsonTextareaHeight = tokens.space[9] + tokens.space[5] + tokens.space[3]; // 64 + 24 + 12 = 100

const jsonSectionStyle: h.JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: tokens.space[2],
};

const jsonTextareaStyle: h.JSX.CSSProperties = {
  width: '100%',
  height: jsonTextareaHeight,
  fontSize: tokens.fontSize[1],
  fontFamily: tokens.font.mono,
  padding: tokens.space[2],
  background: tokens.colors.background,
  color: tokens.colors.textPrimary,
  border: `1px solid ${tokens.colors.grayBorder}`,
  borderRadius: tokens.radii.sm,
  resize: 'vertical',
};

const jsonConfirmButtonStyle: h.JSX.CSSProperties = {
  ...buttonStyle,
  fontSize: tokens.fontSize[1],
  padding: `${tokens.space[1]}px ${tokens.space[2]}px`,
};

interface DeveloperPanelProps {
  onSimulateLogout?: () => void;
  onSimulateEmptyState?: () => void;
  onRestoreSession?: () => void;
}

export function DeveloperPanel({
  onSimulateLogout,
  onSimulateEmptyState,
  onRestoreSession
}: DeveloperPanelProps) {
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [showJsonInput, setShowJsonInput] = useState(false);
  const [jsonInput, setJsonInput] = useState('');

  useEffect(() => {
    const unexport = on<SendExportedTokensHandler>('SEND_EXPORTED_TOKENS', (data) => {
      console.log('[DeveloperPanel] Exported Tokens:', data.tokens);
      setLastExport(JSON.stringify(data.tokens, null, 2));
    });

    const unserialize = on<SendSerializedSelectionHandler>('SEND_SERIALIZED_SELECTION', (data) => {
      console.log('[DeveloperPanel] Serialized Selection:', data.jsonString);
      setLastExport(data.jsonString);
    });

    const unhistory = on<SendSnapshotHistoryHandler>('SEND_SNAPSHOT_HISTORY', (data) => {
      setHistory(data.history.reverse()); // Show latest first
    });

    const untemplates = on<SendProjectTemplatesHandler>('SEND_PROJECT_TEMPLATES', (data) => {
      setTemplates(data.templates);
    });

    // Initial fetch
    emit<GetSnapshotHistoryHandler>('GET_SNAPSHOT_HISTORY');
    emit<GetProjectTemplatesHandler>('GET_PROJECT_TEMPLATES');

    return () => {
      unexport();
      unserialize();
      unhistory();
      untemplates();
    };
  }, []);

  const handlePushTokens = () => {
    emit<ImportTokensHandler>('IMPORT_TOKENS', { cssString: cssTokens });
  };

  const handleImportJsonTokens = () => {
    if (jsonInput) {
      try {
        JSON.parse(jsonInput); // Validate first
        console.log('[DeveloperPanel] Emitting IMPORT_TOKENS with JSON');
        emit<ImportTokensHandler>('IMPORT_TOKENS', { cssString: '', jsonString: jsonInput });
        setJsonInput(''); // Clear after send
        setShowJsonInput(false);
      } catch (e) {
        alert('无效的 JSON 格式: ' + (e as any).message);
      }
    }
  };

  const handlePullTokens = () => {
    emit<ExportTokensHandler>('EXPORT_TOKENS');
  };

  const handleExportSelection = () => {
    emit<SerializeSelectionHandler>('SERIALIZE_SELECTION');
  };

  const handleCombineVariants = () => {
    const prefix = prompt('输入变体组前缀 (例如: Button):', 'Button');
    if (prefix) {
      emit<CombineVariantsHandler>('COMBINE_VARIANTS', { prefix });
    }
  };

  const handleImportTemplate = (templateId: string) => {
    emit<ImportProjectTemplateHandler>('IMPORT_PROJECT_TEMPLATE', { templateId });
  };

  const handleCaptureUI = (componentId: string) => {
    emit<CaptureUIHandler>('CAPTURE_UI', { componentId });
  };

  const handleResetSettings = () => {
    if (confirm('【危险】确认彻底清除所有设置？这将从插件存储中永久删除 API Keys。')) {
      emit<ResetSettingsHandler>('RESET_SETTINGS');
    }
  };

  const handleSimulateLogout = () => {
    console.log('[Dev] Simulating logout...');
    if (onSimulateLogout) onSimulateLogout();
  };

  const handleSimulateEmptyState = () => {
    console.log('[Dev] Simulating fresh user empty state...');
    if (onSimulateEmptyState) onSimulateEmptyState();
  };

  const handleRestoreSession = () => {
    console.log('[Dev] Restoring saved session...');
    if (onRestoreSession) onRestoreSession();
  };

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, fontSize: tokens.fontSize[2], marginBottom: -tokens.space[2], color: tokens.colors.textPrimary }}>
        开发者同步工具
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[2] }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.space[2] }}>
          <button style={buttonStyle} onClick={handlePushTokens}>
            推送 Code → Figma
          </button>
          <button style={ghostButtonStyle} onClick={handlePullTokens}>
            拉取 Figma → Code
          </button>
        </div>
        
        {/* JSON Import Section */}
        <div style={jsonSectionStyle}>
          <button style={ghostButtonStyle} onClick={() => setShowJsonInput(!showJsonInput)}>
              {showJsonInput ? '收起 Import' : '导入 JSON Tokens (DTCG)'}
          </button>
          
          {showJsonInput && (
            <div style={jsonSectionStyle}>
              <textarea
                placeholder="在此粘贴 Theme A.tokens.json 内容..."
                value={jsonInput}
                onInput={(e) => setJsonInput(e.currentTarget.value)}
                style={jsonTextareaStyle}
              />
              <button 
                style={jsonConfirmButtonStyle}
                onClick={handleImportJsonTokens}
                disabled={!jsonInput.trim()}
              >
                确认导入
              </button>
            </div>
          )}
        </div>
      </div>

      <button style={buttonStyle} onClick={handleExportSelection}>
        导出选中项为 Template
      </button>

      <button style={ghostButtonStyle} onClick={handleCombineVariants}>
        合并选中项为变体组 (Variants)
      </button>

      <button 
        style={{ ...buttonStyle, background: tokens.colors.accentAlpha[2], color: tokens.colors.accent, borderColor: tokens.colors.accentAlpha[4] }} 
        onClick={handleSimulateLogout}
      >
        模拟登出 (Simulate Sign Out)
      </button>

      <button
        style={{ ...buttonStyle, background: tokens.colors.grayMuted, color: tokens.colors.textPrimary }}
        onClick={handleSimulateEmptyState}
      >
        模拟新用户空态 (Keep Storage)
      </button>

      <button
        style={{ ...ghostButtonStyle, borderColor: tokens.colors.accentAlpha[5], color: tokens.colors.accent }}
        onClick={handleRestoreSession}
      >
        恢复已保存会话 (Reconnect Fast)
      </button>

      <button 
        style={{ ...buttonStyle, marginTop: tokens.space[2], opacity: 0.6, fontSize: tokens.fontSize[1], padding: '4px 8px', height: 'auto', background: 'transparent', color: tokens.colors.error, border: `1px solid ${tokens.colors.errorBorder}` }} 
        onClick={handleResetSettings}
      >
        彻底清空设置 (Factory Reset)
      </button>

      {/* Project UI Library Section */}
      <div style={{ marginTop: tokens.space[4] }}>
        <div style={{ fontSize: tokens.fontSize[1], fontWeight: 600, marginBottom: 8, color: tokens.colors.textPrimary, display: 'flex', alignItems: 'center', gap: 4 }}>
          项目 UI 库 (Dogfooding)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {templates.map(template => (
            <div key={template.id} style={{ 
              fontSize: tokens.fontSize[1], 
              padding: '8px 10px', 
              background: tokens.colors.surface, 
              border: `1px solid ${tokens.colors.grayBorder}`,
              borderRadius: 'var(--radius-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, color: tokens.colors.textPrimary }}>{template.name}</div>
                  <div style={{ color: tokens.colors.textSecondary, fontSize: tokens.fontSize[1], fontFamily: tokens.font.mono }}>{template.path}</div>
                </div>
                <div style={{ background: tokens.colors.accentMuted, color: tokens.colors.accent, padding: '2px 4px', borderRadius: 'var(--radius-1)', fontSize: tokens.fontSize[1] }}>
                  v{template.version}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button 
                  style={{ 
                    ...buttonStyle, 
                    padding: '4px 8px', 
                    fontSize: tokens.fontSize[1], 
                  }} 
                  onClick={() => handleImportTemplate(template.id)}
                >
                  标准导入
                </button>
                <button 
                  style={{ 
                    ...ghostButtonStyle, 
                    padding: '4px 8px', 
                    fontSize: tokens.fontSize[1],
                  }} 
                  onClick={() => handleCaptureUI(template.id)}
                >
                  实时抓取
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: tokens.space[2] }}>
          <div style={{ fontSize: tokens.fontSize[1], fontWeight: 600, marginBottom: 8, color: tokens.colors.textPrimary }}>
            版本快照历史
          </div>
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 6, 
            maxHeight: 150, 
            overflowY: 'auto',
            paddingRight: 4
          }}>
            {history.map((item: any, i: number) => (
              <div key={i} style={{ 
                fontSize: tokens.fontSize[1], 
                padding: '6px 8px', 
                background: tokens.colors.background, 
                border: `1px solid ${tokens.colors.grayBorder}`,
                borderRadius: 'var(--radius-1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: tokens.colors.textPrimary }}>{item.version}</div>
                  <div style={{ color: tokens.colors.textSecondary, fontSize: tokens.fontSize[1] }}>{item.message}</div>
                </div>
                <div style={{ color: tokens.colors.textSecondary, fontSize: tokens.fontSize[1] }}>
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastExport && (
        <div style={{ marginTop: tokens.space[2] }}>
          <div style={{ fontSize: tokens.fontSize[1], color: tokens.colors.textSecondary, marginBottom: 4 }}>
            最新导出结果 (可见于 Console):
          </div>
          <textarea 
            readOnly 
            style={{ 
              width: '100%', 
              height: '80px', 
              fontSize: tokens.fontSize[1], 
              fontFamily: 'monospace',
              background: tokens.colors.background,
              color: tokens.colors.textSecondary,
              border: `1px solid ${tokens.colors.grayBorder}`,
              borderRadius: 'var(--radius-1)',
              padding: '4px'
            }}
            value={lastExport}
          />
        </div>
      )}
    </div>
  );
}
