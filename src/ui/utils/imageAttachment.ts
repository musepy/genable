/**
 * @file imageAttachment.ts
 * @description Convert a File / Blob into a sanitised ContextAttachment image.
 *
 * Pipeline: validate type → decode → downscale (>MAX_DIMENSION) → re-encode JPEG
 * if oversized → return base64 (no `data:` prefix). Throws on hard failure.
 *
 * Sized for vision LLMs: Anthropic / Gemini both recommend max edge ~1568px and
 * payloads under a few MB. We aim for ≤1.5MB after compression.
 */

import type { ContextAttachment } from '../../types';

export const MAX_IMAGES = 4;
export const MAX_DIMENSION = 1568;
export const MAX_SIZE_KB = 1500;
export const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type ImageAttachment = Extract<ContextAttachment, { type: 'image' }>;

export class ImageAttachmentError extends Error {
  constructor(public reasonCode: 'unsupported-type' | 'decode-failed' | 'too-large', message: string) {
    super(message);
    this.name = 'ImageAttachmentError';
  }
}

function isAcceptedMime(mime: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
}

function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageAttachmentError('decode-failed', 'Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataURL: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageAttachmentError('decode-failed', 'Image decode failed'));
    img.src = dataURL;
  });
}

function dataURLPayload(dataURL: string): { mimeType: string; base64: string } {
  // data:[<mime>];base64,<payload>
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/.exec(dataURL);
  if (!match) throw new ImageAttachmentError('decode-failed', 'Malformed data URL');
  return { mimeType: match[1] || 'application/octet-stream', base64: match[2] || '' };
}

function base64SizeKB(b64: string): number {
  // Rough size estimate of decoded payload in KB.
  return Math.round((b64.length * 3) / 4 / 1024);
}

function targetDims(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h };
  const scale = max / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

/**
 * Take a File from a paste/drop event and produce an ImageAttachment.
 *
 * - GIF passes through as-is (no canvas re-encode → preserves animation, though
 *   most LLMs treat it as a still). Still bound by MAX_SIZE_KB.
 * - Other formats: re-encode to JPEG at q=0.85 if oversized OR larger than
 *   MAX_DIMENSION; otherwise pass through original bytes.
 */
export async function loadImageFile(file: File): Promise<ImageAttachment> {
  if (!isAcceptedMime(file.type)) {
    throw new ImageAttachmentError(
      'unsupported-type',
      `Unsupported image type: ${file.type || 'unknown'}. Use PNG, JPEG, WebP, or GIF.`,
    );
  }

  const originalDataURL = await readFileAsDataURL(file);
  const img = await loadImageElement(originalDataURL);
  const naturalW = img.naturalWidth;
  const naturalH = img.naturalHeight;
  const original = dataURLPayload(originalDataURL);
  const originalKB = base64SizeKB(original.base64);

  const needsResize = naturalW > MAX_DIMENSION || naturalH > MAX_DIMENSION;
  const needsRecompress = originalKB > MAX_SIZE_KB && file.type !== 'image/gif';

  let outMime = original.mimeType;
  let outBase64 = original.base64;
  let outW = naturalW;
  let outH = naturalH;

  if ((needsResize || needsRecompress) && file.type !== 'image/gif') {
    const { w, h } = targetDims(naturalW, naturalH, MAX_DIMENSION);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageAttachmentError('decode-failed', '2D canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    // JPEG strips alpha; for PNGs with transparency this loses the alpha channel
    // but cuts size dramatically. Acceptable trade-off for LLM reference input.
    const jpegURL = canvas.toDataURL('image/jpeg', 0.85);
    const recompressed = dataURLPayload(jpegURL);
    outMime = recompressed.mimeType;
    outBase64 = recompressed.base64;
    outW = w;
    outH = h;
  }

  const outKB = base64SizeKB(outBase64);
  if (outKB > MAX_SIZE_KB) {
    throw new ImageAttachmentError(
      'too-large',
      `Image still ${outKB}KB after compression — limit is ${MAX_SIZE_KB}KB.`,
    );
  }

  return {
    type: 'image',
    id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    mimeType: outMime,
    data: outBase64,
    name: file.name || 'pasted-image',
    width: outW,
    height: outH,
    sizeKB: outKB,
  };
}

/**
 * Pull image Files out of a ClipboardEvent (paste).
 */
export function extractImagesFromClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

/**
 * Pull image Files out of a DragEvent.
 */
export function extractImagesFromDrop(e: DragEvent): File[] {
  const list = e.dataTransfer?.files;
  if (!list) return [];
  const out: File[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    if (f.type.startsWith('image/')) out.push(f);
  }
  return out;
}
