import { useState, useEffect } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  GetVariablesHandler,
  SendVariablesHandler,
  LibraryResource,
  LocalComponent,
  GetLocalComponentsHandler,
  SendLocalComponentsHandler,
  SendLogHandler,
} from '../types'

export interface PluginData {
  variables: string[]
  libraryResources: LibraryResource[]
  localComponents: LocalComponent[]
  editorMode: 'figma' | 'dev'
}

export function usePluginData() {
  const [variables, setVariables] = useState<string[]>([])
  const [libraryResources, setLibraryResources] = useState<LibraryResource[]>([])
  const [localComponents, setLocalComponents] = useState<LocalComponent[]>([])
  const [editorMode, setEditorMode] = useState<'figma' | 'dev'>('figma')

  useEffect(() => {
    const stopVars = on<SendVariablesHandler>('SEND_VARIABLES', (data) => setVariables(data.names))
    const stopLibrary = on('SEND_LIBRARY_RESOURCES', (data: { resources: LibraryResource[] }) => setLibraryResources(data.resources))

    const stopComponents = on<SendLocalComponentsHandler>('SEND_LOCAL_COMPONENTS', (data) => setLocalComponents(data.components))
    const stopLog = on<SendLogHandler>('SEND_LOG', (data) => {
        const prefix = data.type === 'warn' ? '⚠️' : data.type === 'success' ? '✅' : 'ℹ️';
        console.log(`[Plugin Log] ${prefix} ${data.message}`);
    });

    const stopEditorMode = on('SET_EDITOR_MODE', (data: { editorType: 'figma' | 'dev' }) => {
      setEditorMode(data.editorType);
    });

    emit<GetVariablesHandler>('GET_VARIABLES')
    emit('GET_LIBRARY_RESOURCES')
    emit<GetLocalComponentsHandler>('GET_LOCAL_COMPONENTS')

    return () => {
      stopVars()
      stopLibrary()
      stopComponents()
      stopLog()
      stopEditorMode()
    }
  }, [])

  return {
    variables,
    libraryResources,
    localComponents,
    editorMode
  }
}
