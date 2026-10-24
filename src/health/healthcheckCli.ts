/**
 * The image's HEALTHCHECK (U11). The decision is `healthTarget`, which is tested; this makes one request and exits
 * 0 for a `200`, 1 for anything else (including no listener at all).
 */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { healthTarget } from './healthTarget.js';

const target = healthTarget(process.env);
if (target === null) process.exit(1);

const done = (ok: boolean) => process.exit(ok ? 0 : 1);
const req =
  target.protocol === 'http'
    ? httpRequest({ host: '127.0.0.1', port: target.port, path: target.path, timeout: 4000 }, (res) => done(res.statusCode === 200))
    : httpsRequest(
        {
          host: '127.0.0.1',
          port: target.port,
          path: target.path,
          headers: { host: target.host },
          servername: target.servername,
          // Liveness over loopback only; the certificate is for the public name and is Diagnostics' to check.
          rejectUnauthorized: false,
          timeout: 4000,
        },
        (res) => done(res.statusCode === 200),
      );
req.on('timeout', () => req.destroy());
req.on('error', () => done(false));
req.end();
