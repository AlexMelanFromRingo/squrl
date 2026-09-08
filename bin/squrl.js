#!/usr/bin/env node
// squrl — compress a URL into a link, and a QR code worth scanning.
//
//   squrl https://example.com/very/long/path?utm_source=newsletter
//   squrl expand https://sq.gy/874SKH0KGM65V2
//   squrl qr https://example.com/page --svg code.svg
//   squrl explain https://www.youtube.com/watch?v=dQw4w9WgXcQ
//   squrl bench tools/holdout.txt

import { readFileSync, writeFileSync } from 'node:fs';

import { shorten, expand, pack, DEFAULT_BASE } from '../src/codec.js';
import { encode as qrEncode, toText, toSvg } from '../src/qr.js';
import { strip } from '../src/tracking.js';

const argv = process.argv.slice(2);

const HELP = `squrl — a URL compressor whose output is still a link

  squrl <url>                    compress; prints the link
  squrl expand <link>            decompress; prints the original URL
  squrl qr <url>                 the compressed link as a QR code
  squrl explain <url>            where every bit went
  squrl bench [file]             compression over a file of URLs

options
  --base <url>       redirector to build links against (default ${DEFAULT_BASE})
  --level <L|M|Q|H>  QR error correction (default L, the smallest)
  --svg <file>       write the QR as SVG instead of drawing it
  --raw              in qr/explain: use the URL as-is, for comparison
  --strip-tracking   drop utm_*, gclid, fbclid and friends first.
                     This CHANGES the URL. It is never done unless asked.
  --json             machine-readable output
  --help             this text`;

// --- arguments --------------------------------------------------------------

const flags = { base: DEFAULT_BASE, level: 'L' };
const words = [];

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) { words.push(arg); continue; }

  const name = arg.slice(2);
  if (['raw', 'json', 'help', 'strip-tracking'].includes(name)) {
    flags[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    continue;
  }
  const value = argv[++i];
  if (value === undefined) fail(`missing value for ${arg}`);
  flags[name] = value;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (flags.help || words.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const COMMANDS = ['pack', 'expand', 'qr', 'explain', 'bench'];
const command = COMMANDS.includes(words[0]) ? words.shift() : 'pack';
const input = words[0];

/** Apply --strip-tracking, reporting what it took. */
function prepare(url) {
  if (!flags.stripTracking) return url;
  const { url: cleaned, removed } = strip(url);
  if (removed.length && !flags.json) {
    console.error(`dropped ${removed.length} tracking parameter(s): ${removed.join(' ')}`);
  }
  return cleaned;
}

// A field the model predicted almost perfectly costs a hundredth of a bit,
// and rounding that to 0.0 hides the most interesting number in the output.
const bits = (n) => `${n < 1 ? n.toFixed(2) : n.toFixed(1)} bits`;

// --- commands ---------------------------------------------------------------

if (command === 'pack') {
  if (!input) fail('nothing to compress');
  const url = prepare(input);
  const result = shorten(url, { base: flags.base });

  if (flags.json) {
    console.log(JSON.stringify({
      url,
      link: result.link,
      payload: result.payload,
      bytes: result.bytes.length,
      mode: result.mode,
      original: url.length,
      compressed: result.link.length,
    }, null, 2));
  } else {
    console.log(result.link);
    const delta = url.length - result.link.length;
    console.error(
      `${url.length} chars -> ${result.link.length} ` +
      `(${result.bytes.length} bytes of payload, ${delta >= 0 ? '-' : '+'}${Math.abs(delta)} chars)`,
    );
  }
} else if (command === 'expand') {
  if (!input) fail('nothing to expand');
  console.log(expand(input, { base: flags.base }));
} else if (command === 'qr') {
  if (!input) fail('nothing to encode');
  const url = prepare(input);
  const text = flags.raw ? url : shorten(url, { base: flags.base }).link.toUpperCase();
  const symbol = qrEncode(text, { level: flags.level });

  if (flags.svg) {
    writeFileSync(flags.svg, toSvg(symbol));
    console.error(`wrote ${flags.svg}`);
  } else {
    console.log(toText(symbol));
  }

  const other = qrEncode(flags.raw ? shorten(url, { base: flags.base }).link.toUpperCase() : url,
    { level: flags.level });
  console.error(
    `${text}\n` +
    `version ${symbol.version}, ${symbol.size}x${symbol.size} modules, ${symbol.mode} mode, ` +
    `level ${flags.level}\n` +
    `the other way round: version ${other.version}, ${other.size}x${other.size}, ${other.mode} mode`,
  );
} else if (command === 'explain') {
  if (!input) fail('nothing to explain');
  const url = prepare(input);
  const result = shorten(url, { base: flags.base });
  const total = [...result.cost.values()].reduce((a, b) => a + b, 0);

  const rows = [...result.cost].map(([field, cost]) => [field, cost]);

  if (flags.json) {
    console.log(JSON.stringify({
      url,
      link: result.link,
      mode: result.mode,
      bitsByField: Object.fromEntries(rows),
      totalBits: total,
      bytes: result.bytes.length,
    }, null, 2));
  } else {
    console.log(url);
    console.log(`${url.length} characters, ${url.length * 8} bits as text\n`);
    for (const [field, cost] of rows) {
      const share = Math.round((cost / total) * 40);
      console.log(
        `  ${field.padEnd(9)} ${bits(cost).padStart(11)}  ${'#'.repeat(share)}`,
      );
    }
    console.log(`  ${'-'.repeat(9)} ${'-'.repeat(11)}`);
    console.log(`  ${'total'.padEnd(9)} ${bits(total).padStart(11)}  -> ${result.bytes.length} bytes\n`);
    console.log(`  link  ${result.link}`);
    console.log(`        ${result.link.length} characters, ${(100 - (result.link.length / url.length) * 100).toFixed(0)}% shorter`);
  }
} else if (command === 'bench') {
  const file = input ?? new URL('../tools/holdout.txt', import.meta.url).pathname;
  const urls = readFileSync(file, 'utf8')
    .split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));

  let chars = 0;
  let payload = 0;
  let links = 0;
  let shorter = 0;
  let originalModules = 0;
  let linkModules = 0;

  for (const url of urls) {
    const result = shorten(prepare(url), { base: flags.base });
    if (expand(result.link, { base: flags.base }) !== prepare(url)) fail(`round trip failed: ${url}`);

    chars += url.length;
    payload += result.bytes.length;
    links += result.link.length;
    if (result.link.length < url.length) shorter++;

    originalModules += qrEncode(url, { level: flags.level }).size ** 2;
    linkModules += qrEncode(result.link.toUpperCase(), { level: flags.level }).size ** 2;
  }

  const report = {
    urls: urls.length,
    originalChars: chars,
    payloadBytes: payload,
    linkChars: links,
    charRatio: links / chars,
    payloadRatio: payload / chars,
    qrModuleRatio: linkModules / originalModules,
    shorterThanOriginal: shorter,
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`${report.urls} URLs from ${file}`);
    console.log(`  characters   ${chars} -> ${links}  (${(report.charRatio * 100).toFixed(0)}% of the original)`);
    console.log(`  payload      ${payload} bytes  (${(report.payloadRatio * 100).toFixed(0)}% of the original text)`);
    console.log(`  QR modules   ${(report.qrModuleRatio * 100).toFixed(0)}% of the original, at level ${flags.level}`);
    console.log(`  shorter      ${shorter} of ${urls.length} links`);
  }
}
