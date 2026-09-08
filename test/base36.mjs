import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encode36, decode36, CHARS_PER_BYTE } from '../src/base36.js';

const bytes = (...values) => Uint8Array.from(values);

test('bytes round trip', () => {
  let seed = 5;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) % n; };

  for (let trial = 0; trial < 500; trial++) {
    const data = Uint8Array.from({ length: rnd(60) }, () => rnd(256));
    assert.deepEqual(decode36(encode36(data)), data);
  }
});

test('leading zero bytes are preserved, not swallowed by the arithmetic', () => {
  for (const data of [bytes(0), bytes(0, 0), bytes(0, 1), bytes(0, 0, 255), bytes(1, 0)]) {
    assert.deepEqual(decode36(encode36(data)), data, [...data].join(','));
  }
  assert.equal(encode36(bytes(0, 0, 1)), '001');
});

test('the empty payload is the empty string', () => {
  assert.equal(encode36(bytes()), '');
  assert.deepEqual(decode36(''), bytes());
});

test('only digits and letters come out', () => {
  const data = Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256);
  assert.match(encode36(data), /^[0-9A-Z]+$/);
});

test('lowercase decodes the same, because phones capitalise', () => {
  const data = bytes(12, 34, 56, 78, 90);
  const text = encode36(data);
  assert.deepEqual(decode36(text.toLowerCase()), data);
});

test('characters outside the alphabet are refused', () => {
  assert.throws(() => decode36('ABC!'), /not base36/);
  assert.throws(() => decode36('hello world'), /not base36/);
});

test('expansion is what the maths says, not what a block encoder would cost', () => {
  assert.ok(Math.abs(CHARS_PER_BYTE - 1.5474) < 0.001);

  const data = Uint8Array.from({ length: 100 }, (_, i) => (i * 91 + 7) % 256);
  const chars = encode36(data).length;
  assert.ok(chars <= Math.ceil(100 * CHARS_PER_BYTE) + 1, `${chars} characters for 100 bytes`);
  assert.ok(chars < 160, 'base32 would need 160');
});
