import { EventHandler } from '@create-figma-plugin/utilities'
import { NodeLayer } from './schema/layerSchema'

export type { NodeLayer };

export interface Settings {
  apiKey: string; // Active/Default key for backward compatibility
  apiKeys?: Record<string, string>; // [NEW] Map of provider -> key
  modelName: string;
  providerName?: 'gemini' | 'openrouter' | 'dashscope';
  availableModels?: { name: string; displayName: string }[];
  /** Timestamp when models were last fetched (for SWR cache) */
  cacheTimestamp?: number;
}

export interface CreateLayersHandler extends EventHandler {
  name: 'CREATE_LAYERS';
  handler: (data: NodeLayer & { 
    designSystemId?: string; 
    __traceId?: string;
    renderContext?: {
      width: number;
      height: number;
      isMobile: boolean;
    };
    meta?: {
      replaceStreamSessionId?: string;
    };
  }) => void;
}

export interface StreamLayersHandler extends EventHandler {
  name: 'STREAM_LAYERS';
  handler: (data: NodeLayer & { 
    designSystemId?: string; 
    streamSessionId: string;
    renderContext?: {
      width: number;
      height: number;
      isMobile: boolean;
    };
  }) => void;
}

export interface ClearStreamHandler extends EventHandler {
  name: 'CLEAR_STREAM';
  handler: (data: { streamSessionId: string }) => void;
}

export interface CloseHandler extends EventHandler {
  name: 'CLOSE';
  handler: () => void;
}

export interface GetVariablesHandler extends EventHandler {
  name: 'GET_VARIABLES';
  handler: () => void;
}

export interface SendVariablesHandler extends EventHandler {
  name: 'SEND_VARIABLES';
  handler: (data: { names: string[] }) => void;
}


export interface LoadSettingsHandler extends EventHandler {
  name: 'LOAD_SETTINGS';
  handler: () => void;
}

export interface SaveSettingsHandler extends EventHandler {
  name: 'SAVE_SETTINGS';
  handler: (settings: Settings) => void;
}

export interface ResetSettingsHandler extends EventHandler {
  name: 'RESET_SETTINGS';
  handler: () => void;
}

export interface SettingsLoadedHandler extends EventHandler {
  name: 'SETTINGS_LOADED';
  handler: (settings: Settings) => void;
}

export interface SendLogHandler extends EventHandler {
  name: 'SEND_LOG';
  handler: (data: { message: string, type: 'info' | 'success' | 'warn' | 'ai' }) => void;
}

export interface LibraryAuditHandler extends EventHandler {
  name: 'LIBRARY_AUDIT';
  handler: () => void;
}

export interface SendLibraryAuditHandler extends EventHandler {
  name: 'SEND_LIBRARY_AUDIT';
  handler: (data: {
    summary: string,
    details: { libraryName: string, count: number, types: string[] }[]
  }) => void;
}

export interface RenderTestResultsHandler extends EventHandler {
  name: 'RENDER_TEST_RESULTS';
  handler: (data: {
    layers: NodeLayer[],
    variant: string,
    iteration: number
  }) => void;
}

export interface LocalComponent {
  key: string;
  name: string;
  description: string;
  type: 'COMPONENT' | 'COMPONENT_SET';
  variantMap?: Record<string, string[]>;
  isLibrary?: boolean;  // true if from team library
}

export interface GetLocalComponentsHandler extends EventHandler {
  name: 'GET_LOCAL_COMPONENTS';
  handler: () => void;
}

export interface SendLocalComponentsHandler extends EventHandler {
  name: 'SEND_LOCAL_COMPONENTS';
  handler: (data: { components: LocalComponent[] }) => void;
}


export interface ImportJsonHandler extends EventHandler {
  name: 'IMPORT_JSON';
  handler: (data: { jsonString: string }) => void;
}

export interface CombineVariantsHandler extends EventHandler {
  name: 'COMBINE_VARIANTS';
  handler: (data: { prefix: string }) => void;
}

export interface GetSnapshotHistoryHandler extends EventHandler {
  name: 'GET_SNAPSHOT_HISTORY';
  handler: () => void;
}

