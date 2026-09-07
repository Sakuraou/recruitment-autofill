async function restrictStorage() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
chrome.runtime.onInstalled.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
chrome.runtime.onStartup.addListener(() => { void restrictStorage().catch(() => console.error('[网申助手] 存储访问限制设置失败')); });
