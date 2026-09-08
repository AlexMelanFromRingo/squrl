// Learns src/prior.js from tools/corpus.txt.
//
//   npm run train                    # writes src/prior.js
//   node tools/train.mjs urls.txt > src/prior.js
//
// A range coder is only as good as the probabilities it starts from, and a
// single short URL gives an adaptive model nothing to adapt to -- by the time
// it has learned that schemes are usually https, the URL is over. So the
// starting probabilities are fitted here, once, over a corpus, and shipped.
//
// The smoothing constants come from tools/sweep.mjs, which chooses them by
// cross-validation on this same corpus. tools/holdout.txt is not read here, or
// there, or anywhere except the benchmark.

import { SLOT_COUNT } from '../src/slots.js';
import { readUrls, train, score } from './fit.mjs';

const ALPHA = Number(process.env.SQURL_ALPHA ?? 0.5);
const TOKEN_ALPHA = Number(process.env.SQURL_TOKEN_ALPHA ?? 8);

const file = process.argv[2] ?? new URL('./corpus.txt', import.meta.url).pathname;
const urls = readUrls(file);

if (urls.length === 0) {
  console.error('no URLs in the corpus');
  process.exit(1);
}

const { table, trained } = train(urls, { alpha: ALPHA, tokenAlpha: TOKEN_ALPHA });

// Little-endian pairs, base64: the runtime unpacks it with atob and no
// dependencies, on Node and in a browser alike.
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

console.error(`trained ${trained}/${SLOT_COUNT} contexts on ${urls.length} URLs `
  + `(alpha ${ALPHA}, token ${TOKEN_ALPHA})`);

// Score on URLs it was not fitted to, so a prior that memorised the corpus
// cannot look like a prior that learned something.
try {
  const holdout = readUrls(new URL('./holdout.txt', import.meta.url).pathname);
  const { bytes: total, chars, perChar } = score(holdout, table);
  console.error(`holdout: ${total} bytes for ${chars} characters (${perChar.toFixed(4)} B/char)`);
} catch (err) {
  console.error(`holdout skipped: ${err.message}`);
}