export interface SendSnapshotHistoryHandler extends EventHandler {
  name: 'SEND_SNAPSHOT_HISTORY';
  handler: (data: { history: any[] }) => void;
}

// Dogfooding: Figma to Code Serialization
export interface SerializeSelectionHandler extends EventHandler {
  name: 'SERIALIZE_SELECTION';
  handler: () => void;
}

export interface SendSerializedSelectionHandler extends EventHandler {
  name: 'SEND_SERIALIZED_SELECTION';
  handler: (data: { jsonString: string }) => void;
}

export interface SelectNodeHandler extends EventHandler {
  name: 'SELECT_NODE';
  handler: (data: { nodeId: string; smooth?: boolean; durationMs?: number }) => void;
}

export interface GetSelectionHandler extends EventHandler {
  name: 'GET_SELECTION';
  handler: () => void;
}

export interface SendSelectionHandler extends EventHandler {
  name: 'SEND_SELECTION';
  handler: (data: { selection: Array<{ id: string; name: string; type: string }> }) => void;
}

export interface ImportTokensHandler extends EventHandler {
  name: 'IMPORT_TOKENS';
  handler: (data: { cssString: string, jsonString?: string }) => void;
}

export interface ExportTokensHandler extends EventHandler {
  name: 'EXPORT_TOKENS';
  handler: () => void;
}

export interface SendExportedTokensHandler extends EventHandler {
  name: 'SEND_EXPORTED_TOKENS';
  handler: (data: { tokens: any }) => void;
}

export interface ResizeHandler extends EventHandler {
  name: 'RESIZE';
  handler: (data: { height: number }) => void;
}

// ==========================================
// Level 1.2: Agentic IPC Bridge
// ==========================================

export interface ToolCallHandler extends EventHandler {
  name: 'TOOL_CALL';
  handler: (data: {
    toolName: string,
    parameters: any,
    context?: import('./engine/agent/tools/types').ToolContext,
    requestId: string
  }) => void;
}

export interface ToolResultHandler extends EventHandler {
  name: 'TOOL_RESULT';
  handler: (data: {
    requestId: string,
    response: import('./engine/agent/tools/types').ToolResponse
  }) => void;
}

// ==========================================
// Dev Bridge: Node Tree + Screenshot Export
// ==========================================

export interface DevBridgeExportHandler extends EventHandler {
  name: 'DEV_BRIDGE_EXPORT';
  handler: (data: { rootNodeIds?: string[] }) => void;
}

export interface DevBridgeExportResultHandler extends EventHandler {
  name: 'DEV_BRIDGE_EXPORT_RESULT';
  handler: (data: {
    nodeTree: any;
    screenshots: Array<{ nodeId: string; name: string; base64: string }>; // per-root-node screenshots
  }) => void;
}

// ==========================================
// Level 2: Automated Fidelity Capture
// ==========================================

/**
 * Interface for components that can self-serialize to Figma DSL
 */
export interface ISerializableComponent {
  toNodeLayer(): Promise<NodeLayer>;
}

/**
 * Result of a DOM capture operation
 */
export interface CaptureResult {
  success: boolean;
  layers: NodeLayer[];
  error?: string;
}

export interface CaptureUIHandler extends EventHandler {
  name: 'CAPTURE_UI';
  handler: (data: { componentId: string }) => void;
}

export interface SendCapturedUIHandler extends EventHandler {
  name: 'SEND_CAPTURED_UI';
  handler: (data: { 
    templateId: string;
    layers: NodeLayer[];
  }) => void;
}

// ==========================================
// Additional Types for Type Safety
// ==========================================

/** Audit report structure from library scan */
export interface AuditReport {
  summary: string;
  details: { libraryName: string; count: number; types: string[] }[];
}

/** Log entry for UI display */
export interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'warn' | 'ai';
}

/** Modify mode payload extension */
export interface ModifyModePayload {
  __modifyMode?: boolean;
  __modifyTargetId?: string;
}

/** Reference context for pattern analysis */
export interface ReferenceContext {
  type: string;
  props: {
    name?: string;
    content?: string;
    [key: string]: unknown;
  };
  children?: ReferenceContext[];
}
