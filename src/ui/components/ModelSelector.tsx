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
      <div style={{ 
        padding: tokens.space[4], // Migrated from space.md 
        textAlign: 'center', 
        color: tokens.colors.textSecondary,
      }}>
        <div className="loading-dots" style={{ justifyContent: 'center', display: 'flex' }}>
          <span></span><span></span><span></span>
        </div>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div style={{ 
        padding: tokens.space[4], // Migrated from space.md 
        border: `1px dashed ${tokens.colors.grayBorder}`, 
        borderRadius: 'var(--radius-2)', 
        textAlign: 'center',
        color: tokens.colors.textSecondary,
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
        // No gap - avoid unnecessary visual separators
      }}
    >
      {sortedModels.map((model, index) => {
        const normalize = (name: string) => name.toLowerCase().replace(/models\//, '').replace(/[^a-z0-p]/g, '').replace(/30/g, '3').replace(/25/g, '2');
        const isSelected = normalize(selectedModel) === normalize(model.name);
        
        // No fallback - only highlight the actually selected model
        const shouldHighlight = isSelected;
        
        const isHovered = hoveredModel === index;
        
        // Background logic: selected (step 4) > hover (step 3) for proper visual weight
        const background = shouldHighlight 
          ? tokens.colors.surfaceHover  // gray-4: selected needs more weight
          : isHovered 
            ? tokens.colors.surface      // gray-3: hover is lighter
            : 'transparent';
        
        return (
          <div
            key={`${model.name}-${index}`}
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
            onMouseEnter={() => setHoveredModel(index)}
            onMouseLeave={() => setHoveredModel(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: `${tokens.space[2]}px ${tokens.space[2]}px`, // Radix space[2] (8px)
              minHeight: tokens.space[6], // Radix space[6] (32px)
              borderRadius: 'var(--radius-2)',
              cursor: 'pointer',
              background,
              transition: 'var(--transition-crisp)',
            }}
          >
            <span style={{ 
              fontSize: tokens.fontSize[1], // Same as trigger (12px)
              color: tokens.colors.textPrimary,  // Unified color, no change on selection
              fontWeight: tokens.fontWeight.normal,  // No font-weight change
            }}>
              {model.displayName || model.name}
            </span>
            {/* Check icon removed - background color is sufficient indicator */}
          </div>
        );
      })}
    </div>
  );
}
