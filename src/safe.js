// What a decoded payload is allowed to do to whoever opened the link.
//
// Anyone can put arbitrary base36 in a path and see what falls out, so the
// output of the decoder is untrusted input no matter how it got there. Both
// the Node redirector and the static page in 404.html enforce this, from this
// one definition, because a rule written twice is a rule enforced once.

/**
 * A URL that may be followed automatically.
 *
 * Two separate hazards, both real:
 *
 *   * scheme -- a redirect to `javascript:` or `data:` from a host someone
 *     trusts is a favour an open redirector must refuse;
 *   * bytes -- fuzzing the redirector turned up a random payload that decoded
 *     to a URL containing a newline, which in a Location header is header
 *     injection. Control characters and whitespace are refused rather than
 *     escaped, because a URL never legitimately contains them.
 */
export const FOLLOWABLE = new RegExp('^https?://[^\\s\\u0000-\\u001f\\u007f]+$', 'i');

export const followable = (url) => FOLLOWABLE.test(url);

/**
 * The same URL, safe to put in an HTTP header.
 *
 * Headers are Latin-1, and a URL may legitimately contain raw non-ASCII --
 * `/файл.pdf` is a real path and squrl preserves it exactly -- so those
 * characters travel percent-encoded, which is what a browser sends for the
 * same address.
 */
const encoder = new TextEncoder();

export function asciiUrl(url) {
  return url.replace(/[^ -~]/gu, (ch) => [...encoder.encode(ch)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join(''));
}
