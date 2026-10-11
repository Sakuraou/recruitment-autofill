import type { PixelRedactionResult } from './localPixelRedaction';
export interface EncodedLocalImage { readonly mime: 'image/png'; readonly redacted: true; readonly bytes: Uint8Array }
export interface LocalImageEncoder { encode(input: { width: number; height: number; rgba: Uint8ClampedArray }, signal: AbortSignal): Promise<Uint8Array> }
const reject = (reason: string) => Object.freeze({ state: 'rejected' as const, reason });
export async function encodeRedactedImage(result: PixelRedactionResult, encoder: LocalImageEncoder, signal: AbortSignal = new AbortController().signal): Promise<EncodedLocalImage | { readonly state: 'rejected'; readonly reason: string }> {
  if (signal.aborted || result.state !== 'redacted' || !(result.rgba instanceof Uint8ClampedArray) || result.width < 1 || result.height < 1 || result.width * result.height > 1_048_576 || result.rgba.length !== result.width * result.height * 4) return reject('invalid-redacted-image');
  try { const bytes = await encoder.encode({ width: result.width, height: result.height, rgba: new Uint8ClampedArray(result.rgba) }, signal); if (signal.aborted || !(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > 8_388_608) return reject('invalid-encoded-image'); return Object.freeze({ mime: 'image/png' as const, redacted: true as const, bytes: new Uint8Array(bytes) }); } catch { return reject('encoder-failed'); }
}
