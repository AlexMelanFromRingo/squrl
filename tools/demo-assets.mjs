// Regenerates the images the README shows.
//
//   node tools/demo-assets.mjs
//
// They are generated rather than drawn, for the same reason the benchmark is
// measured rather than estimated: a picture of a claim should be produced by
// the thing making the claim.

import { writeFileSync } from 'node:fs';

import { shorten } from '../src/codec.js';
import { encode, toSvg } from '../src/qr.js';

const out = (name, body) => {
  writeFileSync(new URL(`../docs/${name}`, import.meta.url), body);
  return name;
};

// 1. A QR that actually goes somewhere: the live page, which compresses links
//    in the browser. Scanning this is the fastest way to see the thing work.
const DEMO_PAGE = 'HTTPS://ALEXMELANFROMRINGO.GITHUB.IO/SQURL/';
const page = encode(DEMO_PAGE, { level: 'M' });
out('qr-demo.svg', toSvg(page, { scale: 6, quiet: 4 }));

// 2. The comparison, drawn at the same module scale so the sizes are honest:
//    one URL, encoded as itself and as a squrl link. The prefix here is a
//    five-character host, which is the kind you would register for this --
//    the README says so next to the picture.
//
//    A percent-encoded URL, because that is the case with the most to gain and
//    the README says that too: three characters per byte in the original, and
//    squrl decodes the escapes back to bytes before coding them.
const SAMPLE = 'https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D0%B4_%D0%A5%D0%B0%D1%84%D1%84%D0%BC%D0%B0%D0%BD%D0%B0';
const link = shorten(SAMPLE, { base: 'https://sq.gy/' }).link.toUpperCase();

const before = encode(SAMPLE, { level: 'L' });
const after = encode(link, { level: 'L' });

out('qr-before.svg', toSvg(before, { scale: 4, quiet: 3 }));
out('qr-after.svg', toSvg(after, { scale: 4, quiet: 3 }));

console.log(`demo page   ${DEMO_PAGE}`);
console.log(`  version ${page.version}, ${page.size}x${page.size}, ${page.mode} mode`);
console.log(`comparison  ${SAMPLE.length} chars -> ${link.length} chars`);
console.log(`  before: version ${before.version}, ${before.size}x${before.size}, ${before.mode}`);
console.log(`  after:  version ${after.version}, ${after.size}x${after.size}, ${after.mode}`);
console.log(`  ${((after.size ** 2) / (before.size ** 2) * 100).toFixed(0)}% of the modules`);
