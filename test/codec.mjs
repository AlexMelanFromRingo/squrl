import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pack, unpack, shorten, expand, DEFAULT_BASE, freshModels } from '../src/codec.js';
import { Encoder, putTree } from '../src/rc.js';
import { SLOT } from '../src/slots.js';
import { split, join } from '../src/parse.js';
import { LIMIT } from '../src/model.js';

const load = (name) => readFileSync(new URL(`../tools/${name}`, import.meta.url), 'utf8')
  .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

const CORPUS = load('corpus.txt');
const HOLDOUT = load('holdout.txt');

// --- the promise ------------------------------------------------------------
//
// Everything else in this project is a trade-off. This is not: a link that
// expands to something other than what was compressed points at the wrong
// page, and no compression ratio makes that acceptable.

test('every URL in the corpus survives the round trip exactly', () => {
  for (const url of CORPUS) {
    assert.equal(unpack(pack(url).bytes), url, url);
  }
});

test('so does every URL the model was never trained on', () => {
  for (const url of HOLDOUT) {
    assert.equal(unpack(pack(url).bytes), url, url);
  }
});

test('splitting a URL and putting it back changes nothing', () => {
  for (const url of [...CORPUS, ...HOLDOUT]) {
    const parts = split(url);
    if (parts) assert.equal(join(parts), url, url);
  }
});

const AWKWARD = [
  'https://example.com',
  'https://example.com/',
  'https://example.com//',
  'https://example.com/a//b',
  'https://example.com/?',
  'https://example.com/#',
  'https://example.com/?#',
  'https://example.com/?a=1&&b=2',
  'https://example.com/?=empty',
  'https://example.com/?novalue',
  'https://example.com/?a=b=c',
  'https://example.com:443/',
  'https://example.com:0/',
  'https://example.com:/',
  'http://user:pass@example.com/x',
  'http://user@example.com/',
  'https://EXAMPLE.com/CaseSensitive/PATH',
  'https://example.com/%d0%ba%d0%be%d0%b4',   // lowercase escapes must not be normalised
  'https://example.com/%D0%9A%D0%BE%D0%B4',
  'https://example.com/%41',                  // an escape for a plain letter
  'https://example.com/файл.pdf',
  'https://例え.テスト/パス',
  'https://example.com/a b',                  // a raw space, which is legal in a string
  'https://example.com/0042',                 // leading zeros are not a number
  'https://example.com/9007199254740993',     // past what a double can count
  'https://example.com/' + 'x'.repeat(2000),
  'https://[2001:db8::1]:8080/path',
  'https://192.168.1.1/admin',
  'ftp://files.example.com/pub/',
  'mailto:someone@example.com',
  'not a url at all',
  '',
  'https://',
  '://missing-scheme',
  'https://example.com/tar.gz',
  'https://example.com/.hidden',
  'https://example.com/....',
];

test('awkward URLs round trip, whatever shape the model had to use', () => {
  for (const url of AWKWARD) {
    assert.equal(unpack(pack(url).bytes), url, JSON.stringify(url));
  }
});

test('anything that is not a URL still round trips, as raw text', () => {
  const notUrls = ['hello world', '{"json":true}', '../../etc/passwd', 'привет'];
  for (const text of notUrls) {
    const result = pack(text);
    assert.equal(result.mode, 'raw', text);
    assert.equal(unpack(result.bytes), text, text);
  }
});

test('random URLs built from random pieces round trip', () => {
  // Deterministic pseudo-randomness: a failure here is reproducible.
  let seed = 20260908;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >>> 8) % n;
  };

  const CHARS = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~%!$&\'()*+,;=:@/?#[] йцукенг漢字🎉'];
  const piece = (max) => {
    let out = '';
    const length = rnd(max);
    for (let i = 0; i < length; i++) out += CHARS[rnd(CHARS.length)];
    return out;
  };

  for (let i = 0; i < 2000; i++) {
    const scheme = ['https', 'http', 'ftp', 'weird+scheme'][rnd(4)];
    const host = ['example.com', 'www.example.com', 'sub.example.co.uk', piece(12) || 'x'][rnd(4)];
    const port = rnd(4) === 0 ? `:${rnd(70000)}` : '';
    const path = rnd(3) === 0 ? '' : `/${piece(20)}/${piece(12)}`;
    const query = rnd(2) === 0 ? `?${piece(10)}=${piece(20)}&${piece(6)}` : '';
    const fragment = rnd(3) === 0 ? `#${piece(10)}` : '';
    const url = `${scheme}://${host}${port}${path}${query}${fragment}`;

    assert.equal(unpack(pack(url).bytes), url, url);
  }
});

