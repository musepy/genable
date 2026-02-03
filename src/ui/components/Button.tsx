import { h, ComponentChildren } from 'preact';
import { tokens } from '../design-system/tokens';

export interface ButtonProps extends h.JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ComponentChildren;
  children?: ComponentChildren;
}

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  fullWidth = false,
  leftIcon,
  children,
  style,
  disabled,
  ...props
}: ButtonProps) {
  
  // Base styles
  const baseStyle: h.JSX.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-2)',
    fontWeight: tokens.fontWeight.medium,
    cursor: 'pointer',
    transition: 'var(--transition-crisp)',
    border: 'none',
    outline: 'none',
    fontFamily: tokens.font.sans,
    whiteSpace: 'nowrap',
    opacity: disabled || isLoading ? 0.6 : 1,
    pointerEvents: disabled || isLoading ? 'none' : 'auto',
    gap: tokens.space[1],
    width: fullWidth ? '100%' : 'auto',
  };

  // Variant styles
  const variantStyles: Record<NonNullable<ButtonProps['variant']>, h.JSX.CSSProperties> = {
    primary: {
      background: tokens.colors.accent,
      color: tokens.colors.accentContrast,
      border: 'none',
    },
    secondary: {
      background: tokens.colors.grayMuted,
      color: tokens.colors.textPrimary,
      border: `1px solid ${tokens.colors.grayBorder}`,
    },
    outline: {
      background: 'transparent',
      color: tokens.colors.textPrimary,
      border: `1px solid ${tokens.colors.grayBorder}`,
    },
    ghost: {
      background: 'transparent',
      color: tokens.colors.textPrimary,
      border: 'none',
    },
    destructive: {
      background: tokens.colors.error,
      color: tokens.colors.accentContrast, // Error background usually has white text
      border: 'none',
    },
  };

  // Size styles
  const sizeStyles: Record<NonNullable<ButtonProps['size']>, h.JSX.CSSProperties> = {
    sm: {
      height: tokens.size.button.sm,
      padding: `0 ${tokens.space[3]}px`,
      fontSize: 'var(--font-size-1)',
    },
    md: {
      height: 40,
      padding: `0 ${tokens.space[4]}px`,
      fontSize: '13px', // Figma design spec
    },
    lg: {
      height: tokens.size.button.xl,
      padding: `0 ${tokens.space[5]}px`,
      fontSize: 'var(--font-size-2)',
    },
    icon: {
      height: tokens.size.button.sm,
      width: tokens.size.button.sm,
      padding: 0,
    },
  };

  // Special case: Pill shape for primary usually
  if (variant === 'primary' || variant === 'outline') {
    baseStyle.borderRadius = 'var(--radius-full)';
  }

  // Hover effects simulated for inline styles (optional, but good for completeness if we could use CSS classes)
  // Since we use inline styles with preact, simple hovers are hard without state. 
  // relying on `styles-module` or simple css classes in styles.css would be better, 
  // but existing codebase uses inline styles heavily. 
  // We will trust the existing global css or simple active states.
  
  // CSS class for pressed state support
  const variantClass = `btn-${variant}`;

  return (
    <button
      className={variantClass}
      style={{
        ...baseStyle,
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...(style as any),
      }}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <span style={{ marginRight: tokens.space[1] }}>
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
             </svg>
             <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </span>
      )}
      {!isLoading && leftIcon && <span style={{ display: 'flex' }}>{leftIcon}</span>}
      {children}
    </button>
  );
}
