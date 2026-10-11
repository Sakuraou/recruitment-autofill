import type { RedactionImage } from './semanticRedactionPipeline';

const MAX_BYTES = 8_388_608;
const MAX_PIXELS = 16_777_216;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Validate resource limits before allocating a bitmap or a pixel buffer. */
export function inspectLocalPng(source: string): { bytes: Uint8Array; width: number; height: number } | undefined {
  if (typeof source !== 'string' || source.length > 11_184_812) return undefined;
  const payload = /^data:image\/png;base64,([A-Za-z\d+/]+={0,2})$/u.exec(source)?.[1];
  if (!payload || payload.length % 4 !== 0) return undefined;
  try {
    const decoded = atob(payload);
    if (decoded.length < 33 || decoded.length > MAX_BYTES) return undefined;
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    if (PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) return undefined;
    const view = new DataView(bytes.buffer);
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return undefined;
    const width = view.getUint32(16), height = view.getUint32(20);
    if (width < 1 || height < 1 || width > 16_384 || height > 16_384 || width * height > MAX_PIXELS) return undefined;
    return { bytes, width, height };
  } catch { return undefined; }
}

/** Browser-only local decode. No fetch, URL, page canvas, or model authority. */
export async function decodeLocalPng(source: string, signal: AbortSignal): Promise<RedactionImage | undefined> {
  if (signal.aborted) return undefined;
  const inspected = inspectLocalPng(source);
  if (!inspected) return undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(inspected.bytes).buffer], { type: 'image/png' }));
    if (signal.aborted || bitmap.width !== inspected.width || bitmap.height !== inspected.height) return undefined;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    if (signal.aborted) return undefined;
    return { width: bitmap.width, height: bitmap.height, rgba };
  } catch { return undefined; }
  finally { bitmap?.close(); }
}
