/**
 * @file ActionPopover.tsx
 * @description Action menu popover for the "+" button in PromptInput.
 *   Single popover with action ("Add current selection" + Layers icon) and
 *   skill list (unified Wand2 icon, single-line, ink-aligned divider).
 *   No search input. "+" uses fill-only state changes (no rotation).
 */

import { h } from 'preact';
import { useRef } from 'preact/hooks';
import { FileText, Layers, Plus, Upload, Wand2, X } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { useTranslations } from '../i18n';
import knowledgeIndex from '../../generated/knowledge-index.json';
import { usePopover } from '../hooks/usePopover';
import { addUserSkill, deleteUserSkill, useUserSkills } from '../userSkillsStore';

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
  const userSkills = useUserSkills();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAction = (action: () => void) => {
    action();
    close();
  };

  const handleFilePick = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result ?? '');
      // Strip ".md" extension for display name; user can edit later (future).
      const baseName = file.name.replace(/\.(md|markdown)$/i, '') || file.name;
      addUserSkill(baseName, content, 'imported');
    };
    reader.readAsText(file);
    target.value = ''; // allow re-importing the same filename later
  };

  const showBuiltinSkills = !!onInsertSkill && availableSkills.length > 0;
  const showUserSkills = !!onInsertSkill;

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

            {showBuiltinSkills && (
              <div style={{
                height: 1,
                background: 'var(--gray-a4)',
                margin: '4px 8px',
              }} />
            )}

            {showBuiltinSkills && availableSkills.map(skill => (
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

            {showUserSkills && (
              <div style={{
                height: 1,
                background: 'var(--gray-a4)',
                margin: '4px 8px',
              }} />
            )}

            {showUserSkills && userSkills.map(skill => (
              <div
                key={skill.id}
                className="popover-item"
                role="button"
                onClick={() => handleAction(() => onInsertSkill!(skill.id))}
                style={{ position: 'relative' }}
              >
                <FileText size={14} strokeWidth={1.5} style={rowIconStyle} />
                <span style={rowLabelStyle}>{skill.name}</span>
                <button
                  aria-label={`Remove ${skill.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteUserSkill(skill.id);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: tokens.colors.textSecondary,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </div>
            ))}

            {showUserSkills && (
              <div
                className="popover-item"
                role="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={14} strokeWidth={1.5} style={rowIconStyle} />
                <span style={{ ...rowLabelStyle, color: tokens.colors.textSecondary }}>
                  Add design.md…
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        style={{ display: 'none' }}
        onChange={handleFilePick}
      />
    </div>
  );
}
