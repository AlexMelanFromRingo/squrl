<h1 align="center">squrl</h1>

<p align="center">
  <b>A URL compressor whose output is still a link.</b><br>
  Not a shortener: nothing is stored anywhere, because the address is inside
  the link.
</p>

---

## The idea

A URL is not text. It is a structure that happens to be written as text, and
almost every character in it is predictable.

```
https://www.youtube.com/watch?v=dQw4w9WgXcQ
^^^^^^^^                                        8 characters ... or one bit
```

There are two schemes worth having. One bit distinguishes them — and once a
model knows that ninety-something percent of URLs are `https`, the bit costs
**0.05 bits**, because that is what arithmetic coding does with a decision you
were already sure about. `www.` is another flag. `youtube.com` is an index into
a list. `/watch` is a word. What is left — `dQw4w9WgXcQ` — is a random
identifier, and eleven random characters are eleven random characters: nothing
compresses those, and any tool that claims otherwise is storing them in a
database and handing you a receipt.

That is the whole design. Predict the predictable parts, spend real bits only
on the rest, and write the result in an alphabet a QR code likes.

```console
$ squrl explain 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'
https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s
49 characters, 392 bits as text

  scheme      0.05 bits
  host         7.9 bits  ##
  path         9.4 bits  ###
  query      109.4 bits  ###################################
  fragment    0.06 bits
  --------- -----------
  total      126.8 bits  -> 16 bytes

  link  https://sq.gy/3FW1PKGIWMQCIJRGQTZ697DAN
        39 characters, 20% shorter
```

Eight bits for `https://www.youtube.com`, nine for `/watch`, and a hundred and
nine for the query -- the video id and a timestamp. That last number is not a
failure: `dQw4w9WgXcQ` is eleven characters drawn from an alphabet of 64, which
is 66 bits of genuine randomness, and no model gets those for free.

## Not a shortener

| | bit.ly and friends | squrl |
|---|---|---|
| where the URL lives | in their database | in the link |
| what happens when the service dies | every link dies | run the code, links still work |
| link expiry | their policy | there is nothing to expire |
| who sees your links | they do, and their analytics | whoever runs the redirector, and nobody else |
| same URL twice | two rows, maybe two links | byte-identical link, always |
| offline | impossible | `squrl expand` needs no network |

The redirector in `server/` has no storage of any kind. It decompresses the
path and answers `301`. You can host it, or a friend can, or you can decode
links on a laptop with no internet at all — the payload is self-contained.

## Quick start

```bash
git clone https://github.com/AlexMelanFromRingo/squrl
cd squrl && npm link          # no dependencies to install; there are none

squrl 'https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D0%B4_%D0%A5%D0%B0%D1%84%D1%84%D0%BC%D0%B0%D0%BD%D0%B0'
# https://sq.gy/HLJ63L67JHR82RMSCE4YQBYYLD6H

squrl expand https://sq.gy/HLJ63L67JHR82RMSCE4YQBYYLD6H
# https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D0%B4_%D0%A5%D0%B0%D1%84%D1%84%D0%BC%D0%B0%D0%BD%D0%B0

squrl qr 'https://example.com/some/page'          # draws it in the terminal
squrl qr 'https://example.com/some/page' --svg code.svg
squrl explain 'https://example.com/some/page'     # where every bit went
squrl bench                                        # measured, on unseen URLs
```

Node 18 or newer. `dependencies` is `{}` and stays that way.

## It has to work with a phone camera

That requirement decides more of this design than compression does.

A camera app opens URLs. It does not know about squrl, will not install
anything, and will not run a decoder. So the compressed form has to *be* a URL:
a short host, and the payload as the path.

```
HTTPS://SQ.GY/3FW1PKGIWMQCIJRGQTZ697DAN
```

Point any phone at a QR code of that and it opens the video — through one
`301` from a server that stores nothing. Every link in the benchmark was turned
into a QR code and read back with an independent decoder to check that claim,
not assumed.

**Why uppercase, and why no `-` or `_`.** A QR code has a dedicated
*alphanumeric* mode covering `0-9 A-Z` and nine punctuation marks, and it packs
two characters into eleven bits: **5.5 bits per character** against the 8 that
byte mode spends. Every lowercase letter in a URL forces the whole symbol into
byte mode. So the payload is uppercase base36 and the prefix is written
uppercase too, which keeps the entire link in the cheap mode:

