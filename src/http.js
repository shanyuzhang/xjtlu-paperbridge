import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

// Some campus dual-stack routes fail Node's IPv4/IPv6 racing while ordinary HTTPS succeeds.
// Scope this option to exam requests; retain normal DNS and certificate verification.
export function examFetch(value, options = {}) {
  const url = new URL(value);
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, { method: options.method || 'GET', headers: { ...options.headers, 'Accept-Encoding': 'identity' },
      signal: options.signal, autoSelectFamily: false }, (res) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) headers.append(name, item);
      }
      const empty = [204, 205, 304].includes(res.statusCode);
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
