import { createLatestLocalRefresh } from '../ai/latestLocalRefresh';
import { hasVisualRequestConsent, loadVisualConsent, VISUAL_SETTINGS_KEY } from '../ai/visualSettings';
import { resolveActiveCaptureContext } from '../visual/activeCaptureContext';
import { loadProfile, PROFILE_STORAGE_KEY } from '../profile/storage';
import { projectProjectionRequestSchema, projectProfile } from '../profile/projection';
import { educationProjectionRequestSchema, educationProfile } from '../profile/educationProjection';
import { internshipProjectionRequestSchema, internshipProfile } from '../profile/internshipProjection';
import { awardProjectionRequestSchema, awardProfile } from '../profile/awardProjection';
import { publicationProjectionRequestSchema, publicationProfile } from '../profile/publicationProjection';
import { studentWorkProjectionRequestSchema, studentWorkProfile } from '../profile/studentWorkProjection';
import { AI_CONNECTION_KEY, loadAiConnection, type AiConnection } from '../ai/connection';
import { clearSessionSemanticRecipes } from '../ai/sessionRecipes';
import { semanticRedactor } from '../ai/semanticPrivacy';
import { createVisualLoopbackProvider } from '../ai/visualLoopbackProvider';
import { createRecordSemanticPortHandler } from './recordSemanticPort';
import { createVisualSemanticPortHandler } from './visualSemanticPort';
import { installMv3CaptureBackground } from '../visual/mv3CaptureBackgroundInstaller';

chrome.runtime.onConnect.addListener(createRecordSemanticPortHandler());
let captureContextRevision = 0;
chrome.tabs.onActivated.addListener(() => { captureContextRevision++; });
chrome.tabs.onUpdated.addListener((_tabId, change) => { if (change.url || change.status === 'loading') captureContextRevision++; });
chrome.tabs.onRemoved.addListener(() => { captureContextRevision++; });
chrome.windows.onFocusChanged.addListener(() => { captureContextRevision++; });
// The isolated runtime copy wires the trusted popup port to the MV3 capture adapter.
// The adapter keeps activeTab capture behind sender, HTTPS-tab, and context checks.
installMv3CaptureBackground(
  chrome.runtime,
  {
    captureVisibleTab: (windowId, options, callback) => { chrome.tabs.captureVisibleTab(windowId, options, callback); },
    getActiveTabContext: () => resolveActiveCaptureContext({
      revision: () => captureContextRevision,
      getBrowserWindow: () => chrome.windows.getLastFocused({ windowTypes: ['normal'] }),
      getActiveTabs: windowId => chrome.tabs.query({ active: true, windowId }),
    }),
  },
  chrome.runtime.id,
  chrome.runtime.getURL('popup.html'),
);

let cachedVisualConsent: unknown;
let cachedAiConnection: AiConnection | undefined;
let cachedProfile: Awaited<ReturnType<typeof loadProfile>> | undefined;
const refreshVisualState = createLatestLocalRefresh(
  () => Promise.all([loadVisualConsent(), loadAiConnection(), loadProfile()]),
  state => {
    cachedVisualConsent = state?.[0]; cachedAiConnection = state?.[1]; cachedProfile = state?.[2];
  },
);
void refreshVisualState();
chrome.runtime.onConnect.addListener(createVisualSemanticPortHandler({
  extensionId: chrome.runtime.id,
  enabled: () => hasVisualRequestConsent(cachedAiConnection, cachedVisualConsent) && cachedProfile !== undefined,
  userConfirmed: () => cachedAiConnection?.userConfirmed === true,
  redactRequest: request => {
    if (!cachedProfile) return request;
    const redact = semanticRedactor(cachedProfile);
    return { ...request, fields: request.fields.map(field => ({ ...field,
      label: redact(field.label), ariaLabel: redact(field.ariaLabel), tableHeader: redact(field.tableHeader), title: redact(field.title), placeholder: redact(field.placeholder),
      options: field.options.map(option => ({ ...option, label: redact(option.label) })),
    })) };
  },
  provider: async (request, image, signal) => cachedAiConnection ? createVisualLoopbackProvider({ protocol: cachedAiConnection.protocol, token: cachedAiConnection.token })(request, { mime: 'image/png', redacted: true, bytes: image }, signal) : { state: 'unavailable', proposal: null },
}));

async function restrictStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
chrome.runtime.onInstalled.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
chrome.runtime.onStartup.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[PROFILE_STORAGE_KEY] || changes[AI_CONNECTION_KEY] || changes[VISUAL_SETTINGS_KEY])) { void clearSessionSemanticRecipes(); void refreshVisualState(); }
});

chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'RA_VISUAL_STATUS') return false;
  if (Object.keys(message).length !== 1 || sender.id !== chrome.runtime.id
    || sender.url?.split(/[?#]/u)[0] !== chrome.runtime.getURL('popup.html')) {
    reply({ enabled: false }); return false;
  }
  reply({ enabled: hasVisualRequestConsent(cachedAiConnection, cachedVisualConsent) && cachedProfile !== undefined });
  return false;
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (response: unknown) => void) => {
  const parsed = projectProjectionRequestSchema.or(educationProjectionRequestSchema).or(internshipProjectionRequestSchema).or(awardProjectionRequestSchema).or(publicationProjectionRequestSchema).or(studentWorkProjectionRequestSchema).safeParse(message);
  if (!parsed.success) return false;
  const pageUrl = sender.url ?? sender.tab?.url ?? '';
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !/^https?:\/\//u.test(pageUrl)) {
    sendResponse({ ok: false, error: '不可信的档案投影请求' });
    return false;
  }
  if (['RA_PROFILE_INTERNSHIP','RA_PROFILE_AWARDS','RA_PROFILE_PUBLICATIONS','RA_PROFILE_STUDENT_WORK'].includes(parsed.data.type) && (sender.frameId !== 0 || !Number.isSafeInteger(sender.tab.id) || sender.tab.id <= 0)) {
    sendResponse({ ok: false, error: '不可信的档案投影请求' }); return false;
  }
  void loadProfile()
    .then(profile => sendResponse({ ok: true, data: parsed.data.type === 'RA_PROFILE_EDUCATION'
      ? educationProfile(profile) : parsed.data.type === 'RA_PROFILE_INTERNSHIP' ? internshipProfile(profile)
        : parsed.data.type === 'RA_PROFILE_AWARDS' ? awardProfile(profile)
          : parsed.data.type === 'RA_PROFILE_PUBLICATIONS' ? publicationProfile(profile)
            : parsed.data.type === 'RA_PROFILE_STUDENT_WORK' ? studentWorkProfile(profile) : projectProfile(profile) }))
    .catch(() => sendResponse({ ok: false, error: '无法读取本地档案' }));
  return true;
});
