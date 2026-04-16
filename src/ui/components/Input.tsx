import { h } from 'preact';
import { tokens } from '../design-system/tokens';

interface InputProps extends h.JSX.InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
  leftElement?: h.JSX.Element | null;
  rightElement?: h.JSX.Element | null; // For the "confirm" button inside the input
}

export function Input({
  fullWidth = true,
  leftElement,
  rightElement,
  className,
  style,
  onInput,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  
  const containerStyle: h.JSX.CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: fullWidth ? '100%' : 'auto',
  };

  const inputBaseStyle: h.JSX.CSSProperties = {
    height: tokens.size.input.sm, // Compact input (32px)
    width: '100%',
    padding: `0 ${tokens.grid.blockPad}px`,
    paddingLeft: leftElement ? 34 : tokens.grid.blockPad,
    paddingRight: rightElement ? 48 : tokens.grid.blockPad,
    fontSize: tokens.fontSize[1],
    fontFamily: tokens.font.sans,
    background: 'transparent', // Transparent to avoid dark mode issues
    color: tokens.colors.textPrimary,
    border: 'none',
    borderRadius: 'var(--radius-3)', // Flatter design
    outline: 'none',
    ...(style as any),
  };

  // We'll wrap the onInput to cast safely
  const handleInput = (e: Event) => {
    if (onInput) {
      onInput(e as any);
    }
  };

  return (
    <div style={containerStyle}>
      {leftElement && (
        <div style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          {leftElement}
        </div>
      )}
      <input
        className={`focusable focusable-input${className ? ` ${className}` : ''}`}
        style={inputBaseStyle}
        onInput={handleInput}
        onFocus={onFocus}
        onBlur={onBlur}
        {...props}
      />
      {rightElement && (
        <div style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 2,
        }}>
          {rightElement}
        </div>
      )}
    </div>
  );
}
