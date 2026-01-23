import { useState, useCallback, useRef } from 'preact/hooks';

export type InteractionStatus = 'idle' | 'executing' | 'success' | 'error';

/**
 * useClipboard Hook
 * 
 * Follows Figma Plugin Engineering Standards:
 * 1. Declarative Interaction States
 * 2. Robust Fallback Pattern (sync execCommand + async navigator.clipboard)
 * 3. User Gesture Persistence (logic must be triggered in same event loop)
 */
export function useClipboard(resetDelay: number = 2000) {
  const [status, setStatus] = useState<InteractionStatus>('idle');
  const timerRef = useRef<number | null>(null);

  const copy = useCallback(async (text: string) => {
    // 1. Enter executing state
    setStatus('executing');
    
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    try {
      /**
       * ROBUST FALLBACK PATTERN
       * In Figma Plugins (Iframe sandbox), navigator.clipboard often fails if the focus
       * is lost. document.execCommand('copy') is more robust for user-gesture focus.
       */
      
      let success = false;

      // Try modern API first (if available and in focus)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          success = true;
        } catch (err) {
          console.warn('[useClipboard] Modern API failed, trying fallback...', err);
        }
      }

      // Sync Fallback (The "Standard" robustness choice for Figma)
      if (!success) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        
        // Ensure it's not visible but part of DOM
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        
        textArea.focus();
        textArea.select();
        
        try {
          success = document.execCommand('copy');
        } catch (err) {
          console.error('[useClipboard] Fallback failed:', err);
        }
        
        document.body.removeChild(textArea);
      }

      if (success) {
        setStatus('success');
        timerRef.current = window.setTimeout(() => setStatus('idle'), resetDelay);
      } else {
        setStatus('error');
        timerRef.current = window.setTimeout(() => setStatus('idle'), resetDelay);
      }
    } catch (err) {
      console.error('[useClipboard] Unexpected error:', err);
      setStatus('error');
      timerRef.current = window.setTimeout(() => setStatus('idle'), resetDelay);
    }
  }, [resetDelay]);

  return { copy, status };
}
