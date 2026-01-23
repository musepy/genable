import { h, ComponentChildren, createContext } from 'preact';
import { useContext, useState, useEffect, useCallback } from 'preact/hooks';
import { tokens } from '../../design-system/tokens';

// ============================================
// TOAST TYPES
// ============================================

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

export interface ToastData {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number; // ms, default 4000
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  toasts: ToastData[];
  dismiss: (id: string) => void;
}

// ============================================
// TOAST CONTEXT
// ============================================

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ============================================
// TOAST PROVIDER
// ============================================

interface ToastProviderProps {
  children: ComponentChildren;
  maxToasts?: number; // Default 3
}

export function ToastProvider({ children, maxToasts = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((
    message: string,
    variant: ToastVariant = 'default',
    duration: number = 4000
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    setToasts((prev) => {
      // Limit max toasts (LIFO - keep newest)
      const next = [...prev, { id, message, variant, duration }];
      if (next.length > maxToasts) {
        return next.slice(-maxToasts);
      }
      return next;
    });

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
  }, [dismiss, maxToasts]);

  return (
    <ToastContext.Provider value={{ toast, toasts, dismiss }}>
      {/* 
        display: contents makes this div "invisible" to layout.
        Children are laid out as if they were direct children of the Provider.
        This prevents breaking Plugin's flex layout.
      */}
      <div style={{ display: 'contents' }}>
        {children}
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    </ToastContext.Provider>
  );
}

// ============================================
// TOAST CONTAINER (Viewport)
// ============================================

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 'var(--space-4)',
      right: 'var(--space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      zIndex: 99999, // Very high to ensure visibility
      pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <Toast key={t.id} data={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

// ============================================
// TOAST ITEM
// ============================================

interface ToastProps {
  data: ToastData;
  onDismiss: () => void;
}

function Toast({ data, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const variantStyles: Record<ToastVariant, h.JSX.CSSProperties> = {
    default: {
      background: 'var(--card)',
      borderColor: 'var(--border)',
      color: 'var(--foreground)',
    },
    success: {
      background: 'var(--success-muted)',
      borderColor: 'var(--success-border)',
      color: 'var(--success)',
    },
    error: {
      background: 'var(--destructive-muted)',
      borderColor: 'var(--destructive-border)',
      color: 'var(--destructive)',
    },
    warning: {
      background: 'var(--warning-muted)',
      borderColor: 'var(--warning-border)',
      color: 'var(--warning)',
    },
  };

  const icons: Record<ToastVariant, string> = {
    default: 'i',
    success: '✓',
    error: '✕',
    warning: '!',
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space[2],
        padding: `${tokens.space[2]}px ${tokens.space[4]}px`,
        borderRadius: 'var(--radius-2)',
        border: '1px solid',
        boxShadow: '0 4px 12px var(--gray-a4)',
        fontSize: 'var(--font-size-1)',
        fontFamily: tokens.font.sans,
        minWidth: 200,
        maxWidth: 320,
        pointerEvents: 'auto',
        // Animation
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        ...variantStyles[data.variant],
      }}
    >
      <span style={{ fontSize: 'var(--font-size-2)' }}>{icons[data.variant]}</span>
      <span style={{ flex: 1 }}>{data.message}</span>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: tokens.space[1],
          color: tokens.colors.textSecondary,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
