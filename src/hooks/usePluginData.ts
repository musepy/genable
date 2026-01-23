import { useState, useEffect } from 'preact/hooks'
import { emit, on } from '@create-figma-plugin/utilities'
import {
  GetVariablesHandler,
  SendVariablesHandler,
  GetSelectionStylesHandler,
  SendSelectionStylesHandler,
  SelectionStyles,
  SendAnalyzedPatternHandler,
  LibraryResource,
  LocalComponent,
  GetLocalComponentsHandler,
  SendLocalComponentsHandler,
  SendLogHandler,
} from '../types'

import { NodeLayer } from '../schema/layerSchema'

export interface PluginData {
  variables: string[]
  libraryResources: LibraryResource[]
  localComponents: LocalComponent[]
  selectionStyles: SelectionStyles | null
  analyzedPattern: {
    type: string
    tokens: string[]
    layout: string
    spacing: number
    radius: number
  } | null

  patternSummary: string
}

export function usePluginData() {
  const [variables, setVariables] = useState<string[]>([])
  const [libraryResources, setLibraryResources] = useState<LibraryResource[]>([])
  const [localComponents, setLocalComponents] = useState<LocalComponent[]>([])
  const [selectionStyles, setSelectionStyles] = useState<SelectionStyles | null>(null)
  
  const [analyzedPattern, setAnalyzedPattern] = useState<{
    type: string;
    tokens: string[];
    layout: string;
    spacing: number;
    radius: number;
  } | null>(null)


  const [patternSummary, setPatternSummary] = useState<string>('')

  useEffect(() => {
    const stopVars = on<SendVariablesHandler>('SEND_VARIABLES', (data) => setVariables(data.names))
    const stopLibrary = on('SEND_LIBRARY_RESOURCES', (data: { resources: LibraryResource[] }) => setLibraryResources(data.resources))
    
    const stopStyles = on<SendSelectionStylesHandler>('SEND_SELECTION_STYLES', (styles) => {
      // Clear selection state if no elements selected
      if (!styles.selectionNodes || styles.selectionNodes.length === 0) {
        setSelectionStyles(null)
        setAnalyzedPattern(null)
      } else {
        setSelectionStyles(styles)
        setAnalyzedPattern(null)
      }
    })
    
    const stopAnalyzed = on<SendAnalyzedPatternHandler>('SEND_ANALYZED_PATTERN', (data) => {
      setSelectionStyles(prev => prev ? { ...prev, selectionNodes: data.nodes } : null)
      if (data.nodes?.[0]) {
        const p = data.nodes[0].props as NodeLayer['props']
        if (p) {
            setAnalyzedPattern({
              type: p.type || 'Component',
              tokens: data.dna.colors,
              layout: p.layout || 'NONE',
              spacing: data.dna.spacing[0] || 0,
              radius: data.dna.radii[0] || 0
            })
        }
      }
      if (data.patternSummary) {
        setPatternSummary(data.patternSummary)
      }
    })


    
    const stopComponents = on<SendLocalComponentsHandler>('SEND_LOCAL_COMPONENTS', (data) => setLocalComponents(data.components))
    const stopLog = on<SendLogHandler>('SEND_LOG', (data) => {
        const prefix = data.type === 'warn' ? '⚠️' : data.type === 'success' ? '✅' : 'ℹ️';
        console.log(`[Plugin Log] ${prefix} ${data.message}`);
    });

    emit<GetVariablesHandler>('GET_VARIABLES')
    emit('GET_LIBRARY_RESOURCES')
    emit<GetSelectionStylesHandler>('GET_SELECTION_STYLES')

    emit<GetLocalComponentsHandler>('GET_LOCAL_COMPONENTS')

    return () => {
      stopVars()
      stopLibrary()
      stopStyles()
      stopAnalyzed()

      stopComponents()
      stopLog()
    }
  }, [])

  return {
    variables,
    libraryResources,
    localComponents,
    selectionStyles,
    analyzedPattern,

    patternSummary
  }
}
