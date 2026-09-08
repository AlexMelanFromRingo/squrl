// Answers the two questions everybody asks: why not gzip, and why not a table
// of one-byte codes for the common strings.
//
//   node tools/vs-generic.mjs
//
// Both are reasonable ideas, and both are measurably worse here. Rather than
// asserting that, this runs them: zlib and brotli come with Node, xz and bzip2
// are used if they happen to be installed, and the byte table is built from
// this project's own dictionaries and given the best 128 entries it can have.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

import { pack } from '../src/codec.js';
import { HOSTS, WORDS, TLDS, EXTENSIONS } from '../src/dict.js';

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
  .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

const urls = read('holdout.txt');
const corpus = read('corpus.txt');

const SAMPLE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s';

// --- general-purpose compressors --------------------------------------------

// A preset dictionary is the fairest possible version of "a table of common
// strings" inside a classical compressor: deflate may reference it as though
// it had already seen that text.
const DICTIONARY = Buffer.from(
  ['https://www.', 'http://www.', 'https://', 'http://', '.html', 'index',
    ...HOSTS, ...WORDS, ...TLDS].join(''),
);

const available = (binary) => {
  try {
    execFileSync('which', [binary], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const methods = {
  'gzip -9': (b) => zlib.gzipSync(b, { level: 9 }).length,
  'deflate, raw, -9': (b) => zlib.deflateRawSync(b, { level: 9 }).length,
  'deflate with a preset dictionary': (b) =>
    zlib.deflateRawSync(b, { level: 9, dictionary: DICTIONARY }).length,
  'brotli q11 (ships a web dictionary)': (b) => zlib.brotliCompressSync(b, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: 64,
    },
  }).length,
};

if (available('xz')) {
  methods['xz -9 (lzma2)'] = (b) =>
    execFileSync('xz', ['-9', '-c', '-F', 'raw', '--lzma2=preset=9e'], { input: b }).length;
}
if (available('bzip2')) {
  methods['bzip2 -9'] = (b) => execFileSync('bzip2', ['-9', '-c'], { input: b }).length;
}

// --- one byte per table entry ------------------------------------------------
//
// The classic scheme: 128 codes for table entries, 128 for ASCII literals, one
// byte per token, greedy longest match. The table gets the 128 entries that
// save the most on the training corpus, so it is as good as such a table gets.

const candidates = [
  'https://www.', 'http://www.', 'https://', 'http://', 'www.',
  ...HOSTS, ...WORDS.map((word) => `/${word}`), ...WORDS,
  ...TLDS.map((tld) => `.${tld}`), ...EXTENSIONS.map((ext) => `.${ext}`),
  '?utm_source=', '&utm_medium=', '&utm_campaign=',
];

const savings = new Map();
for (const text of corpus) {
  for (const entry of candidates) {
    if (entry.length < 2) continue;
    let at = 0;
    let hits = 0;
    while ((at = text.indexOf(entry, at)) !== -1) { hits++; at += entry.length; }
    // One byte replaces entry.length bytes, so each hit saves length - 1.
    if (hits) savings.set(entry, (savings.get(entry) ?? 0) + hits * (entry.length - 1));
  }
}

const TABLE = [...savings.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 128)
  .map(([entry]) => entry)
  .sort((a, b) => b.length - a.length);       // longest match first

function byteTable(buffer) {
  const url = buffer.toString();
  let bytes = 0;
  let at = 0;

  outer: while (at < url.length) {
    for (const entry of TABLE) {
      if (url.startsWith(entry, at)) {
        bytes++;
        at += entry.length;
        continue outer;
      }
    }
    // A literal. Anything outside ASCII needs more than one code, and URLs
    // carry UTF-8, so it is charged its real bytes.
    bytes += Buffer.byteLength(url[at]);
    at++;
  }
  return bytes;
}

methods['one byte per table entry'] = byteTable;
methods.squrl = (b) => pack(b.toString()).bytes.length;

// --- measure -----------------------------------------------------------------

const totals = new Map(Object.keys(methods).map((name) => [name, 0]));
let raw = 0;

for (const url of urls) {
  const buffer = Buffer.from(url);
  raw += buffer.length;
  for (const [name, run] of Object.entries(methods)) {
    totals.set(name, totals.get(name) + run(buffer));
  }
}

console.log(`## ${urls.length} URLs from tools/holdout.txt, ${raw} bytes of text\n`);
console.log('| method | bytes | of the original |');
console.log('|---|---:|---:|');
for (const [name, total] of [...totals].sort((a, b) => b[1] - a[1])) {
  console.log(`| ${name} | ${total} | ${Math.round((total / raw) * 100)}% |`);
}

console.log(`\n## One URL on its own — the case that actually matters\n`);
console.log(`\`${SAMPLE}\` — ${Buffer.byteLength(SAMPLE)} bytes\n`);
console.log('| method | bytes |');
console.log('|---|---:|');
const single = Object.entries(methods)
  .map(([name, run]) => [name, run(Buffer.from(SAMPLE))])
  .sort((a, b) => b[1] - a[1]);
for (const [name, size] of single) console.log(`| ${name} | ${size} |`);
