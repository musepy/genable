import { EventHandler } from '@create-figma-plugin/utilities'
import { NodeLayer } from './schema/layerSchema'

export type { NodeLayer };

export interface Settings {
  apiKey: string; // Active/Default key for backward compatibility
  apiKeys?: Record<string, string>; // [NEW] Map of provider -> key
  modelName: string;
  providerName?: 'gemini' | 'openrouter';
  availableModels?: { name: string; displayName: string }[];
  /** Timestamp when models were last fetched (for SWR cache) */
  cacheTimestamp?: number;
}

export interface SelectionStyles {
  // Aggregate styles for legacy UI compatibility (Deprecated - favor selectionNodes)
  colors?: string[];
  fonts?: string[];
  cornerRadius?: number[];
  selectedName?: string; // For UI feedback
  // Context: The layout structure of the user's selection (if any)
  referenceLayout?: {
    width: number;
    height: number;
    layoutMode: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
    itemSpacing?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
  };
  // Detailed structure for LLM to learn patterns
  selectionNodes?: NodeLayer[];
}

export interface AnalyzePatternHandler extends EventHandler {
  name: 'ANALYZE_PATTERN';
  handler: () => void;
}

export interface SendAnalyzedPatternHandler extends EventHandler {
  name: 'SEND_ANALYZED_PATTERN';
  handler: (data: {
    nodes: NodeLayer[],
    dna: { colors: string[], fonts: string[], radii: number[], spacing: number[] },
    patternSummary?: string  // 新增: 模式识别摘要用于 LLM 上下文
  }) => void;
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

export interface GetLibraryResourcesHandler extends EventHandler {
  name: 'GET_LIBRARY_RESOURCES';
  handler: () => void;
}

export interface LibraryResource {
  key: string;
  name: string;
  type: 'STYLE' | 'COMPONENT' | 'VARIABLE';
  libraryName?: string;
  description?: string;
}

export interface SendLibraryResourcesHandler extends EventHandler {
  name: 'SEND_LIBRARY_RESOURCES';
  handler: (data: { resources: LibraryResource[] }) => void;
}

export interface GetSelectionStylesHandler extends EventHandler {
  name: 'GET_SELECTION_STYLES';
  handler: () => void;
}

export interface SendSelectionStylesHandler extends EventHandler {
  name: 'SEND_SELECTION_STYLES';
  handler: (styles: SelectionStyles) => void;
}

export interface LoadSettingsHandler extends EventHandler {
  name: 'LOAD_SETTINGS';
  handler: () => void;
}

export interface SaveSettingsHandler extends EventHandler {
  name: 'SAVE_SETTINGS';
  handler: (settings: Settings) => void;
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

export interface ProjectTemplate {
  id: string;
  name: string;
  version: string;
  path: string;
  data?: NodeLayer; // Legacy single-state support
  variants?: {      // New multi-state support
    name: string;   // e.g. "Variant=Primary, State=Default"
    data: NodeLayer;
  }[];
}

export interface GetProjectTemplatesHandler extends EventHandler {
  name: 'GET_PROJECT_TEMPLATES';
  handler: () => void;
}

export interface SendProjectTemplatesHandler extends EventHandler {
  name: 'SEND_PROJECT_TEMPLATES';
  handler: (data: { templates: ProjectTemplate[] }) => void;
}

export interface ImportProjectTemplateHandler extends EventHandler {
  name: 'IMPORT_PROJECT_TEMPLATE';
  handler: (data: { templateId: string }) => void;
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

export interface SelectNodeHandler extends EventHandler {
  name: 'SELECT_NODE';
  handler: (data: {
    nodeId: string;
    smooth?: boolean;   // default true
    durationMs?: number; // optional
  }) => void;
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
