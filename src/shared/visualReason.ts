/** Fixed local diagnostics only. No page text, facts or provider explanations. */
export const visualManualReasons = ['disabled','stale-page','unavailable','invalid-proposal','local-scope',
  'browser-capability','unsupported-component','unsupported-layout'] as const;
export type VisualManualReason = typeof visualManualReasons[number];
