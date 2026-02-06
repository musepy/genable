/**
 * @file ModelSelector.tsx
 * @description Model selector with proper hover/selected states
 * 
 * Design Principles:
 * - No persistent borders (use background color for selection)
 * - Hover feedback with gray-3 background
 * - Selected state with muted background + checkmark
 * - Gap-based separation instead of border-bottom
 */

import { h } from 'preact';
import { Check } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { tokens } from '../design-system/tokens';
import { sortModels } from '../constants/models';

interface ModelItem {
  name: string;
  displayName: string;
}

interface ModelSelectorProps {
  models: ModelItem[];
  selectedModel: string;
  onSelect: (modelName: string) => void;
  isLoading?: boolean;
}

export function ModelSelector({
  models,
  selectedModel,
  onSelect,
  isLoading
}: ModelSelectorProps) {
  const [hoveredModel, setHoveredModel] = useState<number | null>(null);
  
  if (isLoading) {
    return (
      <div 
        role="status" 
        aria-label="Loading models"
        style={{ 
          display: 'flex', 
          flexDirection: 'column',
          gap: tokens.space[1],
        }}
      >
        {/* Skeleton 占位器 - 3 个模型的骨架 */}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="skeleton-item"
            style={{
              height: 32,
              borderRadius: 'var(--radius-4)',
              background: 'var(--gray-a2)',
              animation: 'skeleton-pulse 1.5s ease-in-out infinite',
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (models.length === 0) {
    return (
    <div style={{ 
        padding: tokens.space[3], 
        border: 'var(--border-main)', 
        borderRadius: 'var(--radius-5)', 
        textAlign: 'center',
        color: 'var(--gray-9)',
        fontSize: tokens.fontSize[1],
      }}>
        Enter API Key to load models
      </div>
    );
  }

  // Sort: selected first, then by version
  const sortedModels = sortModels(models, selectedModel);

  return (
    <div 
      role="listbox"
      aria-label="Select AI model"
      style={{ 
        display: 'flex', 
        flexDirection: 'column',
        gap: tokens.space[1],
      }}
    >
      {sortedModels.map((model, index) => {
        const normalize = (name: string) => name.toLowerCase().replace(/models\//, '').replace(/[^a-z0-9]/g, '');
        const isSelected = normalize(selectedModel) === normalize(model.name);
        const shouldHighlight = isSelected || (index === 0 && !sortedModels.some(m => normalize(selectedModel) === normalize(m.name)));
        
        return (
          <div
            key={model.name}
            className={`model-item ${shouldHighlight ? 'is-selected' : ''}`}
            role="option"
            aria-selected={shouldHighlight}
            tabIndex={0}
            onClick={() => onSelect(model.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(model.name);
              }
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--gray-a2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `var(--space-1) var(--space-3) var(--space-1) var(--space-2)`, // Reduced vertical padding to 4px
              minHeight: 32,
              borderRadius: 'var(--radius-4)', // Slightly smaller radius for more compact look
              cursor: 'pointer',
              background: 'transparent',
              transition: 'var(--transition-crisp)',
              gap: tokens.space[2],
            }}
          >
            <span style={{ 
              fontSize: tokens.fontSize[1],
              color: 'var(--gray-11)',
              fontWeight: 400,
              lineHeight: '16px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {model.displayName || model.name}
            </span>
            {shouldHighlight && (
              <Check size={14} strokeWidth={2.5} style={{ marginLeft: 'auto', color: 'var(--gray-11)' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
