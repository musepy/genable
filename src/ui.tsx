import {
  Button,
  Container,
  render,
  Textbox,
  VerticalSpace,
  Text,
  Muted,
  IconFrame16,
  LoadingIndicator
} from '@create-figma-plugin/ui'
import { emit, on } from '@create-figma-plugin/utilities'
import { h, Fragment } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { 
  CreateLayersHandler, 
  GetVariablesHandler, 
  SendVariablesHandler,
  GetSelectionStylesHandler,
  SendSelectionStylesHandler,
  SelectionStyles,
  LoadSettingsHandler,
  SaveSettingsHandler,
  SettingsLoadedHandler
} from './types'
import { DESIGN_SYSTEMS, generateSystemPrompt } from './designSystems'
import { NodeSchema } from './schema'

const PROMPT_TEMPLATES = [
  { label: 'Login Form', system: 'Arco Design', text: 'A professional login card centered, with email & password inputs, "Remember me" checkbox, and a primary "Sign In" button. Use a clean, enterprise blue theme.' },
  { label: 'Dashboard Card', system: 'Ant Design', text: 'A metric card showing "Total Revenue", a big number "$45,231", a percentage increase badge "+12%", and a mini sparkline graph placeholder.' },
  { label: 'Mobile Nav', system: 'Material 3', text: 'A mobile bottom navigation bar with 4 icons: Home, Search, Profile, and Settings. Active state on Home.' },
  { label: 'Pricing Table', system: 'Tailwind CSS', text: 'A pricing tier card featuring "Pro Plan", price "$29/mo", a list of 5 checkmarked features, and a "Get Started" call-to-action button.' }
]

const LOADING_STEPS = [
  "🧠 Analyzing requirements...",
  "🎨 Selecting design tokens...",
  "📐 Structuring layout...",
  "✨ Polishing details...",
  "🔨 Building in Figma..."
]

