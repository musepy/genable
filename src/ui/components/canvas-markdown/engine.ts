/**
 * @file engine.ts
 * @description Canvas-based markdown renderer engine.
 *
 * Pipeline: marked.lexer() → walkBlocks → flattenInline → wordWrap → fillText
 * Hit test: link regions tracked during layout, AABB collision on click.
 */

import { marked, type Token, type Tokens } from 'marked';
import { grid } from '../../design-system/tokens/layout';

// ============================================
// Types
// ============================================

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
  nodeId?: string;
}

interface BlockEntry {
  type: string;        // h1-h4, p, li, code_block
  spans: InlineSpan[];
  depth: number;       // nesting level (for lists)
  marker?: string;     // '•' or '1.'
}

interface BlockStyle {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
}

export interface RenderedSpan {
  text: string;
  x: number;
  y: number;         // baseline y
  width: number;
  height: number;
  font: string;
  color: string;
  href?: string;
  nodeId?: string;
  bg?: string;
  underline?: boolean;
}

export interface RenderedBlock {
  y: number;
  height: number;
  spans: RenderedSpan[];
  bg?: { x: number; y: number; w: number; h: number; color: string; radius: number };
}

export interface LinkRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  href?: string;
  nodeId?: string;
}

export interface LayoutResult {
  blocks: RenderedBlock[];
  links: LinkRegion[];
  height: number;
}

// ============================================
// Constants
// ============================================

const FONT_SANS = 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const FONT_MONO = '"SF Mono", Menlo, Monaco, monospace';

// ---- Alignment Grid (mirrors tokens.grid) ----
// Canvas sits inside scroll area (scrollPad=12), so internal T0 = blockPad → absolute textLeft
const T0 = grid.blockPad;               // 10 — primary text left inside canvas
const LIST_MARKER_W = 20;               // fixed marker slot width
const T1 = T0 + LIST_MARKER_W;          // 30 — list text left
const SUB_INDENT = 16;                   // per nesting level
const PADDING_X = T0;                    // alias

const BLOCK_STYLES: Record<string, BlockStyle> = {
  h1: { fontSize: 17, fontWeight: 700, lineHeight: 24, marginTop: 14, marginBottom: 4 },
  h2: { fontSize: 15, fontWeight: 600, lineHeight: 22, marginTop: 12, marginBottom: 4 },
  h3: { fontSize: 13, fontWeight: 600, lineHeight: 20, marginTop: 10, marginBottom: 2 },
  h4: { fontSize: 12, fontWeight: 600, lineHeight: 18, marginTop: 8, marginBottom: 2 },
  p:  { fontSize: 12, fontWeight: 400, lineHeight: 18, marginTop: 4, marginBottom: 4 },
  li: { fontSize: 12, fontWeight: 400, lineHeight: 18, marginTop: 1, marginBottom: 1 },
  code_block: { fontSize: 11, fontWeight: 400, lineHeight: 16, marginTop: 4, marginBottom: 4 },
};

// LIST_INDENT removed — replaced by grid system (T0, T1, SUB_INDENT)

// ============================================
// Node link preprocessing (same as TextBlock)
// ============================================

const NODE_LINK_RE = /\[node:([^\]|]+?)(?:\|([^\]]+?))?\]/g;

function preprocessNodeLinks(content: string): string {
  return content.replace(NODE_LINK_RE, (_, id, label) => {
    const safeLabel = (label || id).replace(/[[\]()]/g, '\\$&');
    return `[${safeLabel}](nodelink://${id})`;
  });
}

// ============================================
// Token walker — marked tokens → BlockEntry[]
// ============================================

