import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALPHABETS, ALPHABET_COUNT, ALPHABET_SLOTS,
  fit, offsetOf, sizeOf, symbolAt, indexOf,
} from '../src/alphabet.js';
import { boundedSize } from '../src/rc.js';
import { pack } from '../src/codec.js';

test('the ladder runs narrowest first, which is what makes fit() cheapest-first', () => {
  for (let i = 1; i < ALPHABETS.length; i++) {
    assert.ok(ALPHABETS[i].length >= ALPHABETS[i - 1].length);
  }
});

test('every alphabet is a set, and every symbol survives the round trip', () => {
  for (let id = 0; id < ALPHABET_COUNT; id++) {
    const alphabet = ALPHABETS[id];
    assert.equal(new Set(alphabet).size, alphabet.length, `alphabet ${id} repeats a symbol`);

    for (let i = 0; i < alphabet.length; i++) {
      assert.equal(indexOf(id, symbolAt(id, i)), i);
    }
    assert.equal(sizeOf(id), alphabet.length);
  }
});

test('fit picks the narrowest alphabet that covers the string', () => {
  assert.equal(ALPHABETS[fit('012345')], ALPHABETS[0], 'digits');
  assert.equal(ALPHABETS[fit('how-we-scaled')].length, 28, 'lowercase and separators');
  assert.equal(ALPHABETS[fit('README')].length, 28, 'uppercase and separators');
  assert.equal(ALPHABETS[fit('abc123')].length, 38, 'lowercase and digits');
  assert.equal(ALPHABETS[fit('ABC123')].length, 38, 'uppercase and digits');
  assert.equal(ALPHABETS[fit('AbCd')].length, 54, 'both cases, no digits');
  assert.equal(ALPHABETS[fit('dQw4w9WgXcQ')].length, 64, 'everything');
});

test('anything that is not an identifier fits nowhere', () => {
  for (const text of ['', 'has space', 'dot.dot', 'per%cent', 'сложно', 'a/b', 'a=b']) {
    assert.equal(fit(text), -1, JSON.stringify(text));
  }
});

test('separators belong to every alphabet, because slugs are punctuated', () => {
  for (let id = 0; id < ALPHABET_COUNT; id++) {
    assert.notEqual(indexOf(id, '-'), undefined, `alphabet ${id} needs a hyphen`);
    assert.notEqual(indexOf(id, '_'), undefined, `alphabet ${id} needs an underscore`);
  }
});

test('the slot regions tile without overlapping', () => {
  let expected = 0;
  for (let id = 0; id < ALPHABET_COUNT; id++) {
    assert.equal(offsetOf(id), expected, `alphabet ${id} starts where the last one ended`);
    expected += boundedSize(sizeOf(id));
  }
  assert.equal(ALPHABET_SLOTS, expected);
});

test('a narrow alphabet really is cheaper than a wide one', () => {
  // Same length, same position, different character sets. The lowercase id
  // should cost about a bit a character less than the one using everything.
  const cost = (id) => pack(`https://example.com/${id}`).bytes.length;

  const lower = cost('abcdefghijklmnopqrst');
  const mixed = cost('aBcDeFgHiJkLmNoPqRsT');
  const everything = cost('aB3dE6gH9jK2mN5pQ8sT');

  assert.ok(lower < mixed, `lowercase ${lower} bytes should beat mixed case ${mixed}`);
  assert.ok(mixed <= everything, `mixed ${mixed} should not beat the full set ${everything}`);
});

test('identifier characters cost close to the alphabet they were drawn from', () => {
  // Measured at the margin, so the per-piece overhead does not distort it:
  // the difference between a 40-character id and a 20-character one.
  const bits = (id) => pack(`https://example.com/${id}`).bytes.length * 8;
  const marginal = (short, long) => (bits(long) - bits(short)) / 20;

  const digits = marginal('0'.repeat(20), '0'.repeat(40));
  assert.ok(digits < 4.2, `digits cost ${digits.toFixed(2)} bits a character`);

  const full = marginal('aB3dE6gH9jK2mN5pQ8sT', 'aB3dE6gH9jK2mN5pQ8sTuV4wX7yZ1aB3dE6gH9jK');
  assert.ok(full < 6.6, `the full alphabet costs ${full.toFixed(2)} bits a character`);
});