test('compression is deterministic: the same URL always gives the same link', () => {
  const url = 'https://github.com/AlexMelanFromRingo/squrl';
  assert.equal(shorten(url).link, shorten(url).link);
  assert.deepEqual([...pack(url).bytes], [...pack(url).bytes]);
});

// --- links ------------------------------------------------------------------

test('a link is the base plus a payload of digits and capitals', () => {
  const { link, payload } = shorten('https://example.com/page');
  assert.ok(link.startsWith(DEFAULT_BASE));
  assert.match(payload, /^[0-9A-Z]+$/);
  assert.equal(link, DEFAULT_BASE + payload);
});

test('a custom base is used verbatim, with or without a trailing slash', () => {
  const a = shorten('https://example.com/x', { base: 'https://q.example' });
  const b = shorten('https://example.com/x', { base: 'https://q.example/' });
  assert.equal(a.link, b.link);
  assert.ok(a.link.startsWith('https://q.example/'));
});

test('expand takes a link, a bare payload, or the wrong case', () => {
  const url = 'https://example.com/some/page?a=1';
  const { link, payload } = shorten(url);

  assert.equal(expand(link), url);
  assert.equal(expand(payload), url);
  assert.equal(expand(payload.toLowerCase()), url);
  assert.equal(expand(`https://somewhere.else/${payload}`), url);
  assert.equal(expand(`  ${link}  `), url);
});

test('nonsense payloads are rejected rather than decoded into nonsense', () => {
  assert.throws(() => expand(''), /no payload/);
  assert.throws(() => expand('!!!'), /not base36/);
  assert.throws(() => expand(DEFAULT_BASE), /no payload/);
});

// --- what a payload may do to the decoder -----------------------------------

test('a crafted payload cannot make the decoder allocate the world', () => {
  // Every random string is a syntactically valid payload; the decoder must
  // either produce a string or refuse, never hang or exhaust memory.
  let seed = 7;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >>> 8) % n;
  };
  const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  let decoded = 0;
  let refused = 0;

  for (let i = 0; i < 5000; i++) {
    let payload = '';
    const length = 1 + rnd(48);
    for (let j = 0; j < length; j++) payload += ALPHABET[rnd(36)];

    try {
      const url = expand(payload);
      assert.equal(typeof url, 'string');
      assert.ok(url.length <= LIMIT.text * 4, 'a decoded URL stays bounded');
      decoded++;
    } catch {
      refused++;
    }
  }

  assert.ok(decoded > 0, 'some random payloads decode -- the format is dense');
  assert.ok(refused > 0, 'and some are refused');
});

test('the payload of a long URL grows, but far slower than the URL', () => {
  const short = pack('https://example.com/a').bytes.length;
  const long = pack(`https://example.com/${'a/'.repeat(200)}`).bytes.length;
  assert.ok(long > short);
  assert.ok(long < 200, 'four hundred characters of path must not cost 200 bytes');
});

test('pack refuses input it cannot represent instead of returning something wrong', () => {
  assert.throws(() => pack(undefined), /string/);
  assert.throws(() => pack(42), /string/);
});


test('a payload from another format version is named, not misread', () => {
  // The version field is priced by a frozen model precisely so this works: a
  // range-coded stream is unreadable without the probabilities that wrote it,
  // and a version field that moves with the prior cannot identify anything.
  const enc = new Encoder(freshModels());
  putTree(enc, SLOT.version, 2, 0);
  for (let i = 0; i < 64; i++) enc.bit(SLOT.mode + (i % 2), i % 3 === 0 ? 1 : 0);

  assert.throws(() => unpack(enc.finish()), /unsupported format version 0/);
});
