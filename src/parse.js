// Taking a URL apart without changing it.
//
// The one rule this file exists to enforce: `join(split(url)) === url`, for
// every input, byte for byte. A compressor that normalises while it parses --
// drops a default port, adds a trailing slash, lowercases a path -- produces a
// link that opens a different page, which is the one bug this project cannot
// afford. So nothing here is cleaned up; the pieces are raw substrings, and
// whatever the model cannot describe cheaply is still stored verbatim.

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//;

/**
 * Split a URL into the parts the model reasons about.
 *
 * @returns {object|null} null when the string is not a plain scheme://…  URL,
 *                        which sends the whole thing to the raw coder.
 */
export function split(url) {
  const m = SCHEME.exec(url);
  if (!m) return null;

  const scheme = m[1];
  let rest = url.slice(m[0].length);

  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  rest = end === -1 ? '' : rest.slice(end);

  let path = '';
  let query = null;
  let fragment = null;

  const hash = rest.indexOf('#');
  if (hash !== -1) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  const mark = rest.indexOf('?');
  if (mark !== -1) {
    query = rest.slice(mark + 1);
    rest = rest.slice(0, mark);
  }
  path = rest;

  // The authority splits into [userinfo@]host[:port]. Userinfo is rare enough
  // that it is kept whole; the host is where the modelling happens.
  let userinfo = null;
  let hostport = authority;
  const at = authority.lastIndexOf('@');
  if (at !== -1) {
    userinfo = authority.slice(0, at);
    hostport = authority.slice(at + 1);
  }

  let host = hostport;
  let port = null;
  // A colon inside brackets belongs to an IPv6 literal, not to a port.
  const colon = hostport.lastIndexOf(':');
  if (colon !== -1 && hostport.indexOf(']', colon) === -1) {
    host = hostport.slice(0, colon);
    port = hostport.slice(colon + 1);
  }

  return { scheme, userinfo, host, port, path, query, fragment };
}

/** Put the pieces back together. The inverse of split(), exactly. */
export function join(p) {
  const authority =
    (p.userinfo === null ? '' : `${p.userinfo}@`) +
    p.host +
    (p.port === null ? '' : `:${p.port}`);

  return (
    `${p.scheme}://${authority}${p.path}` +
    (p.query === null ? '' : `?${p.query}`) +
    (p.fragment === null ? '' : `#${p.fragment}`)
  );
}

// --- what a piece of text looks like ---------------------------------------
//
// The model picks a representation per path segment and per query value. These
// predicates decide what is worth trying; the choice itself is written into
// the stream, so the decoder never has to guess.

/** A number that survives the round trip: no leading zeros, no overflow. */
export function isNumber(s) {
  if (!/^[0-9]+$/.test(s)) return false;
  if (s.length > 1 && s[0] === '0') return false;
  return Number(s) <= Number.MAX_SAFE_INTEGER;
}

/** Lowercase hex of even length: hashes, commit ids, uuid pieces. */
export function isHex(s) {
  return s.length >= 6 && s.length % 2 === 0 && /^[0-9a-f]+$/.test(s);
}

export function hexBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

export function hexString(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
