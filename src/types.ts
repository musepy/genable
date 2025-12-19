import { EventHandler } from '@create-figma-plugin/utilities'
import { NodeLayer } from './schema'

// Re-export the schema type as LayerDSL for compatibility
export type LayerDSL = NodeLayer;

export interface Settings {
  apiKey: string;
  modelName: string;
}

export interface SelectionStyles {
  colors: string[];
  fonts: string[];
  cornerRadius: number[];
  // Context: The layout structure of the user's selection (if any)
  referenceLayout?: {
    width: number;
    height: number;
    layoutMode: 'VERTICAL' | 'HORIZONTAL' | 'NONE';
    itemSpacing?: number;
    padding?: { top: number; right: number; bottom: number; left: number };
  };
}

export interface CreateLayersHandler extends EventHandler {
  name: 'CREATE_LAYERS';
  handler: (data: LayerDSL) => void;
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
