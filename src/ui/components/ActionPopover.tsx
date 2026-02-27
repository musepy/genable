/**
 * @file ActionPopover.tsx
 * @description Action menu popover for the "+" button in PromptInput
 */

import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Code, Plus, Search } from 'lucide-preact';
import { tokens } from '../design-system/tokens';
import skillRegistry from '../../generated/skills-registry.json';

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
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || isClosing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 150);
  };

  const handleAction = (action: () => void) => {
    action();
    handleClose();
  };

  const skillResults = searchSkills(skillQuery)

  return (
    <div ref={popoverRef} style={{ position: 'relative' }}>
      {/* Trigger Button */}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-5)',
          cursor: disabled ? 'default' : 'pointer',
          color: tokens.colors.textSecondary,
          transition: 'background 200ms ease, transform 200ms ease',
          transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = tokens.colors.alpha[2];
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
        aria-label="More actions"
        aria-expanded={isOpen}
      >
        <Plus size={20} strokeWidth={1.5} />
      </button>

      {/* Popover Content */}
      {isOpen && (
        <div
          className={isClosing ? 'popover-content-exit' : 'popover-content'}
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
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
              <span>Copy Selection as JSON</span>
            </div>

            {onInsertSkill && (
              <div style={{
                marginTop: tokens.space[1],
                paddingTop: tokens.space[1],
                borderTop: `1px solid ${tokens.colors.alpha[3]}`,
              }}>
                <div style={{ position: 'relative', marginBottom: tokens.space[1] }}>
                  <Search
                    size={12}
                    strokeWidth={2}
                    style={{
                      position: 'absolute',
                      left: tokens.space[2],
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: tokens.colors.textSecondary,
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    value={skillQuery}
                    onInput={(e) => setSkillQuery((e.currentTarget as HTMLInputElement).value)}
                    placeholder="Search skills..."
                    style={{
                      width: '100%',
                      height: 30,
                      border: `1px solid ${tokens.colors.alpha[4]}`,
                      borderRadius: 'var(--radius-4)',
                      background: tokens.colors.surface,
                      color: tokens.colors.textPrimary,
                      fontSize: tokens.fontSize[1],
                      padding: `0 ${tokens.space[2]}px 0 ${tokens.space[4] + tokens.space[2]}px`,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
                  {skillResults.length === 0 ? (
                    <div style={{
                      color: tokens.colors.textSecondary,
                      fontSize: tokens.fontSize[1],
                      padding: `${tokens.space[2]}px ${tokens.space[2]}px`,
                    }}>
                      No matching skills.
                    </div>
                  ) : (
                    skillResults.map(skill => (
                      <button
                        key={skill.id}
                        className="popover-item"
                        onClick={() => handleAction(() => onInsertSkill(skill.id))}
                        style={{
                          width: '100%',
                          height: 'auto',
                          minHeight: 34,
                          justifyContent: 'flex-start',
                          background: 'transparent',
                          border: 'none',
                          textAlign: 'left',
                          paddingTop: 6,
                          paddingBottom: 6,
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                          <span style={{
                            color: tokens.colors.textPrimary,
                            fontSize: tokens.fontSize[1],
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {skill.name}
                          </span>
                          <span style={{
                            color: tokens.colors.textSecondary,
                            fontSize: 11,
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
