/**
 * @file ActionPopover.tsx
 * @description Action menu popover for the "+" button in PromptInput.
 *   Single popover with action ("Add current selection" + Layers icon) and
 *   skill list (unified Wand2 icon, single-line, ink-aligned divider).
 *   No search input. "+" uses fill-only state changes (no rotation).
 */

import { h } from 'preact';
import { Layers, Plus, Wand2 } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { useTranslations } from '../i18n';
import knowledgeIndex from '../../generated/knowledge-index.json';
import { usePopover } from '../hooks/usePopover';

interface ActionPopoverProps {
  onSerializeSelection: () => void;
  onInsertSkill?: (skillId: string) => void;
  disabled?: boolean;
}

type SkillSummary = {
  id: string;
  name: string;
};

const availableSkills: SkillSummary[] = (knowledgeIndex as Array<{
  id: string;
  name: string;
  category: string;
}>)
  .filter(entry => entry.category === 'skill')
  .map(entry => ({
    // knowledge-index normalizes skill ids to `skill:<id>`; UI inserts `@<skillId>`.
    id: entry.id.startsWith('skill:') ? entry.id.slice('skill:'.length) : entry.id,
    name: entry.name,
  }));

const rowIconStyle: h.JSX.CSSProperties = {
  color: tokens.colors.textSecondary,
  flexShrink: 0,
};
const rowLabelStyle: h.JSX.CSSProperties = {
  color: tokens.colors.textPrimary,
  fontSize: tokens.fontSize[1],
  fontWeight: tokens.fontWeight.regular,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: 1,
  minWidth: 0,
};

export function ActionPopover({ onSerializeSelection, onInsertSkill, disabled }: ActionPopoverProps) {
  const t = useTranslations();
  const { isOpen, ref, close, toggle, popoverClass } = usePopover();

  const handleAction = (action: () => void) => {
    action();
    close();
  };

  const showSkills = !!onInsertSkill && availableSkills.length > 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="header-icon-btn"
        onClick={() => !disabled && toggle()}
        style={{
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
          background: isOpen ? 'var(--gray-a3)' : undefined,
        }}
        disabled={disabled}
        aria-label={t.moreActions}
        aria-expanded={isOpen}
      >
        <Plus size={16} strokeWidth={1.5} />
      </button>

      {isOpen && (
        <div
          className={popoverClass}
          style={{
            position: 'absolute',
            bottom: `calc(100% + ${tokens.space[2]}px)`,
            left: 0,
            width: 240,
            maxWidth: 'calc(100vw - 24px)',
            zIndex: tokens.zIndex.popover,
          }}
        >
          <div style={{ padding: tokens.space[1] }}>
            <div
              className="popover-item"
              role="button"
              onClick={() => handleAction(onSerializeSelection)}
            >
              <Layers size={14} strokeWidth={1.5} style={rowIconStyle} />
              <span style={rowLabelStyle}>{t.copySelectionJson}</span>
            </div>

            {showSkills && (
              <div style={{
                height: 1,
                background: 'var(--gray-a4)',
                margin: '4px 8px',
              }} />
            )}

            {showSkills && availableSkills.map(skill => (
              <div
                key={skill.id}
                className="popover-item"
                role="button"
                onClick={() => handleAction(() => onInsertSkill!(skill.id))}
              >
                <Wand2 size={14} strokeWidth={1.5} style={rowIconStyle} />
                <span style={rowLabelStyle}>{skill.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
