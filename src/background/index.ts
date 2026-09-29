import { loadProfile } from '../profile/storage';
import { projectProjectionRequestSchema, projectProfile } from '../profile/projection';

async function restrictStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
chrome.runtime.onInstalled.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
chrome.runtime.onStartup.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: unknown) => void) => {
  const parsed = projectProjectionRequestSchema.safeParse(message);
  if (!parsed.success) return false;
  const pageUrl = sender.url ?? sender.tab?.url ?? '';
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !/^https?:\/\//u.test(pageUrl)) {
    sendResponse({ ok: false, error: '不可信的档案投影请求' });
    return false;
  }
  void loadProfile()
    .then(profile => sendResponse({ ok: true, data: projectProfile(profile) }))
    .catch(() => sendResponse({ ok: false, error: '无法读取本地档案' }));
  return true;
});
