/**
 * @file userSkillsStore.ts
 * @description Module-level singleton store for user-imported skills (design.md
 *   library). Single source of truth that both the popover hook and the
 *   sandbox-side skill executor read from.
 *
 * Lifecycle:
 *   1. UI boots → calls `bootstrapUserSkills()` once → emits LOAD_USER_SKILLS.
 *   2. Main thread responds with USER_SKILLS_LOADED → store caches the list +
 *      notifies subscribers.
 *   3. Mutations (`addUserSkill` / `deleteUserSkill`) emit IPC, then rely on
 *      main's broadcast back to refresh the cache (no optimistic update — keep
 *      single source of truth).
 *
 * The synchronous `getUserSkillContent(id)` is the read path used by the
 * `skill` tool executor in useChat: by the time the agent calls a `user:*`
 * id, the popover already loaded it from the cache.
 */

import { useState, useEffect } from 'preact/hooks';
import { emit, on } from '@create-figma-plugin/utilities';
import type {
  UserSkillRecord,
  UserSkillsLoadedHandler,
  LoadUserSkillsHandler,
  SaveUserSkillHandler,
  DeleteUserSkillHandler,
} from '../types';

let cache: UserSkillRecord[] = [];
let booted = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

/** Call once at UI boot. Idempotent. */
export function bootstrapUserSkills() {
  if (booted) return;
  booted = true;
  on<UserSkillsLoadedHandler>('USER_SKILLS_LOADED', ({ skills }) => {
    cache = Array.isArray(skills) ? skills : [];
    notify();
  });
  emit<LoadUserSkillsHandler>('LOAD_USER_SKILLS');
}

/** Synchronous read — used by useChat skill executor. Returns undefined if id unknown. */
export function getUserSkillContent(id: string): string | undefined {
  return cache.find(s => s.id === id)?.content;
}

/** Synchronous list — also used by tools that need a catalog (future). */
export function listUserSkills(): UserSkillRecord[] {
  return cache;
}

export function addUserSkill(name: string, content: string, source: 'imported' | 'canvas') {
  emit<SaveUserSkillHandler>('SAVE_USER_SKILL', { name, content, source });
}

export function deleteUserSkill(id: string) {
  emit<DeleteUserSkillHandler>('DELETE_USER_SKILL', { id });
}

/** Reactive hook for components — subscribes to cache changes. */
export function useUserSkills(): UserSkillRecord[] {
  const [snapshot, setSnapshot] = useState(cache);
  useEffect(() => {
    const cb = () => setSnapshot(cache);
    subscribers.add(cb);
    // ensure boot has run (covers case where component mounts before app boot)
    bootstrapUserSkills();
    return () => {
      subscribers.delete(cb);
    };
  }, []);
  return snapshot;
}
