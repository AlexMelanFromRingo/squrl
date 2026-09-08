import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strip } from '../src/tracking.js';

test('campaign parameters go, everything else stays', () => {
  const { url, removed } = strip(
    'https://example.com/p?id=42&utm_source=news&utm_medium=email&sort=asc&gclid=XYZ',
  );
  assert.equal(url, 'https://example.com/p?id=42&sort=asc');
  assert.deepEqual(removed, ['utm_source=news', 'utm_medium=email', 'gclid=XYZ']);
});

test('a URL with nothing to strip comes back untouched, character for character', () => {
  for (const url of [
    'https://example.com/',
    'https://example.com/?a=1&b=2',
    'https://example.com/?',
    'https://example.com/#fragment',
    'https://example.com/?a=1#fragment',
  ]) {
    const result = strip(url);
    assert.equal(result.url, url, url);
    assert.deepEqual(result.removed, []);
  }
});

test('the query disappears entirely when it was all tracking', () => {
  assert.equal(strip('https://example.com/page?utm_source=x&fbclid=y').url,
    'https://example.com/page');
});

test('the fragment is left alone', () => {
  assert.equal(strip('https://example.com/p?utm_source=x#section').url,
    'https://example.com/p#section');
});

test('a parameter that merely starts like one is kept', () => {
  const { url } = strip('https://example.com/?utmost=1&sid=2&sis=3');
  assert.equal(url, 'https://example.com/?utmost=1&sid=2&sis=3');
});

test('share ids are treated as tracking, because that is what they are', () => {
  assert.equal(strip('https://youtu.be/abc?si=TRACKME').url, 'https://youtu.be/abc');
});
