// Learns src/prior.js from tools/corpus.txt.
//
//   node tools/train.mjs [corpus.txt] > src/prior.js
//
// A range coder is only as good as the probabilities it starts from, and a
// single short URL gives an adaptive model nothing to adapt to -- by the time
// it has learned that schemes are usually https, the URL is over. So the
// starting probabilities are fitted here, once, over a corpus, and shipped.
//
// The method is deliberately plain: run the same encoder the codec runs, count
// how each context actually went, and turn the counts into probabilities. No
// gradient, no iteration -- the counts *are* the answer for a static prior.

import { readFileSync } from 'node:fs';

import { ONE, treeSize, Models, Encoder } from '../src/rc.js';
import { SLOT, SLOT_COUNT, TOKEN_CONTEXTS } from '../src/slots.js';
import { encodeUrl } from '../src/model.js';

const file = process.argv[2] ?? new URL('./corpus.txt', import.meta.url).pathname;

const urls = readFileSync(file, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

if (urls.length === 0) {
  console.error('no URLs in the corpus');
  process.exit(1);
}

/**
 * A real encoder that also keeps score.
 *
 * It has to be a real one: the model now picks each piece's shape by encoding
 * it three ways and taking the cheapest, and that decision depends on the
 * probabilities in force. Counting with a stub would tally a different set of
 * choices than the codec will actually make.
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

function count(prior) {
  const zero = new Float64Array(SLOT_COUNT);
  const one = new Float64Array(SLOT_COUNT);
  for (const url of urls) {
    const models = prior ? new Models(prior) : Models.uniform(SLOT_COUNT);
    encodeUrl(new Tally(models, zero, one), url);
  }
  return { zero, one };
}

// Smoothing, then a clamp away from certainty.
//
// ALPHA is the number of imaginary observations of each outcome added to every
// context before the division. It matters more than it looks: a context seen
// twice in the corpus, taken at face value, produces a confident prior that is
// *worse than knowing nothing* -- and identifier characters, which are close
// to uniform by nature, are exactly the contexts with the least evidence. The
// value here was chosen by sweeping it against tools/holdout.txt, which the
// training set never sees.
const ALPHA = Number(process.env.SQURL_ALPHA ?? 1);

// Identifier characters get their own, much stronger smoothing. A random video
// id is uniform over 64 characters by construction, so there is nothing there
// to learn -- but a corpus with a few hundred lowercase slugs in it will
// happily "learn" that capitals are unlikely, and then charge nine bits for
// every capital in the next id it meets. Shrinking these contexts hard towards
// uniform is the difference between six bits per character and eight and a half.
const TOKEN_ALPHA = Number(process.env.SQURL_TOKEN_ALPHA ?? 12);

const TOKEN_REGIONS = [
  [SLOT.segToken, TOKEN_CONTEXTS * treeSize(6)],
  [SLOT.valueToken, TOKEN_CONTEXTS * treeSize(6)],
];

const alphaFor = (slot) =>
  TOKEN_REGIONS.some(([base, size]) => slot >= base && slot < base + size)
    ? TOKEN_ALPHA
    : ALPHA;

const FLOOR = 24;                       // ~ p >= 0.6%, about 7.4 bits maximum

function fit(counts) {
  const out = new Uint16Array(SLOT_COUNT);
  let seen = 0;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const zero = counts.zero[i];
    const one = counts.one[i];
    if (zero + one === 0) {
      out[i] = ONE / 2;                 // never exercised: stay undecided
      continue;
    }
    seen++;
    const alpha = alphaFor(i);
    const p = Math.round(((one + alpha) / (zero + one + 2 * alpha)) * ONE);
    out[i] = Math.min(ONE - FLOOR, Math.max(FLOOR, p));
  }
  return { out, seen };
}

// Two passes. The first fits probabilities to choices made with no priors at
// all; the second re-counts with those priors in force, so the numbers
// describe the encoder that will actually ship.
const first = fit(count(null));
const second = fit(count(first.out));
const table = second.out;
const trained = second.seen;

// Little-endian pairs, base64: the runtime unpacks it with atob and no
// dependencies, on Node and in a worker alike.
const bytes = Buffer.alloc(SLOT_COUNT * 2);
for (let i = 0; i < SLOT_COUNT; i++) bytes.writeUInt16LE(table[i], i * 2);
const base64 = bytes.toString('base64');

const out = process.stdout;
out.write('// GENERATED FILE -- do not edit by hand.\n');
out.write('// Regenerate with: npm run train\n');
out.write('//\n');
out.write(`// Starting probabilities for all ${SLOT_COUNT} contexts, fitted to\n`);
out.write(`// ${urls.length} URLs in tools/corpus.txt. 12-bit fixed point, little-endian\n`);
out.write('// pairs, base64. A context the corpus never exercised is left at 1/2.\n\n');
out.write('export const PRIOR =\n');

for (let i = 0; i < base64.length; i += 96) {
  const chunk = base64.slice(i, i + 96);
  const last = i + 96 >= base64.length;
  out.write(`  '${chunk}'${last ? ';' : ' +'}\n`);
}

console.error(`trained ${trained}/${SLOT_COUNT} contexts on ${urls.length} URLs (alpha ${ALPHA}, token ${TOKEN_ALPHA})`);

// Score the result on URLs it was not fitted to, so a prior that memorised the
// corpus cannot look like a prior that learned something.
const holdout = new URL('./holdout.txt', import.meta.url).pathname;
try {
  const { Models, Encoder } = await import('../src/rc.js');
  const sample = readFileSync(holdout, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  let bytes = 0;
  let chars = 0;
  for (const url of sample) {
    const enc = new Encoder(new Models(table));
    encodeUrl(enc, url);
    bytes += enc.finish().length;
    chars += url.length;
  }
  console.error(`holdout: ${bytes} bytes for ${chars} characters (${(bytes / chars).toFixed(4)} B/char)`);
} catch (err) {
  console.error(`holdout skipped: ${err.message}`);
}
