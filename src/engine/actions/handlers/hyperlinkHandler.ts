import { PropertyHandler, Warning } from './types';

/**
 * Sets hyperlink on TEXT nodes.
 * Value format: "NODE:<nodeId>" for internal links, or a URL string for external links.
 */
export const hyperlinkHandler: PropertyHandler = {
  name: 'hyperlink',

  match(key, _value, node) {
    return key === 'hyperlink' && node.type === 'TEXT';
  },

  async apply(node, _key, value): Promise<Warning[]> {
    const str = String(value);
    let hyperlink: { type: 'URL' | 'NODE'; value: string };

    if (str.startsWith('NODE:')) {
      hyperlink = { type: 'NODE', value: str.slice(5) };
    } else {
      hyperlink = { type: 'URL', value: str };
    }

    try {
      (node as any).hyperlink = hyperlink;
      return [];
    } catch (e: any) {
      return [{
        code: 'HYPERLINK_FAILED',
        severity: 'warning',
        message: `Failed to set hyperlink: ${e?.message}`,
      }];
    }
  },
};
