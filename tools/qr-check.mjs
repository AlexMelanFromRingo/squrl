// Dumps QR matrices for tools/qr-check.py to compare against a reference
// implementation.
//
//   node tools/qr-check.mjs > /tmp/qr.json
//   python3 -m venv /tmp/qrv && /tmp/qrv/bin/pip install qrcode
//   /tmp/qrv/bin/python tools/qr-check.py /tmp/qr.json
//
// The encoder in src/qr.js derives almost everything -- codeword counts, block
// sizes, alignment positions -- from the module layout rather than from tables,
// which is only trustworthy if something independent agrees. This is how the
// error correction table was checked, and how the two bugs that survived
// first-draft testing (the format bits are written most significant first, and
// the module at (n-8, 8) is not a format bit) were found.

import { encode, capacity, LEVELS, MAX_VERSION } from '../src/qr.js';

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let seed = 20260908;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed >>> 8) % n;
};

const cases = [];

for (let version = 1; version <= MAX_VERSION; version++) {
  for (const [level, index] of Object.entries(LEVELS)) {
    const room = capacity(version, index).data * 8;
    const countBits = version <= 9 ? 9 : 11;
    // Fill the version nearly to the top: a block structure that is wrong
    // shows up in the last block, not the first.
    const chars = Math.floor((room - 4 - countBits) / 11) * 2;

    let text = '';
    for (let i = 0; i < Math.max(1, chars - rnd(3)); i++) text += ALNUM[rnd(36)];

    for (const mask of [0, 3, 7]) {
      const symbol = encode(text, { level, version, mask });
      cases.push({
        text, version, level, mask,
        size: symbol.size,
        matrix: symbol.matrix.map((row) => row.join('')),
      });
    }
  }
}

process.stdout.write(JSON.stringify(cases));
console.error(`${cases.length} symbols across ${MAX_VERSION} versions`);
