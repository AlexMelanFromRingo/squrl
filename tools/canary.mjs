// Regenerates src/canary.js: one payload, and what it must decode to.
//
//   node tools/canary.mjs > src/canary.js
//
// The tables in src/prior.js and src/dict.js are part of the wire format, so a
// decoder holding different ones reads a different language. Usually that is a
// deployment accident -- a browser with half of last week's modules still in
// cache -- and the symptom is a plausible-looking URL that nobody compressed.
//
// This is the tripwire. The test suite decodes it, so a retraining that forgot
// to bump VERSION fails loudly; the pages decode it at load, so a stale cache
// says so instead of sending someone to the wrong address.

import { pack, unpack } from '../src/codec.js';
import { encode36 } from '../src/base36.js';
import { VERSION } from '../src/model.js';

const URL_UNDER_TEST = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s';

const payload = encode36(pack(URL_UNDER_TEST).bytes);
if (unpack(pack(URL_UNDER_TEST).bytes) !== URL_UNDER_TEST) {
  console.error('the codec cannot round-trip its own canary');
  process.exit(1);
}

const out = process.stdout;
out.write('// GENERATED FILE -- do not edit by hand.\n');
out.write('// Regenerate with: npm run train\n');
out.write('//\n');
out.write('// A payload made by the tables this build ships, and the URL it must\n');
out.write('// come back as. Anything else means the decoder is holding different\n');
out.write('// tables -- see tools/canary.mjs.\n\n');
out.write(`export const CANARY = {\n`);
out.write(`  version: ${VERSION},\n`);
out.write(`  payload: ${JSON.stringify(payload)},\n`);
out.write(`  url: ${JSON.stringify(URL_UNDER_TEST)},\n`);
out.write('};\n');

console.error(`canary: ${payload} -> ${URL_UNDER_TEST} (format version ${VERSION})`);
