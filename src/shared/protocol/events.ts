/**
 * @file events.ts
 * @description Standardized event names for communication between UI and Figma Engine.
 */

export const PLUGIN_EVENTS = {
  // Layer Creation
  CREATE_LAYERS: 'CREATE_LAYERS',
  
  // Streaming
  STREAM_LAYERS: 'STREAM_LAYERS',
  CLEAR_STREAM: 'CLEAR_STREAM',
  
  // State Updates
  SET_LOADING: 'SET_LOADING',
  NOTIFY_ERROR: 'NOTIFY_ERROR',
  
  // Feedback & Operations
  UNDO: 'UNDO',
  RETRY: 'RETRY'
} as const;

export type PluginEvent = keyof typeof PLUGIN_EVENTS;
