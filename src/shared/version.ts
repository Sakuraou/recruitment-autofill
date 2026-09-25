import manifest from '../../manifest.json';

/** Bundled into both popup and content script, so stale injected code is detectable. */
export const EXTENSION_VERSION = manifest.version;
