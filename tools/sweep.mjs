// Chooses the smoothing constants, without touching the holdout.
//
//   node tools/sweep.mjs
//
// Five-fold cross-validation over tools/corpus.txt: fit on four fifths, score
// the fifth, average. The winner goes into the defaults at the top of
// tools/train.mjs. Doing this against tools/holdout.txt instead would be
// easier and would quietly turn the benchmark into a training score.

import { readUrls, train, score } from './fit.mjs';

const FOLDS = 5;
const ALPHAS = [0.25, 0.35, 0.5, 0.75, 1, 1.5, 2];
const TOKEN_ALPHAS = [4, 8, 12, 16, 24, 48];

const urls = readUrls(new URL('./corpus.txt', import.meta.url).pathname);

// Deal the URLs round-robin rather than in blocks: the corpus is written in
// themed runs, and a contiguous fifth of it would be all one kind of link.
const folds = Array.from({ length: FOLDS }, (_, f) => urls.filter((_, i) => i % FOLDS === f));

function crossValidate(options) {
  let bytes = 0;
  let chars = 0;

  for (let f = 0; f < FOLDS; f++) {
    const trainSet = folds.filter((_, i) => i !== f).flat();
    const testSet = folds[f];
    const { table } = train(trainSet, options);
    const result = score(testSet, table);
    bytes += result.bytes;
    chars += result.chars;
  }

  return bytes / chars;
}

const results = [];
for (const alpha of ALPHAS) {
  for (const tokenAlpha of TOKEN_ALPHAS) {
    const perChar = crossValidate({ alpha, tokenAlpha });
    results.push({ alpha, tokenAlpha, perChar });
    console.log(`alpha ${String(alpha).padEnd(5)} token ${String(tokenAlpha).padEnd(3)} -> ${perChar.toFixed(4)} B/char`);
  }
}

results.sort((a, b) => a.perChar - b.perChar);
const best = results[0];
console.log(`\nbest: alpha ${best.alpha}, tokenAlpha ${best.tokenAlpha} (${best.perChar.toFixed(4)} B/char, ${FOLDS}-fold)`);