function Plugin() {
  const [apiKey, setApiKey] = useState<string>('')
  const [modelName, setModelName] = useState<string>('gemini-1.5-flash')
  const [hasKey, setHasKey] = useState<boolean>(false)
  
  const [prompt, setPrompt] = useState<string>('')
  
  // UX: Loading States
  const [loading, setLoading] = useState<boolean>(false)
  const [loadingStatus, setLoadingStatus] = useState<string>('')
  const loadingInterval = useRef<any>(null)

  const [error, setError] = useState<string | null>(null)
  const [variables, setVariables] = useState<string[]>([])
  const [selectionStyles, setSelectionStyles] = useState<SelectionStyles | null>(null)
  const [selectedSystem, setSelectedSystem] = useState<string>('Tailwind CSS')
  
  // Chat History State
  const [history, setHistory] = useState<{role: 'user' | 'model', text: string}[]>([])

  useEffect(() => {
    // Listen for variables
    const stopVars = on<SendVariablesHandler>('SEND_VARIABLES', (data) => {
      setVariables(data.names)
    })

    const stopStyles = on<SendSelectionStylesHandler>('SEND_SELECTION_STYLES', (styles) => {
      if (styles.colors.length > 0 || styles.fonts.length > 0 || styles.cornerRadius.length > 0 || styles.referenceLayout) {
        setSelectionStyles(styles)
      } else {
        setSelectionStyles(null)
      }
    })

    // Listen for settings load
    const stopSettings = on<SettingsLoadedHandler>('SETTINGS_LOADED', (settings) => {
      if (settings.apiKey) {
        setApiKey(settings.apiKey)
        setHasKey(true)
      }
      if (settings.modelName) {
        setModelName(settings.modelName)
      }
    })
    
    // Init calls
    emit<GetVariablesHandler>('GET_VARIABLES')
    emit<GetSelectionStylesHandler>('GET_SELECTION_STYLES')
    emit<LoadSettingsHandler>('LOAD_SETTINGS')

    return () => {
      stopVars()
      stopStyles()
      stopSettings()
    }
  }, [])

  const saveSettings = () => {
    emit<SaveSettingsHandler>('SAVE_SETTINGS', { apiKey, modelName })
    setHasKey(!!apiKey)
  }

  // UX: Cycle through friendly status messages to reduce perceived wait time
  const startLoadingAnimation = () => {
    setLoading(true)
    let step = 0
    setLoadingStatus(LOADING_STEPS[0])
    loadingInterval.current = setInterval(() => {
      step = (step + 1) % (LOADING_STEPS.length - 1) // Cycle through first 4, save last for render
      setLoadingStatus(LOADING_STEPS[step])
    }, 2500)
  }

  const stopLoadingAnimation = () => {
    clearInterval(loadingInterval.current)
    setLoading(false)
    setLoadingStatus('')
  }

  const useTemplate = (t: typeof PROMPT_TEMPLATES[0]) => {
    setPrompt(t.text)
    setSelectedSystem(t.system)
  }

  const generate = async () => {
    startLoadingAnimation()
    setError(null)
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const limitedVars = variables.slice(0, 30);
      
      const styleContext = selectionStyles 
        ? `
        **CONTEXT: USER SELECTED AN EXISTING LAYER**
        You must adapt to the visual style of this selection:
        ${selectionStyles.referenceLayout ? `
        - **Target Dimensions:** Width ${selectionStyles.referenceLayout.width}px. 
        - **Layout Mode:** ${selectionStyles.referenceLayout.layoutMode}.
        - *Instruction:* The user likely wants to fill this container or modify it.
        ` : ''}
        - **Palette:** ${selectionStyles.colors.join(', ')} (Reuse these colors strictly)
        - **Typography:** ${selectionStyles.fonts.join(', ')}
        - **Radius:** ${selectionStyles.cornerRadius.join('px, ')}px
        `
        : '';

      const systemPrompt = generateSystemPrompt(selectedSystem, limitedVars, styleContext);

      const chat = model.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: systemPrompt }],
          },
          {
            role: "model",
            parts: [{ text: "Understood. I will generate production-ready Figma JSON DSL adhering to the chosen design system." }],
          },
          ...history.map(h => ({
            role: h.role,
            parts: [{ text: h.text }]
          }))
        ],
      });

      const result = await chat.sendMessage(prompt);
      
      // UX: Update status to "Rendering" once we have the data
      clearInterval(loadingInterval.current)
      setLoadingStatus(LOADING_STEPS[LOADING_STEPS.length - 1]) // "Building in Figma..."

      const response = await result.response;
      let text = response.text();
      
      // Cleanup markdown if present
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();

      // Attempt to parse JSON
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        // Fallback cleanup
        const firstOpen = text.indexOf('{');
        const lastClose = text.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
           const potentialJson = text.substring(firstOpen, lastClose + 1);
           try {
             json = JSON.parse(potentialJson);
           } catch (e2) {
             throw new Error("Model failed to generate valid JSON structure. Try clearing history.");
           }
        } else {
           throw new Error("Model output contained no JSON.");
        }
      }
      
      const parsed = NodeSchema.parse(json);

      setHistory(prev => [
        ...prev, 
        { role: 'user', text: prompt }, 
        { role: 'model', text: text } 
      ]);
      
      setPrompt('');
      emit<CreateLayersHandler>('CREATE_LAYERS', parsed)

    } catch (e: any) {
      setError(e.message || "Generation failed. Check console.")
      console.error(e)
    } finally {
      stopLoadingAnimation()
    }
  }

  if (!hasKey) {
    return (
      <Container space="medium">
        <VerticalSpace space="large" />
        <Text style={{fontWeight: 'bold'}}>Gemini API Setup</Text>
        <VerticalSpace space="medium" />
        
        <Muted>API Key</Muted>
        <VerticalSpace space="extraSmall" />
        <Textbox 
          onInput={(e: any) => setApiKey(e.currentTarget.value)} 
          value={apiKey} 
          placeholder="Paste your API Key here"
          password
        />
        <VerticalSpace space="small" />
        <Button fullWidth onClick={saveSettings}>Start Designing</Button>
      </Container>
    )
  }

  return (
    <Container space="medium">
      <VerticalSpace space="medium" />
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{fontWeight: 'bold', fontSize: '13px'}}>AI Component Generator</Text>
        <div 
          onClick={() => setHasKey(false)}
          style={{ cursor: 'pointer', opacity: 0.5 }}
        >
          <IconFrame16 />
        </div>
      </div>
      
      <VerticalSpace space="small" />

      {/* UX: Context Awareness Banner */}
      {selectionStyles ? (
        <div style={{ 
          background: '#EFF6FF', 
          border: '1px solid #BFDBFE',
          borderRadius: '6px',
          padding: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.3s ease'
        }}>
           <div style={{fontSize: '12px'}}>🔷</div> 
           <div>
             <Text style={{ fontWeight: 'bold', color: '#1E3A8A', fontSize: '11px' }}>Context Active</Text>
             <Text style={{ color: '#3B82F6', fontSize: '10px' }}>Using styles from selection</Text>
           </div>
           <div style={{ flex: 1 }} />
           <Text 
              style={{ cursor: 'pointer', color: '#2563EB', fontSize: '10px', textDecoration: 'underline' }} 
              onClick={() => emit<GetSelectionStylesHandler>('GET_SELECTION_STYLES')}
            >
              Refresh
            </Text>
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
            <Muted style={{fontSize: '10px'}}>Select a layer in Figma to adapt its style.</Muted>
        </div>
      )}

      <VerticalSpace space="small" />

      {/* UX: Prompt Templates (Learning Curve) */}
      {!loading && (
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
          {PROMPT_TEMPLATES.map((t, i) => (
            <div 
              key={i}
              onClick={() => useTemplate(t)}
              style={{
                flexShrink: 0,
                padding: '4px 8px',
                background: '#F3F4F6',
                borderRadius: '12px',
                fontSize: '10px',
                cursor: 'pointer',
                border: '1px solid #E5E7EB',
                color: '#374151',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#E5E7EB'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#F3F4F6'}
            >
              ✨ {t.label}
            </div>
          ))}
        </div>
      )}
      
      <VerticalSpace space="extraSmall" />

      <Textbox 
        onInput={(e: any) => setPrompt(e.currentTarget.value)} 
        value={prompt} 
        variant="border"
        placeholder="Describe your UI component..."
        style={{ height: '100px', resize: 'none' }} 
        {...{ multiline: true } as any} 
        disabled={loading}
      />
      
      <VerticalSpace space="small" />
      
      {/* Design System Selector (Simplified) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
         <Muted style={{fontSize: '10px'}}>System:</Muted>
         <select 
            value={selectedSystem} 
            onChange={(e: any) => setSelectedSystem(e.target.value)}
            style={{
                fontSize: '10px',
                padding: '2px',
                borderRadius: '4px',
                border: '1px solid #E5E7EB',
                background: 'transparent'
            }}
         >
             {Object.keys(DESIGN_SYSTEMS).map(sys => <option key={sys} value={sys}>{sys}</option>)}
         </select>
      </div>

      <VerticalSpace space="medium" />
      
      {/* UX: Feedback Loop & Action */}
      {loading ? (
        <div style={{ 
            background: '#F9FAFB', 
            borderRadius: '6px', 
            padding: '12px', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center',
            border: '1px solid #E5E7EB'
        }}>
            <LoadingIndicator />
            <VerticalSpace space="small" />
            <Text style={{ fontSize: '11px', color: '#4B5563', fontWeight: 'bold' }}>{loadingStatus}</Text>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px' }}>
            <Button fullWidth onClick={generate} disabled={!prompt.trim()}>
            {history.length > 0 ? "Iterate / Refine" : "Generate UI"}
            </Button>
            {history.length > 0 && (
            <Button secondary onClick={() => setHistory([])}>New</Button>
            )}
        </div>
      )}

      {error && (
        <Fragment>
          <VerticalSpace space="small" />
          <div style={{ padding: '8px', background: '#FEF2F2', borderRadius: '4px', border: '1px solid #FCA5A5' }}>
            <Text style={{ color: '#DC2626', fontSize: '10px' }}>{error}</Text>
          </div>
        </Fragment>
      )}

    </Container>
  )
}

export default render(Plugin)