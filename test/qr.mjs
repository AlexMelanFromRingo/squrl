import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encode, capacity, modeFor, toSvg, toText, LEVELS, MAX_VERSION, BLOCKS } from '../src/qr.js';

// These matrices were produced by this encoder and then compared module for
// module against an independent implementation (see tools/qr-check.mjs, which
// checks all twenty versions at all four levels). They are here so a
// regression shows up without needing that reference installed.
const FIXTURES = [
  {
    text: "HTTPS://SQ.GY/1NSY088LB61Q6BJ8S7D",
    level: "L", mask: 2, version: 2, mode: "alnum",
    rows: [
      "1111111000101001101111111",
      "1000001010100111001000001",
      "1011101000001011001011101",
      "1011101011101100001011101",
      "1011101001000000001011101",
      "1000001011011100101000001",
      "1111111010101010101111111",
      "0000000001110010100000000",
      "1111101111010100010101010",
      "0110000110101101111010000",
      "0010001000100011111000011",
      "1010000110001010101010000",
      "0010011001101110101101000",
      "1011010110000111100100000",
      "1011001010011111001011100",
      "1010100001110001000111011",
      "1001011111110111111110101",
      "0000000010001110100010110",
      "1111111011100001101010000",
      "1000001001001111100010101",
      "1011101011101001111110001",
      "1011101010000111011010011",
      "1011101011111101011110001",
      "1000001011110001101011000",
      "1111111010011000101101001",
    ],
  },
  {
    text: "https://example.com/",
    level: "M", mask: 5, version: 2, mode: "byte",
    rows: [
      "1111111001101010001111111",
      "1000001011110110101000001",
      "1011101011111010001011101",
      "1011101010110100101011101",
      "1011101001010100101011101",
      "1000001001000010001000001",
      "1111111010101010101111111",
      "0000000010110011100000000",
      "1000001010010100011001110",
      "1101110111110111110111110",
      "0001101011100111100101011",
      "0011100101001010101101001",
      "1111011011110111101100001",
      "1010000101101101100100010",
      "1000011101100111001111011",
      "1001110111101110011101101",
      "1000001100101010111110100",
      "0000000010000000100010000",
      "1111111000101110101010001",
      "1000001000110011100010001",
      "1011101000110001111110111",
      "1011101000001100111000011",
      "1011101001000111000001101",
      "1000001001101101110110001",
      "1111111010011100101001001",
    ],
  },
  {
    text: "12345678901234567890",
    level: "H", mask: 0, version: 2, mode: "numeric",
    rows: [
      "1111111011110001001111111",
      "1000001001011100101000001",
      "1011101001101011101011101",
      "1011101011000011101011101",
      "1011101000110100101011101",
      "1000001000110011101000001",
      "1111111010101010101111111",
      "0000000001001000000000000",
      "0010111010101101010001001",
      "0010010011011010010101011",
      "0010001000011000010011001",
      "1001100101000010111101001",
      "0111001010010110110111111",
      "0000000011010111110010001",
      "1001001000010001101001100",
      "0100110100000100100111001",
      "1001101001011001111110111",
      "0000000010000010100011010",
      "1111111000000110101011001",
      "1000001010011111100011000",
      "1011101011011010111111111",
      "1011101001011010010000010",
      "1011101011110010111001101",
      "1000001001011101001111100",
      "1111111001110011000001101",
    ],
  },
];

test('known symbols come out exactly as they did when verified', () => {
  for (const fixture of FIXTURES) {
    const symbol = encode(fixture.text, { level: fixture.level, mask: fixture.mask });
    assert.equal(symbol.version, fixture.version, fixture.text);
    assert.equal(symbol.mode, fixture.mode, fixture.text);
    assert.deepEqual(symbol.matrix.map((row) => row.join('')), fixture.rows, fixture.text);
  }
});

test('the mode is the cheapest one that can spell the text', () => {
  assert.equal(modeFor('12345'), 'numeric');
  assert.equal(modeFor('HTTPS://SQ.GY/ABC'), 'alnum');
  assert.equal(modeFor('https://sq.gy/abc'), 'byte', 'lowercase forces byte mode');
  assert.equal(modeFor('привет'), 'byte');
});

test('a squrl link stays in alphanumeric mode, which is the whole point', () => {
  const symbol = encode('HTTPS://SQ.GY/1NSY088LB61Q6BJ8S7D', { level: 'L' });
  assert.equal(symbol.mode, 'alnum');
});

test('capacity is consistent with the block structure at every version', () => {
  for (let version = 1; version <= MAX_VERSION; version++) {
    for (const [level, index] of Object.entries(LEVELS)) {
      const { total, data, ec, blocks } = capacity(version, index);
      assert.equal(data + ec * blocks, total,
        `version ${version}${level}: data + ec must fill the symbol`);
      assert.ok(data > 0, `version ${version}${level} has room for data`);
      assert.ok(data >= blocks, `version ${version}${level}: every block needs a codeword`);
      assert.deepEqual(BLOCKS[version - 1][index], [ec, blocks]);
    }
  }
});

test('stronger error correction never holds more data', () => {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const sizes = ['L', 'M', 'Q', 'H'].map((level) => capacity(version, LEVELS[level]).data);
    for (let i = 1; i < sizes.length; i++) {
      assert.ok(sizes[i] <= sizes[i - 1], `version ${version}: capacity must not grow with EC`);
    }
  }
});

test('the smallest version that fits is the one chosen', () => {
  const short = encode('HELLO', { level: 'L' });
  assert.equal(short.version, 1);
  assert.equal(short.size, 21);

  const longer = encode('A'.repeat(100), { level: 'L' });
  assert.ok(longer.version > 1);
  assert.equal(longer.size, longer.version * 4 + 17);

  const smaller = encode('A'.repeat(100), { level: 'H' });
  assert.ok(smaller.version > longer.version, 'more error correction needs more room');
});

test('text too large for the supported versions is refused, not truncated', () => {
  assert.throws(() => encode('A'.repeat(20000), { level: 'H' }), /more than version/);
});

test('an unknown error correction level is refused', () => {
  assert.throws(() => encode('X', { level: 'Z' }), /error correction/);
});

test('masking is deterministic and the automatic choice is the lowest penalty', () => {
  const text = 'HTTPS://SQ.GY/ABCDEF123456';
  const auto = encode(text, { level: 'L' });
  const forced = encode(text, { level: 'L', mask: auto.mask });
  assert.deepEqual(auto.matrix, forced.matrix);

  for (let mask = 0; mask < 8; mask++) {
    assert.ok(encode(text, { level: 'L', mask }).penalty >= auto.penalty);
  }
});

test('the finder patterns are where a scanner looks for them', () => {
  const { matrix, size } = encode('HELLO WORLD', { level: 'L' });
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    assert.equal(matrix[top][left], 1);
    assert.equal(matrix[top + 1][left + 1], 0);
    assert.equal(matrix[top + 3][left + 3], 1, 'the core of the finder is dark');
  }
  assert.equal(matrix[size - 8][8], 1, 'the dark module is always set');
});

test('SVG and text renderings describe the same symbol', () => {
  const symbol = encode('HTTPS://SQ.GY/ABC', { level: 'L' });
  const svg = toSvg(symbol, { scale: 4, quiet: 2 });
  const span = (symbol.size + 4) * 4;

  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes(`width="${span}"`));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));

  const text = toText(symbol, { quiet: 1 });
  const lines = text.split('\n');
  assert.equal(lines[0].length, symbol.size + 2, 'one column per module plus quiet zone');
  assert.ok(lines.every((line) => /^[█▀▄ ]+$/.test(line)));
});
