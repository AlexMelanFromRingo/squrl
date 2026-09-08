// Where every probability lives.
//
// The encoder and the decoder must agree on which model priced which decision,
// so the layout is declared once, here, and both sides address it by name.
// Adding a field means adding a line -- and retraining, because the prior file
// is a flat dump of exactly this many numbers in exactly this order.

import { UINT_SLOTS, treeSize, boundedSize } from './rc.js';
import { HOST_BITS, TLD_BITS, WORD_BITS, EXT_BITS } from './dict.js';
import { ALPHABET_COUNT, ALPHABET_SLOTS } from './alphabet.js';

export const SLOT = {};
let next = 0;

function alloc(name, count) {
  SLOT[name] = next;
  next += count;
}

// --- container --------------------------------------------------------------
alloc('version', treeSize(2));
alloc('versionExtra', UINT_SLOTS);      // only read when the two bits say 3
alloc('mode', 2);                       // structured, or raw text

// --- scheme and authority ---------------------------------------------------
alloc('scheme', treeSize(2));           // https, http, anything else
alloc('hasUser', 1);
alloc('www', 1);
alloc('hostKnown', 1);
alloc('hostIndex', treeSize(HOST_BITS));
alloc('tldIndex', treeSize(TLD_BITS));
alloc('hasPort', 1);
alloc('portNumeric', 1);
alloc('port', UINT_SLOTS);

// --- path -------------------------------------------------------------------
alloc('hasPath', 1);
alloc('pathCount', UINT_SLOTS);
// Two contexts: the first segment of a path is a different animal from the
// rest ("watch", "blob", "api" versus an id or a filename).
alloc('segType', 2 * treeSize(3));
alloc('segWord', treeSize(WORD_BITS));
alloc('segNumber', UINT_SLOTS);
alloc('segHexLength', UINT_SLOTS);
alloc('segHex', treeSize(4));
// Which alphabet the identifier is spelled in, then how long it is, then the
// characters. Each alphabet gets its own trees, because the three are not
// independent: video ids are eleven characters of everything, hashes are
// thirty-two of lowercase and digits, and slugs are any length at all.
alloc('segAlphabet', boundedSize(ALPHABET_COUNT));
alloc('segTokenLength', ALPHABET_COUNT * UINT_SLOTS);
alloc('segToken', ALPHABET_SLOTS);
alloc('segExt', treeSize(EXT_BITS));

// --- query ------------------------------------------------------------------
alloc('hasQuery', 1);
alloc('queryCount', UINT_SLOTS);
alloc('keyType', treeSize(2));
alloc('keyWord', treeSize(WORD_BITS));
alloc('hasValue', 1);
alloc('valueType', treeSize(3));
alloc('valueWord', treeSize(WORD_BITS));
alloc('valueNumber', UINT_SLOTS);
alloc('valueHexLength', UINT_SLOTS);
alloc('valueHex', treeSize(4));
alloc('valueAlphabet', boundedSize(ALPHABET_COUNT));
alloc('valueTokenLength', ALPHABET_COUNT * UINT_SLOTS);
alloc('valueToken', ALPHABET_SLOTS);
alloc('valueExt', treeSize(EXT_BITS));

// --- fragment ---------------------------------------------------------------
alloc('hasFragment', 1);
alloc('fragType', treeSize(2));
alloc('fragWord', treeSize(WORD_BITS));

// --- text -------------------------------------------------------------------
// Literal text is coded one byte at a time, each byte under a bit tree chosen
// by what came before it. The classes are coarse (26 letters, then buckets)
// because a finer context would need a bigger prior than the URLs it saves.
export const TEXT_CLASSES = 40;
export const ROLE = { host: 0, path: 1, query: 2, other: 3 };
const ROLE_COUNT = 4;

alloc('textLength', ROLE_COUNT * UINT_SLOTS);
alloc('text', TEXT_CLASSES * 256);

export const SLOT_COUNT = next;

/**
 * Context class for the byte that follows `code`.
 *
 * Letters get one class each -- "th" and "ht" are worth telling apart -- and
 * everything else is bucketed. Classes 34..37 are used for the first byte of a
 * run instead, one per role, so a host does not start with a path's model.
 */
export function classOf(code) {
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;      // a-z
  if (code >= 0x30 && code <= 0x39) return 26;               // digits
  if (code === 0x2d) return 27;                              // -
  if (code === 0x5f) return 28;                              // _
  if (code === 0x2e) return 29;                              // .
  if (code === 0x25) return 30;                              // %
  if (code >= 0x41 && code <= 0x5a) return 31;               // A-Z
  if (code === 0x2b || code === 0x2c || code === 0x3d) return 32;
  return 33;                                                 // everything else
}

export const firstClass = (role) => 34 + role;
