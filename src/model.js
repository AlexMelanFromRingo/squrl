// The structural model: what a URL *is*, spelled as decisions.
//
// Each piece of the URL is written twice in this file -- once to put it into
// the stream, once to take it back out -- and the two halves sit next to each
// other so a change to one is visibly a change to the other. The corpus and
// fuzz tests exist to catch the day that stops being true.
//
// Nothing here decides what is worth storing: the encoder always writes the
// cheapest representation it can *prove* round-trips, and writes which one it
// chose, so the decoder never guesses.

import {
  putTree, getTree, putUint, getUint, putBounded, getBounded,
  UINT_SLOTS, treeSize, Encoder,
} from './rc.js';
import { SLOT, ROLE, classOf, firstClass } from './slots.js';
import {
  ALPHABET_COUNT, fit, offsetOf, sizeOf, symbolAt, indexOf as symbolIndex,
} from './alphabet.js';
import {
  HOSTS, HOST_INDEX, HOST_BITS,
  TLDS, TLD_INDEX, TLD_BITS, TLD_ESCAPE,
  WORDS, WORD_INDEX, WORD_BITS,
  EXTENSIONS, EXT_INDEX, EXT_BITS,
  suffixOf,
} from './dict.js';
import { split, join, isNumber, isHex, hexBytes, hexString } from './parse.js';

export const VERSION = 2;

// The version is two bits, and 3 is not a version: it means "a number
// follows". Formats that run out of room for a version number are how old
// links stop working, and two bits is not much room.
const VERSION_ESCAPE = 3;

/**
 * Fixed probabilities for the version field: even odds, never trained, never
 * changed.
 *
 * A range-coded stream is only readable by a decoder holding the same
 * probabilities, so a version field priced by the trained prior is worthless
 * for its one job -- the moment the prior moves, an old payload's version bits
 * decode to some other number and the stream is misread rather than refused.
 *
 * Even odds rather than a skew towards the current version, which was the first
 * attempt: a skew has to be re-aimed every time VERSION changes, and re-aiming
 * it breaks exactly the cross-generation reading it exists to provide. (It also
 * charged version 2 eleven bits for the privilege of not being version 1.) Two
 * bits, the same for every version, in every generation. A future format may
 * change VERSION but must leave this table alone.
 */
export const VERSION_MODEL = [
  [1, 2048],
  [2, 2048],
  [3, 2048],
];

function putVersion(enc, version) {
  putTree(enc, SLOT.version, 2, Math.min(version, VERSION_ESCAPE));
  if (version >= VERSION_ESCAPE) putUint(enc, SLOT.versionExtra, version);
}

function getVersion(dec) {
  const short = getTree(dec, SLOT.version, 2);
  return short === VERSION_ESCAPE ? getUint(dec, SLOT.versionExtra) : short;
}

// Limits the *decoder* enforces.
//
// A payload is attacker-controlled: anyone can put random base36 in a path and
// see what comes out. Without these, a lucky twenty-character payload decodes
// to a length field of 2^40 and the process dies allocating it. Real URLs are
// nowhere near any of these numbers.
export const LIMIT = {
  text: 8192,        // bytes in one literal run
  pieces: 512,       // path segments, or query pairs
  digits: 40,        // characters in a number
};

function bounded(value, max, what) {
  if (value > max) throw new Error(`${what} out of range (${value} > ${max})`);
  return value;
}

const MODE = { structured: 0, raw: 1 };

const SCHEME = { https: 0, http: 1, other: 2 };
const SCHEME_NAME = ['https', 'http'];

// Segment and value shapes.
//
// Most of a modern URL is not words -- it is identifiers, filenames and
// percent-escaped text, and each of those has a shape that costs a fraction of
// what spelling it out would. `text` is the one that always works, and the
// encoder falls back to it whenever a cheaper shape would not come back
// identical.
const KIND = {
  empty: 0, word: 1, number: 2, hex: 3, token: 4, file: 5, percent: 6, text: 7,
};

// An identifier is any run of letters, digits, `-` and `_`. Which of those a
// given run actually uses decides what each character costs: see alphabet.js.
const isToken = (text) => fit(text) >= 0;

const SEG_TYPE_SPAN = treeSize(3);      // one segment-shape tree per context

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

// --- literal text -----------------------------------------------------------

function putBytes(enc, bytes, role) {
  putUint(enc, SLOT.textLength + role * UINT_SLOTS, bytes.length);

  let cls = firstClass(role);
  for (const byte of bytes) {
    putTree(enc, SLOT.text + cls * 256, 8, byte);
    cls = classOf(byte);
  }
}

