// Identifier alphabets, narrowest first.
//
// A random-looking path segment is not random over the same alphabet every
// time. `how-we-scaled` never uses a capital; `AbCd12` uses three kinds of
// character; a YouTube id uses all of them. Coding every identifier over the
// full 64-character set spends six bits on each character regardless -- but a
// lowercase-and-digits id only needs log2(38) = 5.25, and the encoder can say
// which alphabet it used for the price of picking one out of seven.
//
// The idea is from p2r3/ha.mr, which fits each segment to a subalphabet the
// same way. What differs is the payment: these indices are range coded against
// a bounded interval, so an alphabet of 38 symbols costs 5.25 bits rather than
// the six a fixed-width code would round up to.

const DIGITS = '0123456789';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// `-` and `_` end up in every one of them: they are how identifiers are
// punctuated, and excluding them would push half of all slugs to the widest
// alphabet for the sake of two characters.
const SEPARATORS = '-_';

export const ALPHABETS = [
  DIGITS + SEPARATORS,                    // 12 symbols, 3.58 bits
  LOWER + SEPARATORS,                     // 28, 4.81
  UPPER + SEPARATORS,                     // 28, 4.81
  LOWER + DIGITS + SEPARATORS,            // 38, 5.25
  UPPER + DIGITS + SEPARATORS,            // 38, 5.25
  LOWER + UPPER + SEPARATORS,             // 54, 5.75
  LOWER + UPPER + DIGITS + SEPARATORS,    // 64, 6.00
];

export const ALPHABET_COUNT = ALPHABETS.length;

// Sorted by size, so the first one that covers a string is also the cheapest.
for (let i = 1; i < ALPHABETS.length; i++) {
  if (ALPHABETS[i].length < ALPHABETS[i - 1].length) {
    throw new Error('ALPHABETS must be ordered narrowest first');
  }
}

const INDEX = ALPHABETS.map((alphabet) => new Map([...alphabet].map((c, i) => [c, i])));

/** Widest slot count any of these alphabets needs for its coding tree. */
export const ALPHABET_SLOTS = ALPHABETS.reduce(
  (total, alphabet) => total + (1 << Math.ceil(Math.log2(alphabet.length))),
  0,
);

/** Where alphabet `id`'s tree starts, relative to the region base. */
export const alphabetOffset = (id) => ALPHABETS
  .slice(0, id)
  .reduce((total, alphabet) => total + (1 << Math.ceil(Math.log2(alphabet.length))), 0);

const OFFSETS = ALPHABETS.map((_, id) => alphabetOffset(id));

export const offsetOf = (id) => OFFSETS[id];
export const sizeOf = (id) => ALPHABETS[id].length;
export const symbolAt = (id, index) => ALPHABETS[id][index];
export const indexOf = (id, ch) => INDEX[id].get(ch);

/**
 * The narrowest alphabet that spells this string, or -1 for none of them.
 *
 * -1 is the common answer: a segment with a dot, a percent escape or any
 * punctuation beyond `-_` is not an identifier and goes to another shape.
 */
export function fit(text) {
  if (text.length === 0) return -1;

  for (let id = 0; id < ALPHABETS.length; id++) {
    const table = INDEX[id];
    let covered = true;
    for (const ch of text) {
      if (!table.has(ch)) { covered = false; break; }
    }
    if (covered) return id;
  }
  return -1;
}
