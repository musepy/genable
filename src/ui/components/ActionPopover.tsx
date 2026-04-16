/**
 * @file ActionPopover.tsx
 * @description Action menu popover for the "+" button in PromptInput
 */

import { h } from 'preact';
import { useState } from 'preact/hooks';
import { Code, Plus, Search } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import { useTranslations } from '../i18n';
import skillRegistry from '../../generated/skills-registry.json';
import { Input } from './Input';
import { usePopover } from '../hooks/usePopover';

interface ActionPopoverProps {
  onSerializeSelection: () => void;
  onInsertSkill?: (skillId: string) => void;
  disabled?: boolean;
}

type SkillSummary = {
  id: string;
  name: string;
  description: string;
};

const availableSkills: SkillSummary[] = Object.values(skillRegistry as Record<string, any>)
  .map((entry: any) => ({
    id: entry.id || entry.frontmatter?.id || '',
    name: entry.name || entry.frontmatter?.name || entry.id || 'Unknown Skill',
    description: entry.description || entry.frontmatter?.description || '',
  }))
  .filter(entry => entry.id)

function searchSkills(query: string): SkillSummary[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return availableSkills.slice(0, 6)
  return availableSkills
    .filter(skill => {
      const haystack = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase()
      return haystack.includes(normalized)
    })
    .slice(0, 6)
}

export function ActionPopover({ onSerializeSelection, onInsertSkill, disabled }: ActionPopoverProps) {
  const t = useTranslations();
  const { isOpen, isClosing, ref, close, toggle, popoverClass } = usePopover();
  const [skillQuery, setSkillQuery] = useState('');

  const handleAction = (action: () => void) => {
    action();
    close();
  };

  const skillResults = searchSkills(skillQuery)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger Button */}
      <button
        className="header-icon-btn"
        onClick={() => !disabled && toggle()}
        style={{
          transition: 'var(--transition-normal)',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
        disabled={disabled}
        aria-label={t.moreActions}
        aria-expanded={isOpen}
      >
        <Plus size={16} strokeWidth={1.5} />
      </button>

      {/* Popover Content */}
      {isOpen && (
        <div
          className={popoverClass}
          style={{
            position: 'absolute',
            bottom: `calc(100% + ${tokens.space[2]}px)`,
            left: 0,
            width: 260,
            zIndex: tokens.zIndex.popover,
          }}
        >
          <div style={{ padding: tokens.space[1] }}>
            <div
              className="popover-item"
              onClick={() => handleAction(onSerializeSelection)}
            >
              <Code size={14} />
              <span>{t.copySelectionJson}</span>
            </div>

            {onInsertSkill && (
              <div style={{
                marginTop: tokens.space[1],
                paddingTop: tokens.space[1],
                borderTop: 'var(--border-subtle)',
              }}>
                <div style={{ marginBottom: tokens.space[1] }}>
                  <Input
                    value={skillQuery}
                    onInput={(e) => setSkillQuery((e.currentTarget as HTMLInputElement).value)}
                    placeholder={t.searchSkills}
                    leftElement={<Search size={12} strokeWidth={2} style={{ color: tokens.colors.textSecondary }} />}
                    style={{
                      height: 30,
                      borderRadius: 'var(--radius-4)',
                      background: tokens.colors.surface,
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.space[1], maxHeight: 180, overflowY: 'auto' }}>
                  {skillResults.length === 0 ? (
                    <div style={{
                      color: tokens.colors.textSecondary,
                      fontSize: tokens.fontSize[1],
                      padding: `${tokens.space[2]}px ${tokens.space[2]}px`,
                    }}>
                      {t.noMatchingSkills}
                    </div>
                  ) : (
                    skillResults.map(skill => (
                      <button
                        key={skill.id}
                        className="popover-item popover-item-multi"
                        onClick={() => handleAction(() => onInsertSkill(skill.id))}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                          <span style={{
                            color: tokens.colors.textPrimary,
                            fontSize: tokens.fontSize[1],
                            fontWeight: tokens.fontWeight.medium,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {skill.name}
                          </span>
                          <span style={{
                            color: tokens.colors.textSecondary,
                            fontSize: tokens.fontSize[1],
                            lineHeight: '14px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: 210,
                          }}>
                            @{skill.id}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
