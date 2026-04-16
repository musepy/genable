/**
 * @file usePopover.ts
 * @description Shared hook for popover open/close/click-outside logic with exit animation.
 */

import { useState, useEffect, useRef } from 'preact/hooks';

const CLOSE_ANIMATION_MS = 150;

export function usePopover() {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const open = () => setIsOpen(true);

  const close = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, CLOSE_ANIMATION_MS);
  };

  const toggle = () => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  };

  useEffect(() => {
    if (!isOpen || isClosing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  const popoverClass = isClosing ? 'popover-content-exit' : 'popover-content';

  return { isOpen, isClosing, ref, open, close, toggle, popoverClass };
}
