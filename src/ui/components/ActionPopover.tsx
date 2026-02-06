/**
 * @file ActionPopover.tsx
 * @description Action menu popover for the "+" button in PromptInput
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Code, Plus } from 'lucide-preact';
import { tokens } from '../design-system/tokens';

interface ActionPopoverProps {
  onSerializeSelection: () => void;
  disabled?: boolean;
}

export function ActionPopover({ onSerializeSelection, disabled }: ActionPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || isClosing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 150);
  };

  const handleAction = (action: () => void) => {
    action();
    handleClose();
  };

  return (
    <div ref={popoverRef} style={{ position: 'relative' }}>
      {/* Trigger Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-5)',
          cursor: disabled ? 'default' : 'pointer',
          color: tokens.colors.textSecondary,
          transition: 'background 200ms ease, transform 200ms ease',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = tokens.colors.alpha[2];
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
        aria-label="More actions"
        aria-expanded={isOpen}
      >
        <Plus size={20} strokeWidth={1.5} />
      </button>

      {/* Popover Content */}
      {isOpen && (
        <div
          className={isClosing ? 'popover-content-exit' : 'popover-content'}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            width: 220,
            zIndex: tokens.zIndex.popover,
          }}
        >
          <div style={{ padding: tokens.space[1] }}>
            <div
              className="popover-item"
              onClick={() => handleAction(onSerializeSelection)}
            >
              <Code size={14} />
              <span>Copy Selection as JSON</span>
            </div>
            {/* Additional actions can be added here */}
          </div>
        </div>
      )}
    </div>
  );
}
