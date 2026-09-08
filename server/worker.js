// The redirector on an edge runtime.
//
//   wrangler deploy server/worker.js
//
// Decompression is arithmetic over a 27 kB table with no I/O at all, which is
// the shape these platforms are best at: a cold start is a few milliseconds
// and the answer is cacheable forever.

import { handle } from './handler.js';

export default {
  fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    let result;
    try {
      result = handle(new URL(request.url));
    } catch {
      return new Response('error', { status: 500 });
    }

    return new Response(result.body || null, {
      status: result.status,
      headers: result.headers,
    });
  },
};
