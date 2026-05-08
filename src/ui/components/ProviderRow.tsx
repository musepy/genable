/**
 * @file ProviderRow.tsx
 * @description One row in the Settings provider list. Click row to set active;
 * hover reveals a gear button that opens the edit form. Mirrors the layout
 * of tools/ui-preview/settings-ab-v2-protocol.html §2.
 */
import { h } from 'preact';
import { Settings as Gear } from 'lucide-preact';
import type { ProviderConfig } from '../../types/provider';

interface Props {
  config: ProviderConfig;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

/** Strip protocol scheme + trailing path noise for a compact baseURL display. */
function compactBaseURL(baseURL: string): string {
  return baseURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const PROTOCOL_LABEL: Record<ProviderConfig['protocol'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

export function ProviderRow({ config, isActive, onSelect, onEdit }: Props) {
  const meta = `${compactBaseURL(config.baseURL)}${config.modelId ? ` · ${config.modelId}` : ''}`;

  const handleRowClick = (e: h.JSX.TargetedEvent<HTMLDivElement>) => {
    // Don't toggle active when clicking the gear
    const target = e.target as HTMLElement;
    if (target.closest('.gear')) return;
    onSelect();
  };

  return (
    <div
      className={`provider-row ${isActive ? 'active' : ''}`}
      onClick={handleRowClick}
      role="radio"
      aria-checked={isActive}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="radio" aria-hidden="true" />
      <div className="provider-row-body">
        <div className="provider-row-top">
          <span className="provider-row-name" title={config.name}>{config.name}</span>
          <span className={`protocol-tag ${config.protocol}`}>{PROTOCOL_LABEL[config.protocol]}</span>
        </div>
        <div className="provider-row-meta" title={meta}>{meta}</div>
      </div>
      <button
        type="button"
        className="gear"
        aria-label={`Edit ${config.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <Gear size={12} strokeWidth={1.6} />
      </button>
    </div>
  );
}
