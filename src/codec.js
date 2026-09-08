// The public surface: a URL in, a short link out, and back again.
//
// One rule governs everything below. **The encoder never returns a payload it
// has not already decoded back to the exact input.** Compression here is a
// guess about what URLs look like, and a guess that is wrong about *your* URL
// must cost bytes, never correctness -- so pack() runs unpack() on its own
// output and falls back to the plain-text coder if anything differs at all.

import { Models, Encoder, Decoder } from './rc.js';
import { SLOT_COUNT } from './slots.js';
import { encodeUrl, decodeUrl, VERSION } from './model.js';
import { PRIOR } from './prior.js';
import { encode36, decode36 } from './base36.js';

export const DEFAULT_BASE = 'https://sq.gy/';

// The trained starting probabilities, unpacked once. Every URL gets its own
// copy: coding is stateless between links, which is what lets a payload be
// decoded by anyone holding this library and nothing else.
const PRIOR_TABLE = (() => {
  const binary = atob(PRIOR);
  const table = new Uint16Array(SLOT_COUNT);
  for (let i = 0; i < SLOT_COUNT; i++) {
    table[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  }
  return table;
})();

export function freshModels() {
  return new Models(PRIOR_TABLE);
}

function encodeOnce(url, { raw = false } = {}) {
  const enc = new Encoder(freshModels());
  const mode = encodeUrl(enc, url, raw);
  return { bytes: enc.finish(), cost: enc.cost, mode };
}

/**
 * Compress a URL.
 *
 * @param {string} url
 * @returns {{bytes: Uint8Array, cost: Map<string, number>, mode: string,
 *            fallback: boolean}}
 *          `mode` is how it was written -- as a parsed URL, or as one run of
 *          text -- and `fallback` says the structural attempt was thrown away
 *          because it did not decode back to the input.
 */
export function pack(url) {
  if (typeof url !== 'string') throw new TypeError('pack expects a string');

  const first = encodeOnce(url);
  if (unpack(first.bytes) === url) return { ...first, fallback: false };

  // The structural model mis-read this URL. That is a bug worth knowing about,
  // but not one worth serving a wrong link over, so fall back and carry on.
  const raw = encodeOnce(url, { raw: true });
  if (unpack(raw.bytes) === url) return { ...raw, fallback: true };

  throw new Error('cannot round-trip this string (lone surrogates?)');
}

/** Decompress a payload. */
export function unpack(bytes) {
  return decodeUrl(new Decoder(freshModels(), bytes));
}

// --- links ------------------------------------------------------------------

/**
 * Compress a URL into a link that a phone camera can open.
 *
 * The payload *is* the URL -- there is no table anywhere mapping one to the
 * other, so nothing has to be stored, nothing expires, and the same input
 * always gives the same link. The host in front of it is only there to give
 * the browser somewhere to ask for a redirect.
 */
export function shorten(url, { base = DEFAULT_BASE } = {}) {
  const { bytes, cost, mode, fallback } = pack(url);
  const payload = encode36(bytes);
  return {
    link: base.replace(/\/*$/, '/') + payload,
    payload,
    bytes,
    cost,
    mode,
    fallback,
  };
}

/** Expand a link, or a bare payload, back into the original URL. */
export function expand(text, { base = DEFAULT_BASE } = {}) {
  let payload = String(text).trim();

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(payload)) {
    const path = payload.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    payload = path.replace(/^\/+/, '').split(/[/?#]/)[0];
  } else if (payload.startsWith(base)) {
    payload = payload.slice(base.length);
  }

  if (payload === '') throw new Error('no payload in that link');
  return unpack(decode36(payload));
}

export { VERSION, encode36, decode36 };
