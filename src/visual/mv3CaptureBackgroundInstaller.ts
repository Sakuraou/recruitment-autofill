import { createMv3CaptureBackgroundPortHandler, type CapturePort, type CaptureBackgroundDependencies } from './mv3CaptureBackgroundPort';
export interface CaptureRuntimeSource { onConnect: { addListener(listener: (port: CapturePort) => void): void; removeListener?(listener: (port: CapturePort) => void): void } }
export type CaptureTabsSource = Pick<CaptureBackgroundDependencies, 'captureVisibleTab' | 'getActiveTabContext'>;
export function installMv3CaptureBackground(runtime: CaptureRuntimeSource, tabs: CaptureTabsSource, extensionId: string, popupUrl: string): () => void {
  const handler = createMv3CaptureBackgroundPortHandler({ extensionId, popupUrl, captureVisibleTab: tabs.captureVisibleTab.bind(tabs), getActiveTabContext: tabs.getActiveTabContext.bind(tabs) });
  runtime.onConnect.addListener(handler);
  return () => { runtime.onConnect.removeListener?.(handler); handler.dispose(); };
}
