import { loadProfile, PROFILE_STORAGE_KEY } from '../profile/storage';
import { projectProjectionRequestSchema, projectProfile } from '../profile/projection';
import { educationProjectionRequestSchema, educationProfile } from '../profile/educationProjection';
import { internshipProjectionRequestSchema, internshipProfile } from '../profile/internshipProjection';
import { awardProjectionRequestSchema, awardProfile } from '../profile/awardProjection';
import { publicationProjectionRequestSchema, publicationProfile } from '../profile/publicationProjection';
import { AI_CONNECTION_KEY } from '../ai/connection';
import { clearSessionSemanticRecipes } from '../ai/sessionRecipes';
import { createRecordSemanticPortHandler } from './recordSemanticPort';

chrome.runtime.onConnect.addListener(createRecordSemanticPortHandler());

async function restrictStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
chrome.runtime.onInstalled.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
chrome.runtime.onStartup.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[PROFILE_STORAGE_KEY] || changes[AI_CONNECTION_KEY])) void clearSessionSemanticRecipes();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: unknown) => void) => {
  const parsed = projectProjectionRequestSchema.or(educationProjectionRequestSchema).or(internshipProjectionRequestSchema).or(awardProjectionRequestSchema).or(publicationProjectionRequestSchema).safeParse(message);
  if (!parsed.success) return false;
  const pageUrl = sender.url ?? sender.tab?.url ?? '';
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !/^https?:\/\//u.test(pageUrl)) {
    sendResponse({ ok: false, error: '不可信的档案投影请求' });
    return false;
  }
  if (['RA_PROFILE_INTERNSHIP','RA_PROFILE_AWARDS','RA_PROFILE_PUBLICATIONS'].includes(parsed.data.type) && (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab.id) || sender.tab.id <= 0)) {
    sendResponse({ ok: false, error: '不可信的档案投影请求' }); return false;
  }
  void loadProfile()
    .then(profile => sendResponse({ ok: true, data: parsed.data.type === 'RA_PROFILE_EDUCATION'
      ? educationProfile(profile) : parsed.data.type === 'RA_PROFILE_INTERNSHIP' ? internshipProfile(profile)
        : parsed.data.type === 'RA_PROFILE_AWARDS' ? awardProfile(profile)
          : parsed.data.type === 'RA_PROFILE_PUBLICATIONS' ? publicationProfile(profile) : projectProfile(profile) }))
    .catch(() => sendResponse({ ok: false, error: '无法读取本地档案' }));
  return true;
});
