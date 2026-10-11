import type { LocalImageEncoder } from './localImageEncoder';

const MAX_PIXELS = 1_048_576;
const MAX_BYTES = 8_388_608;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

type Deflater = (input: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>;

const isBytes = (value: unknown): value is Uint8Array => value instanceof Uint8Array;
const abortIfNeeded = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); };

async function localStoreDeflate(input: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  // Stored DEFLATE blocks keep this boundary deterministic and independent of browser stream APIs.
  const blocks = Math.max(1, Math.ceil(input.length / 65_535));
  const output = new Uint8Array(2 + input.length + blocks * 5 + 4);
  output[0] = 0x78; output[1] = 0x01; let offset = 2; let source = 0;
  let s1 = 1; let s2 = 0;
  for (let block = 0; block < blocks; block += 1) {
    abortIfNeeded(signal);
    const length = Math.min(65_535, input.length - source); const final = block === blocks - 1;
    output[offset] = final ? 1 : 0; output[offset + 1] = length & 255; output[offset + 2] = length >>> 8;
    const inverse = length ^ 0xffff; output[offset + 3] = inverse & 255; output[offset + 4] = inverse >>> 8; offset += 5;
    output.set(input.subarray(source, source + length), offset);
    for (const value of input.subarray(source, source + length)) { s1 = (s1 + value) % 65521; s2 = (s2 + s1) % 65521; }
    source += length; offset += length;
  }
  const adler = (s2 * 65536 + s1) >>> 0; writeU32(output, offset, adler); return output;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 255; target[offset + 1] = (value >>> 16) & 255;
  target[offset + 2] = (value >>> 8) & 255; target[offset + 3] = value & 255;
}

function crc32(type: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of type) crc = crcTable[(crc ^ value) & 255]! ^ (crc >>> 8);
  for (const value of data) crc = crcTable[(crc ^ value) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  writeU32(result, 0, data.length); result.set(typeBytes, 4); result.set(data, 8);
  writeU32(result, 8 + data.length, crc32(typeBytes, data)); return result;
}

function pngBytes(width: number, height: number, compressed: Uint8Array): Uint8Array {
  const header = new Uint8Array(13); writeU32(header, 0, width); writeU32(header, 4, height);
  header[8] = 8; header[9] = 6; // RGBA, 8 bits per channel.
  const ihdr = chunk('IHDR', header); const idat = chunk('IDAT', compressed); const iend = chunk('IEND', new Uint8Array());
  const output = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length);
  let offset = 0; for (const part of [PNG_SIGNATURE, ihdr, idat, iend]) { output.set(part, offset); offset += part.length; }
  return output;
}

function scanlines(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const rowBytes = width * 4; const raw = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const source = row * rowBytes; const target = row * (rowBytes + 1); raw.set(rgba.subarray(source, source + rowBytes), target + 1);
  }
  return raw;
}

export interface LocalPngEncoderOptions { readonly deflate?: Deflater }

/** Encodes already-redacted RGBA locally; it never accepts a URL or performs I/O. */
export function createLocalPngEncoder(options: LocalPngEncoderOptions = {}): LocalImageEncoder {
  const deflate = options.deflate ?? localStoreDeflate;
  return {
    async encode(input, signal) {
      if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1
        || input.width * input.height > MAX_PIXELS || !(input.rgba instanceof Uint8ClampedArray)
        || input.rgba.length !== input.width * input.height * 4) throw new Error('invalid-rgba');
      abortIfNeeded(signal);
      const compressed = await deflate(scanlines(input.width, input.height, new Uint8ClampedArray(input.rgba)), signal);
      abortIfNeeded(signal);
      if (!isBytes(compressed) || compressed.length > MAX_BYTES) throw new Error('invalid-deflate');
      const output = pngBytes(input.width, input.height, compressed);
      if (output.length > MAX_BYTES) throw new Error('png-too-large');
      return output;
    },
  };
}
