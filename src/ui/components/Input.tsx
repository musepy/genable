import { h } from 'preact';
import { tokens } from '../design-system/tokens';

interface InputProps extends h.JSX.InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
  rightElement?: h.JSX.Element | null; // For the "confirm" button inside the input
}

export function Input({
  fullWidth = true,
  rightElement,
  style,
  onInput,
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
    paddingRight: rightElement ? 48 : tokens.grid.blockPad,
    fontSize: tokens.fontSize[1],
    fontFamily: tokens.font.sans,
    background: 'transparent', // Transparent to avoid dark mode issues
    color: tokens.colors.textPrimary,
    border: 'none',
    boxShadow: 'inset 0 0 0 0.5px var(--border-default)',
    borderRadius: 'var(--radius-3)', // Flatter design
    outline: 'none',
    transition: 'border-color var(--duration-normal) var(--ease-default), box-shadow var(--duration-normal) var(--ease-default)',
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
      <input
        style={inputBaseStyle}
        onInput={handleInput}
        {...props}
        onFocus={(e) => {
          (e.target as HTMLInputElement).style.borderColor = tokens.colors.ring;
        }}
        onBlur={(e) => {
          (e.target as HTMLInputElement).style.borderColor = tokens.colors.grayBorder;
        }}
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