| encoding | characters per byte | QR bits per byte | |
|---|---:|---:|---|
| base64url | 1.33 | 10.7 | shortest as text, but drops the QR into byte mode |
| base32 | 1.60 | 8.8 | fine, and 3% longer than it needs to be |
| **base36** | **1.55** | **8.5** | what squrl uses |

Base36 is also the alphabet with no `0`/`O` ambiguity in *the format* (there is
no lowercase to confuse it with), nothing a chat client will swallow at the end
of a sentence, and nothing that changes when a keyboard capitalises it — the
redirector accepts either case.

## How much smaller

Measured with `npm run bench` on `tools/holdout.txt` — 74 URLs the model was
deliberately **not** trained on:

| | original | compressed | |
|---|---:|---:|---:|
| characters | 4093 | 3499 | 85% |
| payload bytes | 4093 | 1580 | 39% |
| QR modules | 72850 | 54586 | 75% |

59 of 74 links came out shorter as text. 65 needed a smaller QR version, 9 came
out the same size, none got bigger.

Those two numbers — 39% and 85% — are the honest shape of the thing. The
*compression* is better than two to one. The *link* is only 15% shorter,
because `https://sq.gy/` is fourteen characters of overhead and base36 costs
1.55 characters per byte. Both eat into the win, and on short URLs they eat all
of it:

| original URL | count | characters | QR modules |
|---|---:|---:|---:|
| 0-40 chars | 16 | 93% | 81% |
| 40-60 chars | 28 | 89% | 76% |
| 60-90 chars | 28 | 84% | 74% |
| 90+ chars | 2 | 57% | 56% |

**Under about 35 characters, don't bother.** A short URL is already shorter
than any redirector prefix plus a payload, and squrl will hand you back
something longer. It says so when it does.

Where it shines is the kind of link people actually paste at each other:

| URL | before | after | QR |
|---|---:|---:|---|
| `https://www.youtube.com/watch?v=kJQP7kiw5Fk&t=90s` | 49 | 39 | v3 29² byte → v2 25² alnum |
| `https://ru.wikipedia.org/wiki/%D0%9A%D0%BE%D0%B4_...` | 97 | 42 | v5 37² byte → v2 25² alnum |
| `https://tracker.example.net/c?utm_source=facebook...` | 126 | 84 | v6 41² byte → v4 33² alnum |

The Cyrillic one is the clearest case: percent-encoded UTF-8 is three
characters per byte in a URL, and squrl decodes it back to bytes before coding
it, so 97 characters become 42 and the QR drops from 1369 modules to 625.

## How it works

Four passes, each of which can be read on its own.

**1. Split, losslessly.** `src/parse.js` cuts the URL into scheme, userinfo,
host, port, path, query and fragment, and guarantees one thing:
`join(split(url)) === url`, byte for byte. Nothing is normalised — not a
default port, not a trailing slash, not the case of a percent escape — because
a compressor that tidies your URL hands back a link to a different page.

**2. Describe it as decisions.** `src/model.js` turns the parts into a stream
of binary questions: *is it https? is the host in the list? which index? is
this segment a word, a number, a hash, an identifier, a filename, percent-
escaped text?* Each shape has its own coder, and each piece is encoded **every
way that fits** against a copy of the model, with the cheapest one written for
real. The shape travels in the stream, so the decoder is told rather than
guessing.

**3. Price the decisions.** `src/rc.js` is a binary range coder. A decision the
model expected costs a fraction of a bit; a surprising one costs several. The
probabilities it starts from are in `src/prior.js`, fitted by `npm run train`
over `tools/corpus.txt` — a single short URL gives an adaptive model nothing to
adapt to, so the priors have to arrive already knowing what URLs look like.

**4. Write it in base36.** `src/base36.js`, for the QR reasons above.

Then it checks its own work. `pack()` **decodes its own output and compares it
to the input**, and if anything differs at all it throws the result away and
re-encodes the URL as one run of plain text, which always round-trips. A
compressor that is wrong about your URL must cost you bytes, never correctness.

### The QR encoder

`src/qr.js` is a from-scratch QR encoder — Reed-Solomon over GF(256), the four
masking penalty rules, format and version BCH, versions 1 to 20 at all four
error correction levels. It exists because "the QR code is smaller" is a claim,
and a claim needs a measurement.