function getBytes(dec, role) {
  const length = bounded(
    getUint(dec, SLOT.textLength + role * UINT_SLOTS), LIMIT.text, 'text length');
  const bytes = new Uint8Array(length);

  let cls = firstClass(role);
  for (let i = 0; i < length; i++) {
    bytes[i] = getTree(dec, SLOT.text + cls * 256, 8);
    cls = classOf(bytes[i]);
  }
  return bytes;
}

const putText = (enc, text, role) => putBytes(enc, utf8.encode(text), role);
const getText = (dec, role) => utf8Decode.decode(getBytes(dec, role));

// --- scheme -----------------------------------------------------------------

function putScheme(enc, scheme) {
  const known = SCHEME[scheme] ?? SCHEME.other;
  putTree(enc, SLOT.scheme, 2, known);
  if (known === SCHEME.other) putText(enc, scheme, ROLE.other);
}

function getScheme(dec) {
  const known = getTree(dec, SLOT.scheme, 2);
  return known === SCHEME.other ? getText(dec, ROLE.other) : SCHEME_NAME[known];
}

// --- host -------------------------------------------------------------------

function putHost(enc, host) {
  const www = host.startsWith('www.');
  const bare = www ? host.slice(4) : host;
  enc.bit(SLOT.www, www ? 1 : 0);

  const known = HOST_INDEX.get(bare);
  if (known !== undefined) {
    enc.bit(SLOT.hostKnown, 1);
    putTree(enc, SLOT.hostIndex, HOST_BITS, known);
    return;
  }

  // Not a name we ship: store the public suffix as an index and the rest as
  // text, because the suffix is the most predictable part of any hostname.
  enc.bit(SLOT.hostKnown, 0);
  const suffix = suffixOf(bare);
  if (suffix) {
    putTree(enc, SLOT.tldIndex, TLD_BITS, TLD_INDEX.get(suffix));
    putText(enc, bare.slice(0, bare.length - suffix.length - 1), ROLE.host);
  } else {
    putTree(enc, SLOT.tldIndex, TLD_BITS, TLD_ESCAPE);
    putText(enc, bare, ROLE.host);
  }
}

function getHost(dec) {
  const www = dec.bit(SLOT.www) ? 'www.' : '';

  if (dec.bit(SLOT.hostKnown)) {
    return www + HOSTS[getTree(dec, SLOT.hostIndex, HOST_BITS)];
  }

  const suffix = getTree(dec, SLOT.tldIndex, TLD_BITS);
  const name = getText(dec, ROLE.host);
  return suffix === TLD_ESCAPE ? www + name : `${www}${name}.${TLDS[suffix]}`;
}

// --- port -------------------------------------------------------------------

function putPort(enc, port) {
  enc.bit(SLOT.hasPort, port === null ? 0 : 1);
  if (port === null) return;

  if (isNumber(port)) {
    enc.bit(SLOT.portNumeric, 1);
    putUint(enc, SLOT.port, Number(port));
  } else {
    enc.bit(SLOT.portNumeric, 0);
    putText(enc, port, ROLE.other);
  }
}

function getPort(dec) {
  if (!dec.bit(SLOT.hasPort)) return null;
  return dec.bit(SLOT.portNumeric)
    ? String(getUint(dec, SLOT.port))
    : getText(dec, ROLE.other);
}

// --- identifiers ------------------------------------------------------------
//
// The alphabet is chosen once per run and written first, which costs under
// three bits; every character after that is coded over that alphabet alone.
// For a lowercase slug that is 4.81 bits a character instead of 6.

function writeToken(enc, slots, text, id) {
  putBounded(enc, slots.alphabet, ALPHABET_COUNT, id);
  putUint(enc, slots.tokenLength + id * UINT_SLOTS, text.length);

  const base = slots.token + offsetOf(id);
  const size = sizeOf(id);
  for (const ch of text) putBounded(enc, base, size, symbolIndex(id, ch));
}

