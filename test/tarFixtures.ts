/**
 * Hand-built tar archives for hostile-input tests (PBT-51/52).
 *
 * ⚠️ Deliberately NOT built with the `tar` package. A fixture made by the library under test can only contain
 * what that library is willing to write — and it will not write `../x`, an absolute path, or a symlink named
 * like an allowlisted file. These are raw ustar blocks, so a test can say exactly what an attacker would send.
 */

import { gzipSync } from 'node:zlib';

export interface RawEntry {
  name: string;
  /** ustar typeflag: '0' file, '1' hard link, '2' symlink, '3' char dev, '4' block dev, '5' dir, '6' fifo */
  typeflag?: string;
  body?: Buffer | string;
  linkname?: string;
  /** Override the declared size (to lie about it). Defaults to the body length. */
  size?: number;
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(e: RawEntry, bodyLength: number): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(e.name.slice(0, 100), 0, 'utf8');
  h.write(octal(0o644, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(e.size ?? bodyLength, 12), 124, 'ascii');
  h.write(octal(0, 12), 136, 'ascii');
  h.write('        ', 148, 'ascii'); // checksum placeholder
  h.write(e.typeflag ?? '0', 156, 'ascii');
  if (e.linkname) h.write(e.linkname.slice(0, 100), 157, 'utf8');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148, 'ascii');
  return h;
}

/** A raw (uncompressed) tar stream of the given entries. */
export function rawTar(entries: RawEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body ?? '', 'utf8');
    const hasBody = (e.typeflag ?? '0') === '0';
    parts.push(header(e, hasBody ? body.length : 0));
    if (hasBody && body.length > 0) {
      parts.push(body, Buffer.alloc((512 - (body.length % 512)) % 512, 0));
    }
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

export const tarGz = (entries: RawEntry[]): Buffer => gzipSync(rawTar(entries));
