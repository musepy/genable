/**
 * @file NodeTypeIcon.tsx
 * @description Maps a Figma node type to its Figma-native layers-panel icon.
 * Paths sourced from @create-figma-plugin/ui (authoritative Figma icon set)
 * but inlined here so we control sizing (renders at 14px from a 16 viewBox).
 */

import { h } from 'preact';

/** Pixel size at which all chip icons render (Frame, Text, Close, etc.) */
export const ICON_SIZE = 14;

type IconPath = {
  d: string;
  /** Whether the SVG path uses fillRule/clipRule evenodd */
  evenodd?: boolean;
};

// Paths copied from @create-figma-plugin/ui/lib/icons/icon-16/*.js (viewBox 0 0 16 16).
const PATHS: Record<string, IconPath> = {
  FRAME: {
    d: 'M5.5 3c.27614 0 .5.22386.5.5V5h4V3.5c0-.27614.2239-.5.5-.5s.5.22386.5.5V5h1.5c.2761 0 .5.22386.5.5s-.2239.5-.5.5H11v4h1.5c.2761 0 .5.2239.5.5s-.2239.5-.5.5H11v1.5c0 .2761-.2239.5-.5.5s-.5-.2239-.5-.5V11H6v1.5c0 .2761-.22386.5-.5.5s-.5-.2239-.5-.5V11H3.5c-.27614 0-.5-.2239-.5-.5s.22386-.5.5-.5H5V6H3.5c-.27614 0-.5-.22386-.5-.5s.22386-.5.5-.5H5V3.5c0-.27614.22386-.5.5-.5m4.5 7V6H6v4z',
    evenodd: true,
  },
  TEXT: {
    d: 'M3 3.5c0-.27614.22386-.5.5-.5h9c.2761 0 .5.22386.5.5V5c0 .27614-.2239.5-.5.5S12 5.27614 12 5V4H8.5v8h1c.27614 0 .5.2239.5.5s-.22386.5-.5.5h-3c-.27614 0-.5-.2239-.5-.5s.22386-.5.5-.5h1V4H4v1c0 .27614-.22386.5-.5.5S3 5.27614 3 5z',
    evenodd: true,
  },
  COMPONENT: {
    d: 'M8 5.83824 6.66041 4.5 8 3.16176 9.33959 4.5zm-.43054-3.65987L5.6796 4.06632c-.23947.23922-.23947.62814 0 .86736l1.88986 1.88795c.23807.23783.62301.23783.86108 0l1.88986-1.88795c.2395-.23922.2395-.62814 0-.86736L8.43054 2.17837c-.23807-.23783-.62301-.23783-.86108 0M10.1618 8 11.5 6.66041 12.8382 8 11.5 9.33959zm-.98343.43054 1.88793 1.88986c.2392.2395.6282.2395.8674 0l1.8879-1.88986c.2379-.23807.2379-.62301 0-.86108L11.9337 5.6796c-.2392-.23947-.6282-.23947-.8674 0L9.17837 7.56946c-.23783.23807-.23783.62301 0 .86108M6.66041 11.5 8 12.8382 9.33959 11.5 8 10.1618zm-.98081-.4337 1.88986-1.88793c.23807-.23783.62301-.23783.86108 0l1.88986 1.88793c.2395.2392.2395.6282 0 .8674l-1.88986 1.8879c-.23807.2379-.62301.2379-.86108 0L5.6796 11.9337c-.23947-.2392-.23947-.6282 0-.8674M3.16176 8 4.5 6.66041 5.83824 8 4.5 9.33959zm-.98339.43054 1.88795 1.88986c.23922.2395.62814.2395.86736 0l1.88795-1.88986c.23783-.23807.23783-.62301 0-.86108L4.93368 5.6796c-.23922-.23947-.62814-.23947-.86736 0L2.17837 7.56946c-.23783.23807-.23783.62301 0 .86108',
    evenodd: true,
  },
  INSTANCE: {
    d: 'M7.29289 2.29289c.39053-.39052 1.02369-.39052 1.41422 0l4.99999 5c.3905.39053.3905 1.02369 0 1.41422L8.70711 13.7071c-.39053.3905-1.02369.3905-1.41422 0l-5-4.99999c-.39052-.39053-.39052-1.02369 0-1.41422zM3.70711 8.70711 3 8l.70711-.70711 3.58578-3.58578L8 3l.70711.70711 3.58579 3.58578L13 8l-.7071.70711-3.58579 3.58579L8 13l-.70711-.7071z',
    evenodd: true,
  },
  GROUP: {
    d: 'M3 4c0-.55228.44772-1 1-1 .27614 0 .5.22386.5.5S4.27614 4 4 4c0 .27614-.22386.5-.5.5S3 4.27614 3 4m2.5-.5c0-.27614.22386-.5.5-.5h1c.27614 0 .5.22386.5.5S7.27614 4 7 4H6c-.27614 0-.5-.22386-.5-.5m3 0c0-.27614.22386-.5.5-.5h1c.2761 0 .5.22386.5.5s-.2239.5-.5.5H9c-.27614 0-.5-.22386-.5-.5m3 0c0-.27614.2239-.5.5-.5.5523 0 1 .44772 1 1 0 .27614-.2239.5-.5.5S12 4.27614 12 4c-.2761 0-.5-.22386-.5-.5m-8 2c.27614 0 .5.22386.5.5v1c0 .27614-.22386.5-.5.5S3 7.27614 3 7V6c0-.27614.22386-.5.5-.5m9 0c.2761 0 .5.22386.5.5v1c0 .27614-.2239.5-.5.5S12 7.27614 12 7V6c0-.27614.2239-.5.5-.5m-9 3c.27614 0 .5.22386.5.5v1c0 .2761-.22386.5-.5.5S3 10.2761 3 10V9c0-.27614.22386-.5.5-.5m9 0c.2761 0 .5.22386.5.5v1c0 .2761-.2239.5-.5.5s-.5-.2239-.5-.5V9c0-.27614.2239-.5.5-.5m-9 3c.27614 0 .5.2239.5.5.27614 0 .5.2239.5.5s-.22386.5-.5.5c-.55228 0-1-.4477-1-1 0-.2761.22386-.5.5-.5m9 0c.2761 0 .5.2239.5.5 0 .5523-.4477 1-1 1-.2761 0-.5-.2239-.5-.5s.2239-.5.5-.5c0-.2761.2239-.5.5-.5m-7 1c0-.2761.22386-.5.5-.5h1c.27614 0 .5.2239.5.5s-.22386.5-.5.5H6c-.27614 0-.5-.2239-.5-.5m3 0c0-.2761.22386-.5.5-.5h1c.2761 0 .5.2239.5.5s-.2239.5-.5.5H9c-.27614 0-.5-.2239-.5-.5',
    evenodd: true,
  },
  SECTION: {
    d: 'M9 4h2.5c.2761 0 .5.22386.5.5v7c0 .2761-.2239.5-.5.5h-7c-.27614 0-.5-.2239-.5-.5V7h4.5c.27614 0 .5-.22386.5-.5zM8 4H4.5c-.27614 0-.5.22386-.5.5V6h4zm-5 .5C3 3.67157 3.67157 3 4.5 3h7c.8284 0 1.5.67157 1.5 1.5v7c0 .8284-.6716 1.5-1.5 1.5h-7c-.82843 0-1.5-.6716-1.5-1.5z',
    evenodd: true,
  },
  RECTANGLE: {
    d: 'M11.5 4h-7c-.27614 0-.5.22386-.5.5v7c0 .2761.22386.5.5.5h7c.2761 0 .5-.2239.5-.5v-7c0-.27614-.2239-.5-.5-.5m-7-1C3.67157 3 3 3.67157 3 4.5v7c0 .8284.67157 1.5 1.5 1.5h7c.8284 0 1.5-.6716 1.5-1.5v-7c0-.82843-.6716-1.5-1.5-1.5z',
    evenodd: true,
  },
  ELLIPSE: {
    d: 'M8 13c2.7614 0 5-2.2386 5-5 0-2.76142-2.2386-5-5-5-2.76142 0-5 2.23858-5 5 0 2.7614 2.23858 5 5 5m0 1c3.3137 0 6-2.6863 6-6 0-3.31371-2.6863-6-6-6-3.31371 0-6 2.68629-6 6 0 3.3137 2.68629 6 6 6',
    evenodd: true,
  },
  LINE: {
    d: 'M12.8536 3.14645c.1952.19526.1952.51184 0 .7071L3.85355 12.8536c-.19526.1952-.51184.1952-.7071 0-.19527-.1953-.19527-.5119 0-.7072l8.99995-8.99995c.1953-.19527.5119-.19527.7072 0',
  },
  POLYGON: {
    d: 'M7.99995 3a1 1 0 0 1 .87158.50974l4.50007 7.99996c.1741.3097.171.6885-.0084.9951-.1793.3067-.5079.4952-.8632.4952h-9a1 1 0 0 1-.86321-.4952c-.17935-.3066-.18254-.6854-.00837-.9951l4.49996-7.99996A1 1 0 0 1 7.99995 3m.00001 1-.57367 1.01987L4.06249 11 3.5 12h9l-.5625-1-3.36387-5.98014z',
    evenodd: true,
  },
  STAR: {
    d: 'M8.00047 2c.43462 0 .81948.28073.95222.69459L9.85248 5.5h2.90332c.435 0 .8202.28133.9526.6958.1323.41447-.0185.86695-.3731 1.11912l-2.3279 1.65561.9379 2.70147c.142.4093.0044.8636-.341 1.1252-.3454.2615-.8199.271-1.1754.0233l-2.42841-1.6919-2.42826 1.6919c-.35548.2477-.83002.2383-1.1754-.0233s-.48305-.7158-.34098-1.1251l.9377-2.70154-2.32794-1.65564c-.35456-.25217-.50539-.70465-.37303-1.11912S2.8101 5.5 3.24519 5.5h2.90327l.89979-2.80541C7.18099 2.28073 7.56585 2 8.00047 2M6.8779 6.5H3.24519l1.40607 1 1.53285 1.09017-.62556 1.80223L5.00056 12l1.39618-.9728 1.60373-1.11737 1.60385 1.11737L11.0006 12l-.5581-1.6076-.62567-1.80223L11.3497 7.5l1.4061-1H9.12304l-.59748-1.86286L8.00047 3l-.52509 1.63714z',
  },
  LIBRARY: {
    d: 'M7.41091 5.14527c-.94722-.84197-2.3746-.84197-3.32182 0L4 5.22446v5.75774c1.08026-.6245 2.41974-.6245 3.5 0V5.22446zM8.5 5.22446v5.75774c1.08026-.6245 2.4197-.6245 3.5 0V5.22446l-.0891-.07919c-.9472-.84197-2.37459-.84197-3.32181 0zM8 4.33282c-1.32551-1.1133-3.27403-1.09162-4.57527.06504l-.25691.22836A.5.5 0 0 0 3 4.99993v6.99997c0 .1969.11556.3755.29517.4561a.4999.4999 0 0 0 .53701-.0824l.25691-.2283c.94722-.842 2.3746-.842 3.32182 0l.25691.2283c.18944.1684.47492.1684.66436 0l.25691-.2283c.94722-.842 2.37461-.842 3.32181 0l.2569.2283c.1472.1308.3574.1631.537.0824A.5.5 0 0 0 13 11.9999V4.99993a.5002.5002 0 0 0-.1678-.37371l-.2569-.22836C11.274 3.2412 9.32551 3.21952 8 4.33282',
    evenodd: true,
  },
  CLOSE: {
    d: 'M4.14645 4.14645c.19526-.19527.51184-.19527.7071 0L8 7.29289l3.1464-3.14644c.1953-.19527.5119-.19527.7072 0 .1952.19526.1952.51184 0 .7071L8.70711 8l3.14649 3.1464c.1952.1953.1952.5119 0 .7072-.1953.1952-.5119.1952-.7072 0L8 8.70711 4.85355 11.8536c-.19526.1952-.51184.1952-.7071 0-.19527-.1953-.19527-.5119 0-.7072L7.29289 8 4.14645 4.85355c-.19527-.19526-.19527-.51184 0-.7071',
    evenodd: true,
  },
};

