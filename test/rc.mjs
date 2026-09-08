import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Models, Encoder, Decoder, ONE,
  putTree, getTree, putUint, getUint, UINT_SLOTS, treeSize,
} from '../src/rc.js';

const SLOTS = 4096;
const fresh = () => Models.uniform(SLOTS);

// Deterministic pseudo-randomness, so a failure can be reproduced.
function random(seed) {
  return (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >>> 8) % n;
  };
}

test('any sequence of bits comes back exactly', () => {
  const rnd = random(1);
  for (let trial = 0; trial < 200; trial++) {
    const bits = [];
    const slots = [];
    const length = 1 + rnd(500);
    for (let i = 0; i < length; i++) {
      slots.push(rnd(SLOTS));
      bits.push(rnd(2));
    }

    const enc = new Encoder(fresh());
    for (let i = 0; i < length; i++) enc.bit(slots[i], bits[i]);
    const bytes = enc.finish();

    const dec = new Decoder(fresh(), bytes);
    for (let i = 0; i < length; i++) {
      assert.equal(dec.bit(slots[i]), bits[i], `trial ${trial}, bit ${i}`);
    }
  }
});

test('a stream of one bit costs one byte, not four', () => {
  const enc = new Encoder(fresh());
  enc.bit(0, 1);
  assert.ok(enc.finish().length <= 1, 'the flush must not pad to the full range');
});

test('predictable bits cost almost nothing', () => {
  const models = fresh();
  const enc = new Encoder(models);
  for (let i = 0; i < 4000; i++) enc.bit(0, 1);
  const bytes = enc.finish();

  assert.ok(bytes.length < 30, `4000 certain bits should not take ${bytes.length} bytes`);

  const dec = new Decoder(fresh(), bytes);
  for (let i = 0; i < 4000; i++) assert.equal(dec.bit(0), 1);
});

test('the cost the encoder reports is the size it produces', () => {
  const rnd = random(99);
  const enc = new Encoder(fresh());
  for (let i = 0; i < 3000; i++) enc.bit(rnd(64), rnd(4) === 0 ? 0 : 1);
  const bytes = enc.finish();

  // Within a byte or two: the accounting is the true information content, the
  // file is that rounded up plus the flush.
  assert.ok(Math.abs(enc.total / 8 - bytes.length) < 3, `${enc.total / 8} vs ${bytes.length}`);
});

test('models stay inside the probability range they promise', () => {
  const models = fresh();
  for (let i = 0; i < 10000; i++) models.update(0, 1);
  assert.ok(models.get(0) < ONE && models.get(0) > 0);

  for (let i = 0; i < 10000; i++) models.update(0, 0);
  assert.ok(models.get(0) > 0 && models.get(0) < ONE);
});

test('cloning a model separates it from the original', () => {
  const models = fresh();
  const copy = models.clone();
  for (let i = 0; i < 100; i++) copy.update(5, 1);
  assert.notEqual(copy.get(5), models.get(5));
});

test('trees carry any value of their width', () => {
  for (const bits of [1, 4, 8, 9]) {
    const values = [];
    const enc = new Encoder(fresh());
    for (let v = 0; v < treeSize(bits); v++) {
      values.push(v);
      putTree(enc, 0, bits, v);
    }
    const dec = new Decoder(fresh(), enc.finish());
    for (const v of values) assert.equal(getTree(dec, 0, bits), v, `width ${bits}`);
  }
});

test('numbers survive from zero to the largest a double counts', () => {
  const values = [
    0, 1, 2, 7, 8, 255, 256, 65535, 1e6, 2 ** 32, Number.MAX_SAFE_INTEGER,
  ];
  const enc = new Encoder(Models.uniform(UINT_SLOTS));
  for (const value of values) putUint(enc, 0, value);

  const dec = new Decoder(Models.uniform(UINT_SLOTS), enc.finish());
  for (const value of values) assert.equal(getUint(dec, 0), value);
});