function putToken(enc, slots, text) {
  const narrowest = fit(text);

  // The narrowest alphabet is usually the cheapest, but not always: a wide one
  // that the corpus exercised heavily can beat a narrow one it barely saw, and
  // an overconfident prior on a rare alphabet can cost more than the uniform
  // bound it was supposed to beat. Since the choice travels in the stream, the
  // encoder can simply try them all.
  let best = narrowest;
  let cheapest = Infinity;

  for (let id = narrowest; id < ALPHABET_COUNT; id++) {
    if (symbolIndex(id, text[0]) === undefined) continue;
    if ([...text].some((ch) => symbolIndex(id, ch) === undefined)) continue;

    const trial = new Encoder(enc.m.clone());
    writeToken(trial, slots, text, id);
    if (trial.total < cheapest) {
      cheapest = trial.total;
      best = id;
    }
  }

  writeToken(enc, slots, text, best);
}

function getToken(dec, slots) {
  const id = getBounded(dec, slots.alphabet, ALPHABET_COUNT);
  const length = bounded(
    getUint(dec, slots.tokenLength + id * UINT_SLOTS), LIMIT.text, 'token length');

  const base = slots.token + offsetOf(id);
  const size = sizeOf(id);
  let out = '';
  for (let i = 0; i < length; i++) out += symbolAt(id, getBounded(dec, base, size));
  return out;
}

// --- percent escapes --------------------------------------------------------
//
// `%D0%9A%D0%BE%D0%B4` is nine bytes of Cyrillic wearing eighteen characters.
// Decoding it back to bytes and handing those to the byte model costs what the
// text costs, not what its transport encoding costs.
//
// Only escapes for bytes >= 0x80 qualify: `%41` would decode to a plain `A`
// and re-encode without the escape, and a URL that changes shape is a URL that
// no longer points where it did.

function decodePercent(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '%') {
      const code = text.charCodeAt(i);
      if (code > 0x7f) return null;         // raw non-ASCII: leave it to text
      bytes.push(code);
      continue;
    }
    const hex = text.slice(i + 1, i + 3);
    if (!/^[0-9A-F]{2}$/.test(hex)) return null;
    const value = parseInt(hex, 16);
    if (value < 0x80) return null;
    bytes.push(value);
    i += 2;
  }
  return Uint8Array.from(bytes);
}

