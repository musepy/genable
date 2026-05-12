/**
 * @file userSkillsHandler.ts
 * @description IPC handlers for user-imported skills (design.md library).
 *
 * Storage model:
 *   USER_SKILLS_V1 in figma.clientStorage → JSON.stringify(UserSkillRecord[])
 *
 * Lives per-user x per-plugin (NOT per-document) — by design: user wants the
 * same brand library available across every Figma file they open with this
 * plugin.
 */

import { emit } from '@create-figma-plugin/utilities';
import {
  UserSkillRecord,
  UserSkillsLoadedHandler,
  SendLogHandler,
} from '../../types';

const STORAGE_KEY = 'USER_SKILLS_V1';

// 10 KB per skill — design.md spec example is ~40 lines (~1KB); 10x leaves room
// for richer prose without enabling abuse / memory bloat.
const MAX_SKILL_BYTES = 10_000;
// 64 entries — covers heavy users (one brand per side project) without unbounded growth.
const MAX_SKILL_COUNT = 64;

async function readAll(): Promise<UserSkillRecord[]> {
  const raw = await figma.clientStorage.getAsync(STORAGE_KEY);
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(skills: UserSkillRecord[]): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY, JSON.stringify(skills));
}

function broadcast(skills: UserSkillRecord[]) {
  emit<UserSkillsLoadedHandler>('USER_SKILLS_LOADED', { skills });
}

function sanitizeName(rawName: string): string {
  // Display name — preserve the user's chosen wording; only trim + length-cap.
  const trimmed = rawName.trim().slice(0, 60);
  return trimmed || 'Untitled';
}

function makeId(name: string): string {
  // user:<slug>-<short-rand> — slug from display name; suffix avoids collisions.
  const lower = name.toLowerCase();
  const slugged = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = (slugged || 'skill').slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 6);
  return `user:${slug}-${rand}`;
}

export async function handleLoadUserSkills(): Promise<void> {
  const skills = await readAll();
  broadcast(skills);
}

export async function handleSaveUserSkill(data: {
  name: string;
  content: string;
  source: 'imported' | 'canvas';
}): Promise<void> {
  const name = sanitizeName(data.name || 'Untitled');
  const content = String(data.content ?? '');
  if (content.length > MAX_SKILL_BYTES) {
    emit<SendLogHandler>('SEND_LOG', {
      message: `Design.md too large (${content.length} bytes, max ${MAX_SKILL_BYTES}).`,
      type: 'warn',
    });
    return;
  }

  const skills = await readAll();
  if (skills.length >= MAX_SKILL_COUNT) {
    emit<SendLogHandler>('SEND_LOG', {
      message: `User skill library full (${MAX_SKILL_COUNT} entries). Delete one before adding more.`,
      type: 'warn',
    });
    return;
  }

  const record: UserSkillRecord = {
    id: makeId(name),
    name,
    content,
    createdAt: Date.now(),
    source: data.source,
  };
  skills.push(record);
  await writeAll(skills);
  broadcast(skills);
}

export async function handleDeleteUserSkill(data: { id: string }): Promise<void> {
  const skills = await readAll();
  const next = skills.filter(s => s.id !== data.id);
  if (next.length === skills.length) return; // no-op if id missing
  await writeAll(next);
  broadcast(next);
}