// Node types that are semantically Frames in Figma layers (AUTO_LAYOUT_FRAME, etc. all use frame icon)
const FRAME_TYPES = new Set(['FRAME', 'AUTO_LAYOUT', 'COMPONENT_SET']);
const VECTOR_TYPES = new Set(['VECTOR', 'BOOLEAN_OPERATION']);

/** Pick which path best represents a given Figma node type. */
export function pathForNodeType(nodeType: string): IconPath {
  if (nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET') return PATHS.COMPONENT;
  if (nodeType === 'INSTANCE') return PATHS.INSTANCE;
  if (nodeType === 'TEXT') return PATHS.TEXT;
  if (nodeType === 'GROUP') return PATHS.GROUP;
  if (nodeType === 'SECTION') return PATHS.SECTION;
  if (nodeType === 'RECTANGLE') return PATHS.RECTANGLE;
  if (nodeType === 'ELLIPSE') return PATHS.ELLIPSE;
  if (nodeType === 'LINE') return PATHS.LINE;
  if (nodeType === 'POLYGON') return PATHS.POLYGON;
  if (nodeType === 'STAR') return PATHS.STAR;
  if (VECTOR_TYPES.has(nodeType)) return PATHS.POLYGON;
  if (FRAME_TYPES.has(nodeType)) return PATHS.FRAME;
  return PATHS.FRAME;
}

export function isComponentType(nodeType: string): boolean {
  return nodeType === 'COMPONENT' || nodeType === 'COMPONENT_SET' || nodeType === 'INSTANCE';
}

interface IconProps {
  size?: number;
  style?: h.JSX.CSSProperties;
}

function renderPath(path: IconPath): h.JSX.Element {
  const pathProps: Record<string, string> = { d: path.d, fill: 'currentColor' };
  if (path.evenodd) {
    pathProps['fill-rule'] = 'evenodd';
    pathProps['clip-rule'] = 'evenodd';
  }
  return <path {...pathProps} />;
}

function makeIcon(path: IconPath) {
  return function Icon({ size = ICON_SIZE, style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        style={{ display: 'block', flexShrink: 0, ...style }}
      >
        {renderPath(path)}
      </svg>
    );
  };
}

/** Icon for a specific Figma node type (FRAME/TEXT/COMPONENT/…). */
export function NodeTypeIcon({ nodeType, size = ICON_SIZE, style }: { nodeType: string } & IconProps) {
  return makeIcon(pathForNodeType(nodeType))({ size, style });
}

/** Book icon used for skill/knowledge attachments. */
export const SkillIcon = makeIcon(PATHS.LIBRARY);

/** Figma-native close (X) — same stroke language as node icons. */
export const CloseIcon = makeIcon(PATHS.CLOSE);

/** Page icon for page attachments. */
export const PageIcon = makeIcon(PATHS.SECTION);
