// Fitting priors: the counting, the smoothing and the scoring, in one place.
//
// tools/train.mjs writes src/prior.js with this. tools/sweep.mjs uses it to
// choose the smoothing constants by cross-validation *on the training corpus*,
// so that tools/holdout.txt stays a set of URLs nothing was tuned against --
// including the hyperparameters. Tuning on the set you report on is how a
// compression ratio becomes a press release.

import { readFileSync } from 'node:fs';

import { ONE, Models, Encoder } from '../src/rc.js';
import { SLOT, SLOT_COUNT } from '../src/slots.js';
import { ALPHABET_SLOTS } from '../src/alphabet.js';
import { encodeUrl, VERSION_MODEL } from '../src/model.js';

/** Read a URL list, ignoring blanks and comments. */
export function readUrls(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * A real encoder that also keeps score.
 *
 * It has to be a real one: the model picks each piece's shape, and each
 * identifier's alphabet, by encoding it several ways and taking the cheapest,
 * and those decisions depend on the probabilities in force. Counting with a
 * stub would tally choices the codec will not make.
 */
class Tally extends Encoder {
  constructor(models, zero, one) {
    super(models);
    this.zero = zero;
    this.one = one;
  }

  bit(slot, bit) {
    if (bit) this.one[slot]++;
    else this.zero[slot]++;
    super.bit(slot, bit);
  }
}

export function count(urls, prior = null) {
  const zero = new Float64Array(SLOT_COUNT);
  const one = new Float64Array(SLOT_COUNT);

  for (const url of urls) {
    const models = prior ? new Models(prior) : Models.uniform(SLOT_COUNT);
    encodeUrl(new Tally(models, zero, one), url);
  }
  return { zero, one };
}

// Identifier characters get their own, much stronger smoothing. A random video
// id is uniform over its alphabet by construction, so there is nothing there to
// learn -- but a corpus with a few hundred lowercase slugs in it will happily
// "learn" that capitals are unlikely, and then charge nine bits for the next
// capital it meets. Shrinking those contexts hard towards uniform is worth more
// than the little they have to teach.
const TOKEN_REGIONS = [
  [SLOT.segToken, ALPHABET_SLOTS],
  [SLOT.valueToken, ALPHABET_SLOTS],
];

const inTokenRegion = (slot) =>
  TOKEN_REGIONS.some(([base, size]) => slot >= base && slot < base + size);

const FLOOR = 24;   // p >= 0.6%: no context may charge more than ~7.4 bits

/**
 * Turn counts into starting probabilities.
 *
 * `alpha` is the number of imaginary observations of each outcome added before
 * the division. It matters more than it looks: a context seen twice, taken at
 * face value, gives a confident prior that is worse than knowing nothing.
 */
export function fit({ zero, one }, { alpha = 1, tokenAlpha = 12 } = {}) {
  const table = new Uint16Array(SLOT_COUNT);
  let trained = 0;

  for (let i = 0; i < SLOT_COUNT; i++) {
    const total = zero[i] + one[i];
    if (total === 0) {
      table[i] = ONE / 2;                 // never exercised: stay undecided
      continue;
    }
    trained++;
    const a = inTokenRegion(i) ? tokenAlpha : alpha;
    const p = Math.round(((one[i] + a) / (total + 2 * a)) * ONE);
    table[i] = Math.min(ONE - FLOOR, Math.max(FLOOR, p));
  }

  // The version field is not learned from anything: see VERSION_MODEL. Every
  // retraining writes the same two numbers, so a decoder from any generation
  // can still read the version of a payload from any other.
  for (const [offset, probability] of VERSION_MODEL) {
    table[SLOT.version + offset] = probability;
  }

  return { table, trained };
}

/**
 * Two passes: fit to choices made with no priors, then re-count with those
 * priors in force so the numbers describe the encoder that will ship.
 */
export function train(urls, options) {
  const first = fit(count(urls), options);
  return fit(count(urls, first.table), options);
}

/** What a prior costs on a set of URLs, in bytes and per character. */
export function score(urls, prior) {
  let bytes = 0;
  let chars = 0;

  for (const url of urls) {
    const enc = new Encoder(new Models(prior));
    encodeUrl(enc, url);
    bytes += enc.finish().length;
    chars += url.length;
  }

  return { bytes, chars, perChar: bytes / chars };
}