function walkTokens(tokens: Token[], depth: number, result: BlockEntry[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        result.push({
          type: `h${(token as Tokens.Heading).depth}`,
          spans: flattenInline((token as Tokens.Heading).tokens),
          depth,
        });
        break;

      case 'paragraph':
        result.push({
          type: 'p',
          spans: flattenInline((token as Tokens.Paragraph).tokens),
          depth,
        });
        break;

      case 'list': {
        const list = token as Tokens.List;
        for (let i = 0; i < list.items.length; i++) {
          const item = list.items[i]!;
          const marker = list.ordered ? `${(list.start || 1) + i}.` : '\u2022';

          // Separate inline content from sub-lists
          // marked uses 'text' for tight lists, 'paragraph' for loose lists (with sub-lists)
          const inlineTokens: Token[] = [];
          const subLists: Token[] = [];
          for (const t of item.tokens) {
            if (t.type === 'list') subLists.push(t);
            else if ((t.type === 'text' || t.type === 'paragraph') && 'tokens' in t && (t as any).tokens) {
              inlineTokens.push(...((t as any).tokens as Token[]));
            } else {
              inlineTokens.push(t);
            }
          }

          result.push({
            type: 'li',
            spans: flattenInline(inlineTokens),
            depth,
            marker,
          });

          for (const sub of subLists) {
            walkTokens([sub], depth + 1, result);
          }
        }
        break;
      }

      case 'code':
        result.push({
          type: 'code_block',
          spans: [{ text: (token as Tokens.Code).text }],
          depth,
        });
        break;

      case 'space':
        break;

      default:
        // blockquote, table, hr — render as paragraph fallback
        if ('text' in token && typeof (token as any).text === 'string') {
          result.push({
            type: 'p',
            spans: [{ text: (token as any).text }],
            depth,
          });
        }
        break;
    }
  }
}

// ============================================
// Inline token flattener — marked inline → InlineSpan[]
// ============================================

function flattenInline(tokens: Token[]): InlineSpan[] {
  const spans: InlineSpan[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case 'text':
        spans.push({ text: (t as Tokens.Text).text });
        break;

      case 'strong':
        for (const s of flattenInline((t as Tokens.Strong).tokens)) {
          spans.push({ ...s, bold: true });
        }
        break;

      case 'em':
        for (const s of flattenInline((t as Tokens.Em).tokens)) {
          spans.push({ ...s, italic: true });
        }
        break;

      case 'codespan':
        spans.push({ text: (t as Tokens.Codespan).text, code: true });
        break;

      case 'link': {
        const link = t as Tokens.Link;
        const isNode = link.href?.startsWith('nodelink://');
        for (const s of flattenInline(link.tokens)) {
          spans.push({
            ...s,
            href: isNode ? undefined : link.href,
            nodeId: isNode ? link.href.replace('nodelink://', '') : undefined,
          });
        }
        break;
      }

      case 'br':
        spans.push({ text: '\n' });
        break;

      default:
        if ('raw' in t) spans.push({ text: (t as any).raw });
        break;
    }
  }

  return spans;
}

// ============================================
// CJK-aware word segmentation
// ============================================

function isCJK(code: number): boolean {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
    (code >= 0x3000 && code <= 0x303F) ||     // CJK Punctuation
    (code >= 0x3400 && code <= 0x4DBF) ||     // CJK Extension A
    (code >= 0xFF00 && code <= 0xFFEF) ||     // Fullwidth Forms
    (code >= 0xF900 && code <= 0xFAFF)        // CJK Compatibility
  );
}

/** Split text into wrappable segments. CJK chars break individually. */
function segmentText(text: string): string[] {
  const segs: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isCJK(code)) {
      if (buf) { segs.push(buf); buf = ''; }
      segs.push(text[i]!);
    } else if (text[i] === ' ') {
      buf += ' ';
      segs.push(buf);
      buf = '';
    } else if (text[i] === '\n') {
      if (buf) { segs.push(buf); buf = ''; }
      segs.push('\n');
    } else {
      buf += text[i];
    }
  }
  if (buf) segs.push(buf);
  return segs;
}

// ============================================
// Layout engine
// ============================================

interface ThemeColors {
  text: string;
  textSecondary: string;
  accent: string;
  accentBg: string;
  codeBg: string;
  codeText: string;
  linkColor: string;
}

