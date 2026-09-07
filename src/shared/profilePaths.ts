import type { UserProfile } from '../profile/schema';

export function getPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
export function updatePath(profile: UserProfile, path: string, value: unknown): UserProfile {
  const result = structuredClone(profile);
  const parts = path.split('.');
  let current = result as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (current[part] === undefined) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const key = parts.at(-1);
  if (key) current[key] = value;
  return result;
}
