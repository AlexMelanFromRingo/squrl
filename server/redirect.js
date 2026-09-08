#!/usr/bin/env node
// The redirector as a long-running process.
//
//   node server/redirect.js          # listens on :8787
//   PORT=3000 node server/redirect.js
//
// node:http is the whole dependency list, because the whole job is turning a
// path into a Location header.

import { createServer } from 'node:http';
import { handle } from './handler.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

// Untrusted input arrives on every request; cap it before doing any work.
const MAX_URL = 4096;

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  if ((req.url ?? '').length > MAX_URL) {
    res.writeHead(414).end();
    return;
  }

  let result;
  try {
    result = handle(new URL(req.url, `http://${req.headers.host ?? 'localhost'}`));
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('error');
    return;
  }

  try {
    res.writeHead(result.status, result.headers);
    res.end(req.method === 'HEAD' ? undefined : result.body);
  } catch {
    // Writing a response can still fail: a socket that went away, or a header
    // value built from decoded data. One bad request must not take the server
    // down with it.
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`squrl redirector on http://${HOST}:${PORT}`);
  console.log('compress something with `squrl <url>` and open the result');
});

export { server };
