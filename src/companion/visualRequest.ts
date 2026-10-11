import { z } from 'zod';
import { semanticRequestSchema } from '../ai/semanticProtocol';
import type { CompanionResult } from './responsesProvider';
import { inflateSync } from 'node:zlib';

export const MAX_VISUAL_BODY_BYTES = 11_400_000;
const prefix = 'data:image/png;base64,';
function validPixels(bytes: Buffer, width: number, height: number): boolean {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
    table[n] = crc >>> 0;
  }
  const data: Buffer[] = []; let offset = 8; let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset === 8 ? type !== 'IHDR' : !['IDAT', 'IEND'].includes(type)) return false;
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++) crc = table[(crc ^ bytes[i]!) & 255]! ^ crc >>> 8;
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) return false;
    if (type === 'IDAT') data.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') { ended = length === 0 && end === bytes.length; break; }
    offset = end;
  }
  if (!ended || !data.length) return false;
  const row = width * (bytes[25] === 6 ? 4 : 3) + 1;
  try {
    const pixels = inflateSync(Buffer.concat(data), { maxOutputLength: row * height });
    if (pixels.length !== row * height) return false;
    for (let y = 0; y < height; y++) if (pixels[y * row]! > 4) return false;
    return true;
  } catch { return false; }
}
/** The companion admits only the extension's bounded, already-redacted PNG envelope. */
export const visualRequestSchema = z.object({
  request: semanticRequestSchema.refine(request => request.fields.length === 1),
  image: z.object({ mime: z.literal('image/png'), redacted: z.literal(true),
    data: z.string().max(11_200_000).refine(value => {
      if (!value.startsWith(prefix)) return false;
      const encoded = value.slice(prefix.length);
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) return false;
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length < 33 || bytes.length > 8_388_608 || bytes.toString('base64') !== encoded
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      return width > 0 && height > 0 && width * height <= 1_048_576
        && bytes[24] === 8 && [2, 6].includes(bytes[25]!)
        && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0 && validPixels(bytes, width, height);
    }),
  }).strict(),
}).strict();
export type VisualRequest = z.infer<typeof visualRequestSchema>;
export type VisualProvider = (input: VisualRequest, signal: AbortSignal) => Promise<CompanionResult>;
