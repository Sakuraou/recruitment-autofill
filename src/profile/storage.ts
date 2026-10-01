import { createEmptyProfile, profileSchema, type UserProfile } from './schema';

export const PROFILE_STORAGE_KEY = 'recruitment.profile.v1';
export function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local && chrome.runtime?.id);
}
async function localStorageArea() {
  if (!isExtensionContext()) throw new Error('请在已安装扩展的「我的档案」页面保存；普通网页预览不保存个人信息。');
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return chrome.storage.local;
}
export async function loadProfile(): Promise<UserProfile> {
  const storage = await localStorageArea();
  const data = await storage.get(PROFILE_STORAGE_KEY);
  const raw: unknown = data[PROFILE_STORAGE_KEY];
  return raw === undefined ? createEmptyProfile() : profileSchema.parse(raw);
}
export async function saveProfile(profile: UserProfile): Promise<UserProfile> {
  const valid = profileSchema.parse({ ...profile, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() });
  const storage = await localStorageArea();
  await storage.set({ [PROFILE_STORAGE_KEY]: valid });
  return valid;
}
