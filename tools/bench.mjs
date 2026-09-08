// Measures compression, and prints the tables the README quotes.
//
//   node tools/bench.mjs [urls.txt]
//
// The default input is tools/holdout.txt, which the priors in src/prior.js
// were deliberately not fitted to. Numbers from the training corpus would be
// flattering and meaningless.

import { readFileSync } from 'node:fs';

import { shorten, expand } from '../src/codec.js';
import { encode as qr } from '../src/qr.js';
import { strip } from '../src/tracking.js';

const file = process.argv[2] ?? new URL('./holdout.txt', import.meta.url).pathname;
const urls = readFileSync(file, 'utf8')
  .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

const measure = (url) => {
  const result = shorten(url);
  if (expand(result.link) !== url) throw new Error(`round trip failed: ${url}`);

  const before = qr(url, { level: 'L' });
  const after = qr(result.link.toUpperCase(), { level: 'L' });

  return {
    url,
    link: result.link,
    bytes: result.bytes.length,
    chars: [url.length, result.link.length],
    modules: [before.size ** 2, after.size ** 2],
    version: [before.version, after.version],
    mode: [before.mode, after.mode],
  };
};

const rows = urls.map(measure);
const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);

const totals = {
  chars: [sum((r) => r.chars[0]), sum((r) => r.chars[1])],
  bytes: sum((r) => r.bytes),
  modules: [sum((r) => r.modules[0]), sum((r) => r.modules[1])],
  shorter: rows.filter((r) => r.chars[1] < r.chars[0]).length,
  smallerQr: rows.filter((r) => r.modules[1] < r.modules[0]).length,
  sameQr: rows.filter((r) => r.modules[1] === r.modules[0]).length,
  biggerQr: rows.filter((r) => r.modules[1] > r.modules[0]).length,
};

const percent = (a, b) => `${Math.round((a / b) * 100)}%`;

console.log(`## Measured on ${rows.length} URLs the model has never seen\n`);
console.log('| | original | compressed | |');
console.log('|---|---:|---:|---:|');
console.log(`| characters | ${totals.chars[0]} | ${totals.chars[1]} | ${percent(totals.chars[1], totals.chars[0])} |`);
console.log(`| payload bytes | ${totals.chars[0]} | ${totals.bytes} | ${percent(totals.bytes, totals.chars[0])} |`);
console.log(`| QR modules | ${totals.modules[0]} | ${totals.modules[1]} | ${percent(totals.modules[1], totals.modules[0])} |`);
console.log(`\n${totals.shorter} of ${rows.length} links came out shorter as text. ` +
  `${totals.smallerQr} needed a smaller QR version, ${totals.sameQr} came out the same ` +
  `size, ${totals.biggerQr} got bigger.\n`);

// Length is the thing that decides whether this is worth doing, so report by
// length rather than hiding it in an average.
const BUCKETS = [[0, 40], [40, 60], [60, 90], [90, Infinity]];

console.log('## By length of the original\n');
console.log('| original URL | count | characters | QR modules |');
console.log('|---|---:|---:|---:|');
for (const [low, high] of BUCKETS) {
  const set = rows.filter((r) => r.chars[0] >= low && r.chars[0] < high);
  if (!set.length) continue;
  const chars = [set.reduce((t, r) => t + r.chars[0], 0), set.reduce((t, r) => t + r.chars[1], 0)];
  const modules = [set.reduce((t, r) => t + r.modules[0], 0), set.reduce((t, r) => t + r.modules[1], 0)];
  const label = high === Infinity ? `${low}+ chars` : `${low}-${high} chars`;
  console.log(`| ${label} | ${set.length} | ${percent(chars[1], chars[0])} | ${percent(modules[1], modules[0])} |`);
}

// A few concrete ones, because a percentage is not a URL.
const SHOWCASE = [
  'https://www.youtube.com/watch?v=kJQP7kiw5Fk&t=90s',
  'https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D0%B4_%D0%A5%D0%B0%D1%84%D1%84%D0%BC%D0%B0%D0%BD%D0%B0',
  'https://tracker.example.net/c?utm_source=facebook&utm_medium=social&utm_campaign=autumn&fbclid=IwAR9zYxWvUtSrQpOnMlKjIhGfEdCbA',
  'https://github.com/torvalds/linux',
];

console.log('\n## Examples\n');
console.log('| URL | before | after | QR |');
console.log('|---|---:|---:|---|');
for (const url of SHOWCASE) {
  const row = measure(url);
  const shown = url.length > 52 ? `${url.slice(0, 49)}...` : url;
  console.log(
    `| \`${shown}\` | ${row.chars[0]} | ${row.chars[1]} | ` +
    `v${row.version[0]} ${Math.sqrt(row.modules[0])}² ${row.mode[0]} → ` +
    `v${row.version[1]} ${Math.sqrt(row.modules[1])}² ${row.mode[1]} |`,
  );
}

// What stripping campaign parameters would add, if you allow it.
const stripped = rows.map((r) => {
  const clean = strip(r.url).url;
  return clean === r.url ? r : measure(clean);
});
const strippedChars = stripped.reduce((t, r) => t + r.chars[1], 0);
console.log(`\nWith \`--strip-tracking\`: ${percent(strippedChars, totals.chars[0])} of the ` +
  'original characters, at the cost of no longer being the same URL.');
