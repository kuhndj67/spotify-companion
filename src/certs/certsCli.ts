/**
 * Entry point for the certificate tool (U11, IN-U11-4; Q2 = A): the image's `certs` command, and `npm run certs`
 * for a source install. The behaviour is `certTool.ts`, which is tested; this parses arguments and prints.
 *
 *   certs ca     --out <folder> --dns <name> [--dns …] [--ip <address> …]
 *   certs issue  --ca <folder> --out <folder> --name <word> --dns <name> [--ip …] [--days ≤825]
 *   certs verify --ca-cert <ca-cert.pem> --cert <cert.pem> --dns <name> [--ip …]
 *
 * In the image, paths are inside the mounted folder (`/work/…`).
 */

import { parseArgs } from 'node:util';
import { issue, makeCa, verify, type ToolOutcome } from './certTool.js';

const USAGE = `usage:
  certs ca     --out <folder> --dns <name> [--dns <name> ...] [--ip <IPv4> ...]
  certs issue  --ca <folder holding ca-cert.pem and ca-key.pem> --out <folder> --name <word> --dns <name> [--ip <IPv4>] [--days <=825]
  certs verify --ca-cert <ca-cert.pem> --cert <cert.pem> --dns <name> [--ip <IPv4>]`;

function main(argv: string[]): number {
  const [action, ...rest] = argv;
  let values: Record<string, string | string[] | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        out: { type: 'string' },
        ca: { type: 'string' },
        'ca-cert': { type: 'string' },
        cert: { type: 'string' },
        name: { type: 'string' },
        days: { type: 'string' },
        dns: { type: 'string', multiple: true },
        ip: { type: 'string', multiple: true },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`✗ certs: ${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const names = { dns: (values.dns as string[] | undefined) ?? [], ip: (values.ip as string[] | undefined) ?? [] };
  const need = (...keys: string[]) => keys.filter((k) => values[k] === undefined);

  let outcome: ToolOutcome;
  if (action === 'ca') {
    const missing = need('out');
    if (missing.length > 0) return usage(missing);
    outcome = makeCa(values.out as string, names);
  } else if (action === 'issue') {
    const missing = need('ca', 'out', 'name');
    if (missing.length > 0) return usage(missing);
    const days = values.days === undefined ? undefined : Number(values.days);
    outcome = issue(values.ca as string, values.out as string, values.name as string, names, days);
  } else if (action === 'verify') {
    const missing = need('ca-cert', 'cert');
    if (missing.length > 0) return usage(missing);
    outcome = verify(values['ca-cert'] as string, values.cert as string, names);
  } else {
    console.error(`✗ certs: unknown action ${JSON.stringify(action ?? '')}\n${USAGE}`);
    return 2;
  }

  if (!outcome.ok) {
    for (const p of outcome.problems) console.error(`✗ ${p}`);
    console.error('Nothing was reported as done.');
    return 1;
  }
  for (const line of outcome.lines) console.log(line);
  return 0;
}

function usage(missing: string[]): number {
  console.error(`✗ certs: missing ${missing.map((m) => `--${m}`).join(', ')}\n${USAGE}`);
  return 2;
}

process.exit(main(process.argv.slice(2)));
