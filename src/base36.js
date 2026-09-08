// Bytes as digits and capitals, and back.
//
// The choice of alphabet is the whole reason this file exists. A QR code has a
// dedicated *alphanumeric* mode that packs two characters into eleven bits --
// 5.5 bits each instead of the 8 that byte mode spends -- but only over
// 0-9 A-Z and a handful of punctuation. Base64url would drop the QR straight
// back into byte mode and hand back a third of what the compressor just saved.
//
// So: uppercase base36. Nothing outside [0-9A-Z], nothing a linkifier will
// swallow at the end of a sentence, nothing that changes meaning when a phone
// keyboard capitalises it -- and 1.55 characters per byte, against base32's
// 1.60 and base64's 1.33-in-byte-mode (which is 1.78 once QR is counted).

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VALUE = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));

/**
 * Encode bytes as base36.
 *
 * The conversion is over the whole payload rather than in blocks, which is
 * what keeps the expansion at log(256)/log(36) instead of rounding up per
 * group. Leading zero bytes carry no value in a number, so they are written
 * out as leading zero digits, one for one.
 */
export function encode36(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);

  let digits = '';
  while (n > 0n) {
    digits = ALPHABET[Number(n % 36n)] + digits;
    n /= 36n;
  }
  return '0'.repeat(zeros) + digits;
}

/** Decode base36 back to bytes. Lowercase is accepted; hosts get capitalised. */
export function decode36(text) {
  const upper = String(text).toUpperCase();

  let zeros = 0;
  while (zeros < upper.length && upper[zeros] === '0') zeros++;

  let n = 0n;
  for (const ch of upper.slice(zeros)) {
    const value = VALUE.get(ch);
    if (value === undefined) throw new Error(`not base36: ${JSON.stringify(ch)}`);
    n = n * 36n + value;
  }

  const tail = [];
  while (n > 0n) {
    tail.unshift(Number(n & 0xffn));
    n >>= 8n;
  }

  const out = new Uint8Array(zeros + tail.length);
  out.set(tail, zeros);
  return out;
}

/** How many characters `n` bytes will take, on average. */
export const CHARS_PER_BYTE = Math.log(256) / Math.log(36);
