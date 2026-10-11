import type { CssRect } from './cropGeometry';
export interface PixelRedactionInput {
  image: { width: number; height: number; rgba: Uint8ClampedArray };
  crop: CssRect; keep: readonly CssRect[]; masks: readonly CssRect[];
}
export type PixelRedactionResult = Readonly<{ state: 'redacted'; width: number; height: number; rgba: Uint8ClampedArray }
  | { state: 'rejected'; reason: string }>;
/** Local numerical pixel processing only; caller rectangles are not privacy/admission proof. */
const reject = (reason: string): PixelRedactionResult => Object.freeze({ state: 'rejected', reason });
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
    && keys.every(key => Object.getOwnPropertyDescriptor(value, key)?.value !== undefined);
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 10_000_000;
function rectangle(value: unknown): value is CssRect {
  return record(value, ['left', 'top', 'width', 'height']) && Object.values(value).every(integer)
    && (value.width as number) >= 0 && (value.height as number) >= 0;
}
function rectangles(value: unknown, limit: number): CssRect[] | undefined {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) return undefined;
  const output: CssRect[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, String(i))?.value as unknown;
    if (!rectangle(item)) return undefined; output.push({ ...item });
  }
  return output;
}
type Interval = [number, number];
function union(intervals: Interval[]): Interval[] {
  const merged: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1); if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}
export function redactLocalPixels(input: unknown): PixelRedactionResult {
  try {
    if (!record(input, ['image', 'crop', 'keep', 'masks']) || !record(input.image, ['width', 'height', 'rgba'])
      || !rectangle(input.crop)) return reject('invalid-input');
    const image = input.image, crop = { ...input.crop }, keep = rectangles(input.keep, 4), masks = rectangles(input.masks, 256);
    if (!keep || !masks) return reject('invalid-rectangles');
    if (!integer(image.width) || !integer(image.height) || image.width < 1 || image.height < 1 || image.width > 16384 || image.height > 16384
      || image.width * image.height > 16_777_216) return reject('invalid-image-size');
    if (!(image.rgba instanceof Uint8ClampedArray) || Object.getPrototypeOf(image.rgba) !== Uint8ClampedArray.prototype) return reject('invalid-pixels');
    // Read native slots rather than shadowable instance properties. A shared
    // buffer cannot impersonate an ordinary buffer and change during processing.
    const typedArrayPrototype = Object.getPrototypeOf(Uint8ClampedArray.prototype);
    const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get?.call(image.rgba) as unknown;
    const length = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')?.get?.call(image.rgba) as unknown;
    if (!(buffer instanceof ArrayBuffer) || length !== image.width * image.height * 4) return reject('invalid-pixels');
    if (crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1 || crop.left + crop.width > image.width
      || crop.top + crop.height > image.height || crop.width * crop.height > 1_048_576) return reject('invalid-crop');
    if (keep.some(r => r.left < 0 || r.top < 0 || r.left + r.width > crop.width || r.top + r.height > crop.height)) return reject('keep-outside-crop');
    const source = image.rgba, rgba = new Uint8ClampedArray(crop.width * crop.height * 4);
    // Initialize every byte. Opaque black default never retains hidden RGB or alpha.
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    for (let y = 0; y < crop.height; y++) {
      let intervals = union(keep.filter(r => r.width > 0 && r.height > 0 && y >= r.top && y < r.top + r.height).map(r => [r.left, r.left + r.width]));
      for (const r of masks) {
        if (r.width === 0 || r.height === 0 || y < r.top || y >= r.top + r.height) continue;
        const left = Math.max(0, r.left), right = Math.min(crop.width, r.left + r.width); if (right <= left) continue;
        intervals = intervals.flatMap(([a, b]): Interval[] => {
          if (right <= a || left >= b) return [[a, b]];
          return [...(left > a ? [[a, left] as Interval] : []), ...(right < b ? [[right, b] as Interval] : [])];
        });
      }
      for (const [a, b] of intervals) for (let x = a; x < b; x++) {
        const src = ((y + crop.top) * image.width + x + crop.left) * 4, dst = (y * crop.width + x) * 4;
        // Composite even approved pixels onto black. Transparent original RGB
        // must not become visible merely because output is forced opaque.
        const alpha = source[src + 3]! / 255;
        for (let channel = 0; channel < 3; channel++) rgba[dst + channel] = Math.round(source[src + channel]! * alpha);
      }
    }
    // Fresh mutable storage is for a later local encoder, not model/action authority.
    return Object.freeze({ state: 'redacted', width: crop.width, height: crop.height, rgba });
  } catch { return reject('invalid-input'); }
}
