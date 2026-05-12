/**
 * @file ProviderRow.tsx
 * @description One row in the Settings provider list. Click row to set active;
 * hover reveals a chevron-right that opens the edit form. Layout settled in
 * tools/ui-preview/settings-refactor-ab.html v3.
 */
import { h } from 'preact';
import { ChevronRight } from 'lucide-preact';
import type { ProviderConfig } from '../../types/provider';

interface Props {
  config: ProviderConfig;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

function compactBaseURL(baseURL: string): string {
  return baseURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function ProviderRow({ config, isActive, onSelect, onEdit }: Props) {
  const host = compactBaseURL(config.baseURL);
  const model = config.modelId;

  const handleRowClick = (e: h.JSX.TargetedEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.row-chevron')) return;
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
        <div className="provider-row-name" title={config.name}>{config.name}</div>
        <div className="provider-row-meta">
          <span className="provider-row-meta-host">{host}</span>
          {model && <span className="provider-row-meta-model">{model}</span>}
        </div>
      </div>
      <button
        type="button"
        className="row-chevron"
        aria-label={`Edit ${config.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <ChevronRight size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