export function resolveThemeColors(el: HTMLElement): ThemeColors {
  // Canvas fillStyle does NOT accept CSS variables like 'var(--gray-12)'.
  // getPropertyValue() can return empty strings in Figma iframe.
  // Use a probe element to force the browser to resolve the variable to an actual color.
  const resolveColor = (varName: string, fallback: string): string => {
    const probe = document.createElement('div');
    probe.style.color = `var(${varName})`;
    el.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    el.removeChild(probe);
    return resolved || fallback;
  };

  const resolveBg = (varName: string, fallback: string): string => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${varName})`;
    el.appendChild(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    el.removeChild(probe);
    return resolved || fallback;
  };

  return {
    text: resolveColor('--gray-12', '#1a1a1a'),
    textSecondary: resolveColor('--gray-11', '#6b6b6b'),
    accent: resolveColor('--accent-11', '#0066cc'),
    accentBg: resolveBg('--accent-a3', 'rgba(0,102,204,0.08)'),
    codeBg: resolveBg('--gray-a2', 'rgba(0,0,0,0.03)'),
    codeText: resolveColor('--gray-12', '#1a1a1a'),
    linkColor: resolveColor('--accent-11', '#0066cc'),
  };
}

function makeFont(size: number, weight: number, mono?: boolean): string {
  const family = mono ? FONT_MONO : FONT_SANS;
  return `${weight} ${size}px ${family}`;
}

export function layout(
  ctx: CanvasRenderingContext2D,
  content: string,
  maxWidth: number,
  colors: ThemeColors,
): LayoutResult {
  const processed = preprocessNodeLinks(content);
  const tokens = marked.lexer(processed);
  const entries: BlockEntry[] = [];
  walkTokens(tokens, 0, entries);

  const blocks: RenderedBlock[] = [];
  const links: LinkRegion[] = [];
  let cursorY = 2; // top padding

  for (let bi = 0; bi < entries.length; bi++) {
    const entry = entries[bi]!;
    const style = BLOCK_STYLES[entry.type] || BLOCK_STYLES.p!;
    const isMono = entry.type === 'code_block';
    const isList = entry.type === 'li';
    const depth = entry.depth;

    // Alignment grid positions
    let textLeft: number, markerLeft: number;
    if (isList) {
      if (depth === 0) { markerLeft = T0; textLeft = T1; }
      else { markerLeft = T1 + (depth - 1) * SUB_INDENT; textLeft = T1 + depth * SUB_INDENT; }
    } else {
      markerLeft = T0; textLeft = T0;
    }
    const textRight = maxWidth - PADDING_X;
    const availW = textRight - textLeft;

    // Collapse margins between adjacent blocks
    const prevMarginBottom = bi > 0
      ? (BLOCK_STYLES[entries[bi - 1]!.type] || BLOCK_STYLES.p!).marginBottom
      : 0;
    cursorY += Math.max(style.marginTop, prevMarginBottom);
    if (bi > 0) cursorY -= prevMarginBottom; // already added by prev block
    cursorY += style.marginTop;

    const blockStartY = cursorY;
    const renderedSpans: RenderedSpan[] = [];

    if (isMono) {
      // Code block: render as-is with monospace, no word-wrap logic needed
      const font = makeFont(style.fontSize, style.fontWeight, true);
      ctx.font = font;
      const lines = entry.spans.map(s => s.text).join('').split('\n');
      const codePadX = 8;
      const codePadY = 6;
      const blockBgY = cursorY;

      cursorY += codePadY;
      for (const line of lines) {
        renderedSpans.push({
          text: line,
          x: textLeft + codePadX,
          y: cursorY + style.fontSize, // baseline
          width: ctx.measureText(line).width,
          height: style.lineHeight,
          font,
          color: colors.codeText,
        });
        cursorY += style.lineHeight;
      }
      cursorY += codePadY;

      blocks.push({
        y: blockStartY,
        height: cursorY - blockStartY,
        spans: renderedSpans,
        bg: {
          x: textLeft, y: blockBgY,
          w: availW, h: cursorY - blockBgY,
          color: colors.codeBg,
          radius: 4,
        },
      });
    } else {
      // Word-wrap inline spans — text starts at textLeft
      let lineX = textLeft;
      let lineY = cursorY;

      for (const span of entry.spans) {
        const isBold = span.bold;
        const isItalic = span.italic;
        const isCode = span.code;
        const isLink = !!(span.href || span.nodeId);

        const weight = isBold ? 600 : style.fontWeight;
        const font = makeFont(
          isCode ? style.fontSize - 1 : style.fontSize,
          weight,
          isCode,
        );
        ctx.font = font;

        let color = colors.text;
        if (isLink) color = span.nodeId ? colors.accent : colors.linkColor;

        const segments = segmentText(span.text);

        for (const seg of segments) {
          if (seg === '\n') {
            lineX = textLeft;
            lineY += style.lineHeight;
            continue;
          }

          const segW = ctx.measureText(seg).width;

          // Wrap if exceeds right edge and not first word on line
          if (lineX + segW > textRight && lineX > textLeft) {
            lineX = textLeft;
            lineY += style.lineHeight;
          }

          const rs: RenderedSpan = {
            text: seg,
            x: lineX,
            y: lineY + style.fontSize, // baseline
            width: segW,
            height: style.lineHeight,
            font,
            color,
            href: span.href,
            nodeId: span.nodeId,
            underline: isLink,
          };

          if (isCode) {
            rs.bg = colors.codeBg;
          }
          if (span.nodeId) {
            rs.bg = colors.accentBg;
          }

          renderedSpans.push(rs);

          // Track link region
          if (isLink) {
            links.push({
              x: lineX,
              y: lineY,
              w: segW,
              h: style.lineHeight,
              href: span.href,
              nodeId: span.nodeId,
            });
          }

          lineX += segW;
        }
      }

      // Add marker span — right-aligned within [markerLeft ... textLeft]
      if (entry.marker) {
        const markerFont = makeFont(style.fontSize, style.fontWeight);
        ctx.font = markerFont;
        const mw = ctx.measureText(entry.marker).width;
        renderedSpans.unshift({
          text: entry.marker,
          x: textLeft - mw - 4, // right-aligned with 4px gap before text
          y: blockStartY + style.fontSize,
          width: mw,
          height: style.lineHeight,
          font: markerFont,
          color: colors.textSecondary,
        });
      }

      cursorY = lineY + style.lineHeight;

      blocks.push({
        y: blockStartY,
        height: cursorY - blockStartY,
        spans: renderedSpans,
      });
    }

    cursorY += style.marginBottom;
  }

  return { blocks, links, height: cursorY + 2 };
}

// ============================================
// Canvas renderer
// ============================================

export function render(
  ctx: CanvasRenderingContext2D,
  result: LayoutResult,
  _colors: ThemeColors,
): void {
  // Draw block backgrounds first
  for (const block of result.blocks) {
    if (block.bg) {
      ctx.fillStyle = block.bg.color;
      if (block.bg.radius > 0) {
        roundRect(ctx, block.bg.x, block.bg.y, block.bg.w, block.bg.h, block.bg.radius);
      } else {
        ctx.fillRect(block.bg.x, block.bg.y, block.bg.w, block.bg.h);
      }
    }
  }

  // Draw spans
  for (const block of result.blocks) {
    for (const span of block.spans) {
      // Inline background (code, node link)
      if (span.bg) {
        ctx.fillStyle = span.bg;
        roundRect(ctx, span.x - 2, span.y - span.height + 2, span.width + 4, span.height, 3);
      }

      // Text
      ctx.font = span.font;
      ctx.fillStyle = span.color;
      ctx.fillText(span.text, span.x, span.y);

      // Underline for links
      if (span.underline) {
        ctx.strokeStyle = span.color;
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(span.x, span.y + 2);
        ctx.lineTo(span.x + span.width, span.y + 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

// ============================================
// Hit testing
// ============================================

export function hitTest(result: LayoutResult, x: number, y: number): LinkRegion | null {
  for (const link of result.links) {
    if (x >= link.x && x <= link.x + link.w && y >= link.y && y <= link.y + link.h) {
      return link;
    }
  }
  return null;
}
