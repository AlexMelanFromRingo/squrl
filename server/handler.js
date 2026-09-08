// The redirector: the twenty lines that make a compressed URL openable by a
// phone camera with nothing installed.
//
// It is not a shortener. There is no table, no database, no state of any kind:
// the payload in the path *is* the URL, and this service decompresses it and
// says "301, it's over there". Two consequences worth stating plainly, because
// they are the reasons to prefer this over a shortener:
//
//   * Nothing can expire, because nothing was stored. A link works as long as
//     the format does, on any deployment of it, forever.
//   * Nobody has to be trusted with the mapping, because there is no mapping.
//     Run your own copy and the same links keep working.
//
// What it cannot escape: whoever runs the redirector sees the traffic. That is
// inherent to being the host a camera dials, and the fix is to be your own
// host -- which is why the whole thing fits in one file with no dependencies.

import { expand } from '../src/codec.js';

// A payload longer than this is not a URL anyone shortened; it is someone
// probing. Base36 of a 4 kB URL would still be well under this.
const MAX_PAYLOAD = 2048;

const CACHE = 'public, max-age=31536000, immutable';

const SECURITY = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
};

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * What may go in a Location header.
 *
 * Two hazards, both real. A redirect to `javascript:` or `data:` from a domain
 * someone trusts is a favour an open redirector should refuse -- hence http
 * and https only. And a decoded string may contain anything at all: fuzzing
 * this service turned up a random payload that decoded to a URL with a newline
 * in it, which as a Location header is header injection. Whitespace and
 * control characters are rejected outright rather than escaped.
 */
const FOLLOWABLE = new RegExp('^https?://[^\\s\\u0000-\\u001f\\u007f]+$', 'i');

/**
 * Make a decoded URL safe to put in a header.
 *
 * A URL may legitimately contain raw non-ASCII -- `/файл.pdf` is a real path,
 * and the compressor preserves it exactly. HTTP headers are Latin-1, so those
 * characters travel as percent-encoded UTF-8, which is what a browser sends
 * for the same address. Control characters never reach here: FOLLOWABLE has
 * already refused them.
 */
const encoder = new TextEncoder();

function asciiLocation(url) {
  return url.replace(/[^\u0020-\u007e]/gu, (ch) => [...encoder.encode(ch)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join(''));
}

function page(title, body, status = 200) {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${escape(title)}</title><style>
        :root { color-scheme: light dark; }
        body { font: 16px/1.6 system-ui, sans-serif; margin: 0 auto; padding: 2rem 1.25rem;
               max-width: 34rem; }
        h1 { font-size: 1.25rem; margin: 0 0 1rem; }
        a { color: inherit; word-break: break-all; }
        code, .url { font-family: ui-monospace, monospace; font-size: 0.95em; word-break: break-all; }
        .url { display: block; padding: 0.75rem; margin: 1rem 0; border: 1px solid;
               border-radius: 6px; }
        p { margin: 0.75rem 0; }
        .muted { opacity: 0.7; font-size: 0.9em; }
      </style></head><body>${body}</body></html>`,
  };
}

const LANDING = `
  <h1>squrl</h1>
  <p>A compressed URL, not a shortened one. The link carries the whole address
     inside it &mdash; this server keeps no table, stores nothing, and forgets
     every request.</p>
  <p class="muted">Add a payload to the path and you will be redirected:
     <code>/1NSY088LB61Q6BJ8S7D</code>. Add <code>?preview</code> to see where
     it goes without going there.</p>`;

/**
 * Handle one request.
 *
 * @param {URL} url
 * @returns {{status: number, headers: object, body?: string}}
 */
export function handle(url) {
  const path = url.pathname;

  if (path === '/' || path === '') return page('squrl', LANDING);

  if (path === '/health') {
    return { status: 200, headers: { 'content-type': 'text/plain', ...SECURITY }, body: 'ok' };
  }

  const payload = decodeURIComponent(path.slice(1)).replace(/\/+$/, '');

  if (payload.length > MAX_PAYLOAD) {
    return page('Too long', '<h1>Too long</h1><p>That is not a squrl link.</p>', 414);
  }
  if (!/^[0-9a-zA-Z]+$/.test(payload)) {
    return page('Not a link', '<h1>Not a squrl link</h1>' +
      '<p>Payloads are digits and letters only.</p>', 404);
  }

  let target;
  try {
    target = expand(payload);
  } catch (err) {
    // A payload that does not decode is far more likely to be a typo than an
    // attack, so say which it was rather than a bare 400.
    return page('Cannot decode', '<h1>Cannot decode that link</h1>' +
      `<p class="muted">${escape(err.message)}</p>`, 400);
  }

  const followable = FOLLOWABLE.test(target);
  const preview = url.searchParams.has('preview') || !followable;

  if (preview) {
    return page(
      followable ? 'Preview' : 'Not a web address',
      `<h1>${followable ? 'This link goes to' : 'This link is not a web address'}</h1>` +
      `<span class="url">${escape(target)}</span>` +
      (followable
        ? `<p><a href="${escape(target)}" rel="noreferrer">Go there</a></p>`
        : '<p class="muted">Only http and https links are opened automatically.</p>'),
    );
  }

  // 301, because the mapping is a mathematical fact rather than a routing
  // decision: this payload has always meant this URL and always will.
  return {
    status: 301,
    headers: { location: asciiLocation(target), 'cache-control': CACHE, ...SECURITY },
    body: '',
  };
}

export { MAX_PAYLOAD };