Almost nothing in it is tabulated. The module layout is built, the codeword
capacity is *counted off that layout*, and the block structure follows from two
numbers per version. Which leaves room to be wrong in interesting ways, so
`tools/qr-check.mjs` compares every symbol it can produce — 20 versions × 4
levels × 3 masks — against an independent implementation, module for module:

```
matched 240 of 240
```

That check found both of the bugs that survived the first draft: format
information is written most significant bit first, and the module at (n−8, 8)
is not a format bit at all — it is the dark module, and writing a format bit
over it produces a symbol that looks perfect and scans as nothing.

## Running the redirector

```bash
npm start                          # node server/redirect.js, listens on :8787
PORT=3000 npm start
wrangler deploy server/worker.js   # or an edge runtime; there is no I/O to do
```

```
GET /3FW1PKGIWMQCIJRGQTZ697DAN            -> 301, Location: the original URL
GET /3FW1PKGIWMQCIJRGQTZ697DAN?preview    -> a page showing where it goes
GET /health                               -> ok
```

The redirect is `301` with `max-age=31536000, immutable`, because the mapping
is arithmetic rather than a routing decision: that payload has always meant
that URL and always will.

What the redirector will not do: follow anything that is not `http` or `https`
(a `javascript:` payload gets a preview page, not a redirect), or put a decoded
string into a `Location` header without checking it. Fuzzing the running server
turned up a random payload that decoded to a URL containing a newline — header
injection, one accident away — so control characters and whitespace are refused
outright and non-ASCII is percent-encoded, as a browser would.

## Tracking parameters

The single biggest win available is not compression:

```console
$ squrl 'https://www.ozon.ru/product/...-9876543210/?utm_source=yandex&utm_medium=cpc&utm_campaign=autumn'
https://sq.gy/EWE74NGMQJVF38L2022TKB3WGJ4XZL31QYM3SKJWFECY3U2WC37T6JNO4ICY
118 chars -> 74 (39 bytes of payload, -44 chars)

$ squrl --strip-tracking 'https://www.ozon.ru/product/...-9876543210/?utm_source=yandex&utm_medium=cpc&utm_campaign=autumn'
dropped 3 tracking parameter(s): utm_source=yandex utm_medium=cpc utm_campaign=autumn
https://sq.gy/1XTX9LTIS2O0QUFBOP8WE6XRLUD5ORFMG51J6XQUZZ
65 chars -> 56 (27 bytes of payload, -9 chars)
```

Three campaign parameters were 53 of the URL's 118 characters, and 12 of the
39 bytes they compressed to.

`utm_*`, `gclid`, `fbclid`, `si` and the rest are frequently half the
characters in a shared link and carry nothing a reader needs. Stripping them is
**off by default and always announced**, because it changes the URL — and this
is the one place squrl will do that.

## Compatibility, honestly

The dictionaries in `src/dict.js` and the priors in `src/prior.js` are **part of
the wire format**, not tuning knobs. Change either and old payloads decode to
something else — silently, since a range coder has no checksum to fail. If you
retrain on your own corpus:

- links made before the retraining stop meaning what they meant;
- so bump `VERSION` in `src/model.js` and keep the old tables around if you
  need both to work.

The format leaves room for that: the version is two bits, where `3` means "a
number follows", so there is no cliff at version four.

Two more things worth saying plainly. A payload is **not encrypted** — anyone
holding this library reads it, and that is the point. And whoever runs the
redirector sees the traffic; that is inherent to being the host a camera dials,
which is why the whole server is one dependency-free file you can run yourself.

## Tests

```bash
npm test        # 58 tests, node:test, no framework
```

The ones that matter are the round-trip tests: every URL in the corpus, every
URL in the holdout, a list of deliberately awkward ones (`?` with no query, `#`
with no fragment, `//` inside a path, lowercase percent escapes, IPv6 literals,
raw Cyrillic, 2000 characters of path), and 2000 URLs assembled from random
pieces — all compared byte for byte after a round trip. Then 5000 random
payloads thrown at the decoder to check it refuses them cleanly instead of
allocating the world, and 4000 more thrown at the redirector to check nothing
reaches a `Location` header that should not.

## License

MIT.