function encodePercent(bytes) {
  let out = '';
  for (const byte of bytes) {
    out += byte > 0x7f ? `%${byte.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(byte);
  }
  return out;
}

const isPercent = (text) => {
  if (!text.includes('%')) return false;
  const bytes = decodePercent(text);
  return bytes !== null && encodePercent(bytes) === text;
};

// --- a piece of path or query ----------------------------------------------

/** A filename: an identifier, a dot, and an extension we ship. */
function fileParts(text) {
  const dot = text.lastIndexOf('.');
  if (dot <= 0) return null;
  const name = text.slice(0, dot);
  const ext = text.slice(dot + 1);
  if (!EXT_INDEX.has(ext) || !isToken(name)) return null;
  return { name, ext };
}

/**
 * Every shape that can reproduce this string exactly.
 *
 * More than one usually can, and which is cheapest is not obvious: a
 * lowercase slug like "how-we-scaled" is a valid identifier, but the byte
 * model knows English digraphs and codes it in four bits a character where the
 * identifier alphabet would spend six. So the encoder does not guess.
 */
function candidates(text) {
  if (text === '') return [KIND.empty];

  const kinds = [];
  if (WORD_INDEX.has(text)) kinds.push(KIND.word);
  if (isNumber(text)) kinds.push(KIND.number);
  if (isHex(text)) kinds.push(KIND.hex);
  if (isToken(text)) kinds.push(KIND.token);
  if (fileParts(text)) kinds.push(KIND.file);
  if (isPercent(text)) kinds.push(KIND.percent);
  kinds.push(KIND.text);
  return kinds;
}

/**
 * Write a piece under the shape that costs the fewest bits.
 *
 * Each candidate is encoded for real against a *copy* of the model state and
 * the bill is read off; only the winner is written to the actual stream. The
 * shape travels in the stream ahead of the piece, so the decoder does none of
 * this work -- it is told.
 */
function putShaped(enc, text, slots, role, typeSlot, typeBits) {
  const options = candidates(text);

  let best = options[0];
  if (options.length > 1) {
    let cheapest = Infinity;
    for (const kind of options) {
      const trial = new Encoder(enc.m.clone());
      putTree(trial, typeSlot, typeBits, kind);
      putPiece(trial, text, kind, slots, role);
      if (trial.total < cheapest) {
        cheapest = trial.total;
        best = kind;
      }
    }
  }

  putTree(enc, typeSlot, typeBits, best);
  putPiece(enc, text, best, slots, role);
}

function putPiece(enc, text, kind, slots, role) {
  switch (kind) {
    case KIND.empty:
      return;
    case KIND.word:
      return putTree(enc, slots.word, WORD_BITS, WORD_INDEX.get(text));
    case KIND.number:
      return putUint(enc, slots.number, Number(text));
    case KIND.hex: {
      const bytes = hexBytes(text);
      putUint(enc, slots.hexLength, bytes.length);
      for (const byte of bytes) {
        putTree(enc, slots.hex, 4, byte >> 4);
        putTree(enc, slots.hex, 4, byte & 15);
      }
      return;
    }
    case KIND.token:
      return putToken(enc, slots, text);
    case KIND.file: {
      const { name, ext } = fileParts(text);
      putToken(enc, slots, name);
      return putTree(enc, slots.ext, EXT_BITS, EXT_INDEX.get(ext));
    }
    case KIND.percent:
      return putBytes(enc, decodePercent(text), role);
    default:
      return putText(enc, text, role);
  }
}

function getPiece(dec, kind, slots, role) {
  switch (kind) {
    case KIND.empty:
      return '';
    case KIND.word:
      return WORDS[getTree(dec, slots.word, WORD_BITS)];
    case KIND.number: {
      // A number that does not survive String() is not a number this format
      // can carry -- refuse rather than hand back "1e+21".
      const text = String(getUint(dec, slots.number));
      if (text.length > LIMIT.digits || text.includes('e')) {
        throw new Error('number out of range');
      }
      return text;
    }
    case KIND.hex: {
      const length = bounded(getUint(dec, slots.hexLength), LIMIT.text, 'hex length');
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        bytes[i] = (getTree(dec, slots.hex, 4) << 4) | getTree(dec, slots.hex, 4);
      }
      return hexString(bytes);
    }
    case KIND.token:
      return getToken(dec, slots);
    case KIND.file: {
      const name = getToken(dec, slots);
      return `${name}.${EXTENSIONS[getTree(dec, slots.ext, EXT_BITS)]}`;
    }
    case KIND.percent:
      return encodePercent(getBytes(dec, role));
    default:
      return getText(dec, role);
  }
}

const SEGMENT_SLOTS = {
  word: SLOT.segWord,
  number: SLOT.segNumber,
  hexLength: SLOT.segHexLength,
  hex: SLOT.segHex,
  tokenLength: SLOT.segTokenLength,
  alphabet: SLOT.segAlphabet,
  token: SLOT.segToken,
  ext: SLOT.segExt,
};

const VALUE_SLOTS = {
  word: SLOT.valueWord,
  number: SLOT.valueNumber,
  hexLength: SLOT.valueHexLength,
  hex: SLOT.valueHex,
  tokenLength: SLOT.valueTokenLength,
  alphabet: SLOT.valueAlphabet,
  token: SLOT.valueToken,
  ext: SLOT.valueExt,
};

// --- path -------------------------------------------------------------------

function putPath(enc, path) {
  if (path === '') {
    enc.bit(SLOT.hasPath, 0);
    return;
  }
  enc.bit(SLOT.hasPath, 1);

  // A path always begins with "/", so the leading empty piece is implied.
  // "/a/b/" is three segments, the last one empty -- which is how a trailing
  // slash survives without a flag of its own.
  const segments = path.slice(1).split('/');
  putUint(enc, SLOT.pathCount, segments.length);

  segments.forEach((segment, i) => {
    const context = i === 0 ? 0 : 1;
    putShaped(enc, segment, SEGMENT_SLOTS, ROLE.path,
      SLOT.segType + context * SEG_TYPE_SPAN, 3);
  });
}

function getPath(dec) {
  if (!dec.bit(SLOT.hasPath)) return '';

  const count = bounded(getUint(dec, SLOT.pathCount), LIMIT.pieces, 'path segments');
  const segments = [];
  for (let i = 0; i < count; i++) {
    const context = i === 0 ? 0 : 1;
    const kind = getTree(dec, SLOT.segType + context * SEG_TYPE_SPAN, 3);
    segments.push(getPiece(dec, kind, SEGMENT_SLOTS, ROLE.path));
  }
  return `/${segments.join('/')}`;
}

// --- query ------------------------------------------------------------------

function putQuery(enc, query) {
  enc.bit(SLOT.hasQuery, query === null ? 0 : 1);
  if (query === null) return;

  const pairs = query.split('&');
  putUint(enc, SLOT.queryCount, pairs.length);

  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? null : pair.slice(eq + 1);

    // Keys are almost always a known word or short text; numbers and hashes
    // show up in values instead, so the two get different shape alphabets.
    const keyKind = WORD_INDEX.has(key) ? 1 : key === '' ? 0 : 2;
    putTree(enc, SLOT.keyType, 2, keyKind);
    if (keyKind === 1) putTree(enc, SLOT.keyWord, WORD_BITS, WORD_INDEX.get(key));
    else if (keyKind === 2) putText(enc, key, ROLE.query);

    enc.bit(SLOT.hasValue, value === null ? 0 : 1);
    if (value === null) continue;

    putShaped(enc, value, VALUE_SLOTS, ROLE.query, SLOT.valueType, 3);
  }
}

function getQuery(dec) {
  if (!dec.bit(SLOT.hasQuery)) return null;

  const count = bounded(getUint(dec, SLOT.queryCount), LIMIT.pieces, 'query pairs');
  const pairs = [];

  for (let i = 0; i < count; i++) {
    const keyKind = getTree(dec, SLOT.keyType, 2);
    const key =
      keyKind === 1 ? WORDS[getTree(dec, SLOT.keyWord, WORD_BITS)]
      : keyKind === 2 ? getText(dec, ROLE.query)
      : '';

    if (!dec.bit(SLOT.hasValue)) {
      pairs.push(key);
      continue;
    }
    const kind = getTree(dec, SLOT.valueType, 3);
    pairs.push(`${key}=${getPiece(dec, kind, VALUE_SLOTS, ROLE.query)}`);
  }
  return pairs.join('&');
}

// --- fragment ---------------------------------------------------------------

function putFragment(enc, fragment) {
  enc.bit(SLOT.hasFragment, fragment === null ? 0 : 1);
  if (fragment === null) return;

  const kind = WORD_INDEX.has(fragment) ? 1 : fragment === '' ? 0 : 2;
  putTree(enc, SLOT.fragType, 2, kind);
  if (kind === 1) putTree(enc, SLOT.fragWord, WORD_BITS, WORD_INDEX.get(fragment));
  else if (kind === 2) putText(enc, fragment, ROLE.other);
}

function getFragment(dec) {
  if (!dec.bit(SLOT.hasFragment)) return null;
  const kind = getTree(dec, SLOT.fragType, 2);
  if (kind === 1) return WORDS[getTree(dec, SLOT.fragWord, WORD_BITS)];
  return kind === 2 ? getText(dec, ROLE.other) : '';
}

// --- the whole URL ----------------------------------------------------------

/**
 * Write a URL into an open encoder.
 *
 * Anything that does not look like `scheme://…` goes in as one run of text --
 * still entropy coded, just without the structure to exploit. `raw` forces
 * that path: codec.js uses it when the structural model failed to reproduce
 * its own input.
 *
 * @returns {'structured'|'raw'} which of the two was written
 */
export function encodeUrl(enc, url, raw = false) {
  putVersion(enc, VERSION);

  const parts = raw ? null : split(url);
  if (!parts || parts.path !== '' && !parts.path.startsWith('/')) {
    enc.bit(SLOT.mode, MODE.raw);
    enc.open('raw');
    putText(enc, url, ROLE.other);
    return 'raw';
  }

  enc.bit(SLOT.mode, MODE.structured);

  enc.open('scheme');
  putScheme(enc, parts.scheme);

  enc.open('host');
  enc.bit(SLOT.hasUser, parts.userinfo === null ? 0 : 1);
  if (parts.userinfo !== null) putText(enc, parts.userinfo, ROLE.other);
  putHost(enc, parts.host);
  putPort(enc, parts.port);

  enc.open('path');
  putPath(enc, parts.path);

  enc.open('query');
  putQuery(enc, parts.query);

  enc.open('fragment');
  putFragment(enc, parts.fragment);

  return 'structured';
}

/** Read one back. */
export function decodeUrl(dec) {
  const version = getVersion(dec);
  if (version !== VERSION) throw new Error(`unsupported format version ${version}`);

  if (dec.bit(SLOT.mode) === MODE.raw) return getText(dec, ROLE.other);

  const scheme = getScheme(dec);
  const userinfo = dec.bit(SLOT.hasUser) ? getText(dec, ROLE.other) : null;
  const host = getHost(dec);
  const port = getPort(dec);
  const path = getPath(dec);
  const query = getQuery(dec);
  const fragment = getFragment(dec);

  return join({ scheme, userinfo, host, port, path, query, fragment });
}
