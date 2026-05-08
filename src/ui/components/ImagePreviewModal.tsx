/**
 * @file ImagePreviewModal.tsx
 * @description Lightbox preview for image attachments. Click chip → opens here.
 *
 * - Backdrop click / Esc / × button closes
 * - Image clamped to viewport (max 92vw × 78vh, preserves aspect)
 * - Caption: filename · WxH · sizeKB
 *
 * Rendered via portal so it escapes the prompt composer's stacking context
 * and covers the whole plugin window.
 */

import { h } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { tokens } from '../design-system/tokens';
import { CloseIcon } from './NodeTypeIcon';

export interface ImagePreviewModalProps {
  mimeType: string;
  /** base64 payload, no `data:` prefix */
  data: string;
  name: string;
  width: number;
  height: number;
  sizeKB: number;
  onClose: () => void;
}

export function ImagePreviewModal({
  mimeType,
  data,
  name,
  width,
  height,
  sizeKB,
  onClose,
}: ImagePreviewModalProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${name}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        animation: 'chip-enter 160ms cubic-bezier(0.32, 0.72, 0, 1)',
        cursor: 'zoom-out',
      }}
    >
      <button
        type="button"
        aria-label="Close preview"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          background: 'rgba(255,255,255,0.16)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <CloseIcon />
      </button>

      <img
        src={`data:${mimeType};base64,${data}`}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '92vw',
          maxHeight: '78vh',
          borderRadius: 6,
          boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
          cursor: 'default',
          userSelect: 'none',
        }}
      />

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: 12,
          color: 'rgba(255,255,255,0.86)',
          fontSize: tokens.fontSize[1],
          fontFamily: tokens.font.sans,
          textAlign: 'center' as const,
          maxWidth: '92vw',
          padding: '0 16px',
          cursor: 'default',
        }}
      >
        <div style={{ fontWeight: tokens.fontWeight.medium, wordBreak: 'break-word' as const }}>
          {name}
        </div>
        <div style={{ marginTop: 2, opacity: 0.62, fontSize: 11 }}>
          {width}×{height} · {sizeKB}KB
        </div>
      </div>
    </div>,
    document.body,
  );
}
