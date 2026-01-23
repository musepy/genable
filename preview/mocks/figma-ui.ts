/**
 * Mock for @create-figma-plugin/ui
 * 
 * Re-exports common UI components with simple implementations
 * for standalone browser preview.
 */

import { h, ComponentChildren, FunctionComponent } from 'preact'

// ============================================
// RENDER FUNCTION
// ============================================

export function render(Component: FunctionComponent) {
  const container = document.getElementById('app')
  if (container) {
    import('preact').then(({ render: preactRender, h }) => {
       preactRender(h(Component, null), container)
    }).catch(err => console.error('[Preview] Failed to load Preact:', err))
  }
  return Component
}

// ============================================
// LAYOUT COMPONENTS
// ============================================

export const VerticalSpace: FunctionComponent<{ space?: string }> = ({ space = 'medium' }) => {
  const spacing: Record<string, number> = {
    extraSmall: 4,
    small: 8,
    medium: 12,
    large: 16,
    extraLarge: 24
  }
  return h('div', { style: { height: spacing[space] || 12 } })
}

export const Container: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => {
  return h('div', { style: { padding: 12 } }, children)
}

export const Columns: FunctionComponent<{ children: ComponentChildren; space?: string }> = ({ children, space = 'medium' }) => {
  return h('div', { 
    style: { 
      display: 'flex', 
      gap: space === 'small' ? 8 : 12 
    } 
  }, children)
}

// ============================================
// TEXT COMPONENTS
// ============================================

export const Text: FunctionComponent<{ 
  children: ComponentChildren
  bold?: boolean
  muted?: boolean
  numeric?: boolean
}> = ({ children, bold, muted }) => {
  return h('span', { 
    style: { 
      fontWeight: bold ? 600 : 400,
      color: muted ? 'var(--muted-foreground, #888)' : 'inherit',
      fontSize: 12,
    } 
  }, children)
}

export const Bold: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => {
  return h('strong', null, children)
}

export const Muted: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => {
  return h('span', { style: { color: 'var(--muted-foreground, #888)' } }, children)
}

// ============================================
// FORM COMPONENTS
// ============================================

interface TextboxProps {
  value: string
  onValueInput?: (value: string) => void
  placeholder?: string
  password?: boolean
  disabled?: boolean
  style?: any
}

export const Textbox: FunctionComponent<TextboxProps> = ({ 
  value, 
  onValueInput, 
  placeholder,
  password,
  disabled,
  style
}) => {
  return h('input', {
    type: password ? 'password' : 'text',
    value,
    placeholder,
    disabled,
    onInput: (e: Event) => onValueInput?.((e.target as HTMLInputElement).value),
    style: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid var(--border, #444)',
      borderRadius: 6,
      background: 'var(--input, #333)',
      color: 'var(--foreground, #fff)',
      fontSize: 12,
      outline: 'none',
      ...style
    }
  })
}

interface TextboxMultilineProps {
  value: string
  onValueInput?: (value: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
}

export const TextboxMultiline: FunctionComponent<TextboxMultilineProps> = ({ 
  value, 
  onValueInput, 
  placeholder,
  rows = 3,
  disabled
}) => {
  return h('textarea', {
    value,
    placeholder,
    rows,
    disabled,
    onInput: (e: Event) => onValueInput?.((e.target as HTMLTextAreaElement).value),
    style: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid var(--border, #444)',
      borderRadius: 6,
      background: 'var(--input, #333)',
      color: 'var(--foreground, #fff)',
      fontSize: 12,
      resize: 'vertical',
      fontFamily: 'inherit',
      outline: 'none'
    }
  })
}

interface ButtonProps {
  children: ComponentChildren
  onClick?: () => void
  disabled?: boolean
  secondary?: boolean
  danger?: boolean
  fullWidth?: boolean
}

export const Button: FunctionComponent<ButtonProps> = ({ 
  children, 
  onClick, 
  disabled,
  secondary,
  danger,
  fullWidth
}) => {
  let bg = 'var(--primary, #0066ff)'
  if (secondary) bg = 'var(--secondary, #333)'
  if (danger) bg = 'var(--destructive, #ff4444)'
  
  return h('button', {
    onClick,
    disabled,
    style: {
      width: fullWidth ? '100%' : 'auto',
      padding: '8px 16px',
      background: disabled ? '#555' : bg,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      fontSize: 12,
      fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1
    }
  }, children)
}

interface DropdownProps {
  value: string | null
  options: Array<{ value: string; text?: string }>
  onValueChange?: (value: string) => void
  placeholder?: string
}

export const Dropdown: FunctionComponent<DropdownProps> = ({
  value,
  options,
  onValueChange,
  placeholder
}) => {
  return h('select', {
    value: value || '',
    onChange: (e: Event) => onValueChange?.((e.target as HTMLSelectElement).value),
    style: {
      width: '100%',
      padding: '8px 12px',
      border: '1px solid var(--border, #444)',
      borderRadius: 6,
      background: 'var(--input, #333)',
      color: 'var(--foreground, #fff)',
      fontSize: 12,
      outline: 'none',
      cursor: 'pointer'
    }
  }, [
    placeholder ? h('option', { value: '', disabled: true }, placeholder) : null,
    ...options.map(opt => h('option', { value: opt.value }, opt.text || opt.value))
  ])
}

// ============================================
// MISC COMPONENTS
// ============================================

export const Divider: FunctionComponent = () => {
  return h('hr', { 
    style: { 
      border: 'none', 
      borderTop: '1px solid var(--border, #444)',
      margin: '8px 0'
    } 
  })
}

export const LoadingIndicator: FunctionComponent = () => {
  return h('div', { 
    style: { 
      display: 'flex', 
      justifyContent: 'center', 
      padding: 16 
    } 
  }, '⏳ Loading...')
}

export const IconButton: FunctionComponent<{
  children: ComponentChildren
  onClick?: () => void
}> = ({ children, onClick }) => {
  return h('button', {
    onClick,
    style: {
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      padding: 4,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, children)
}
