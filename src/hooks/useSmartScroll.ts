/**
 * @file useSmartScroll.ts
 * @description Smart scroll hook that prevents forced scrolling when user is viewing history.
 * 
 * P1 Implementation:
 * - If user is at/near bottom → auto-scroll on new messages
 * - If user has scrolled up → preserve position, show "New messages" indicator
 */

import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import { RefObject } from 'preact';

interface UseSmartScrollOptions {
  /** Buffer distance from bottom to consider "at bottom" (px) */
  threshold?: number;
}

interface UseSmartScrollReturn {
  /** Whether auto-scroll should occur */
  shouldAutoScroll: boolean;
  /** Ref to attach to the scroll container */
  containerRef: RefObject<HTMLDivElement>;
  /** Ref to attach to the bottom anchor element */
  anchorRef: RefObject<HTMLDivElement>;
  /** Whether to show "new messages" indicator */
  showNewMessagesIndicator: boolean;
  /** Handler to scroll to bottom manually */
  scrollToBottom: () => void;
}

export function useSmartScroll<T>(
  dependency: T,
  options: UseSmartScrollOptions = {}
): UseSmartScrollReturn {
  const { threshold = 100 } = options;
  
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  
  // Track if user is "stuck" to bottom
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  
  // Check scroll position
  const checkScrollPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    setIsAtBottom(distanceFromBottom <= threshold);
  }, [threshold]);
  
  // Attach scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', checkScrollPosition, { passive: true });
    return () => container.removeEventListener('scroll', checkScrollPosition);
  }, [checkScrollPosition]);
  
  // When dependency changes (new messages), check if we should show indicator
  useEffect(() => {
    if (!isAtBottom) {
      setHasNewMessages(true);
    }
  }, [dependency, isAtBottom]);
  
  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    anchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasNewMessages(false);
    setIsAtBottom(true);
  }, []);
  
  return {
    shouldAutoScroll: isAtBottom,
    containerRef,
    anchorRef,
    showNewMessagesIndicator: hasNewMessages && !isAtBottom,
    scrollToBottom,
  };
}
