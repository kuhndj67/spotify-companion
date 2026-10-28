/**
 * U11 (LC-91, LC-92, LC-93; BR-96.2, BR-97, BR-98) — the WAL read-back, Diagnostics' Access and WAL rows, and the
 * exit test's comparison (PBT-98).
 *
 * ⚠️ Positive controls: a file database IS `wal` and prepares normally (P-101's failing input is the in-memory one,
 * measured to answer `memory` without throwing); a fingerprint compared with itself always passes (PBT-98).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import './fc-config.js';
import { SqliteHistoryRepository } from '../src/history/SqliteHistoryRepository.js';
import { WalRefused, prepareHistory } from '../src/history/prepareHistory.js';
import { compareCorpora, type CorpusFingerprint } from '../src/maintenance/corpusFingerprint.js';
import { accessRow, walRow, type AccessDiagnosticsInput } from '../src/access/accessDiagnostics.js';

describe('WAL is read back, not assumed (BR-97, P-101)', () => {
  it('⭐ a file database answers wal, and prepares (migrates) as before', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'u11-wal-'));
    try {
      const repo = new SqliteHistoryRepository(join(dir, 'history.db'), { migrate: false });
      assert.equal(repo.journalMode, 'wal');
      await prepareHistory(repo, '1.0.0-test', async () => ({ ok: true }) as never);
      assert.deepEqual(repo.pendingMigrations, []);
      repo.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an in-memory database answers memory (SQLite does not throw), and prepare refuses BEFORE any write', async () => {
    const repo = new SqliteHistoryRepository(':memory:', { migrate: false });
    assert.equal(repo.journalMode, 'memory');
    let backupAsked = false;
    await assert.rejects(
      prepareHistory(repo, '1.0.0-test', async () => {
        backupAsked = true;
        return { ok: true } as never;
      }),
      (e: unknown) => e instanceof WalRefused && /journal mode "memory"/.test((e as Error).message) && /:memory:/.test((e as Error).message),
    );
    assert.equal(backupAsked, false, 'no backup was attempted');
    assert.ok(repo.pendingMigrations.length > 0, 'nothing was migrated');
    repo.close();
  });

  it('the WAL row: ok on wal; fails naming the mode and path, or the refusal; skipped without a database', () => {
    assert.equal(walRow({ journalMode: 'wal', refusal: null, dbPath: '/data/history.db' }).status, 'ok');
    const bad = walRow({ journalMode: 'delete', refusal: null, dbPath: '/data/history.db' });
    assert.equal(bad.status, 'fail');
    assert.match(bad.detail, /"delete".*\/data\/history\.db/);
    assert.deepEqual(walRow({ journalMode: null, refusal: 'SQLite did not use WAL …', dbPath: 'x' }), { status: 'fail', detail: 'SQLite did not use WAL …' });
    assert.equal(walRow({ journalMode: null, refusal: null, dbPath: 'x' }).status, 'skip');
  });
});

describe('the Access row (BR-96.2)', () => {
  const NOW = Date.parse('2026-10-25T12:00:00Z');
  const server = (over: Partial<Extract<AccessDiagnosticsInput, { mode: 'server' }>> = {}): AccessDiagnosticsInput => ({
    mode: 'server',
    publicOrigin: 'https://machine2.local:3443',
    issuer: 'https://machine2.local:9443/webman/sso',
    allowedSubject: 'owner',
    sessionLifetimeMs: 7 * 86_400_000,
    providerPortal: null,
    certificate: { subject: 'CN=machine2.local', subjectAltName: 'DNS:machine2.local', validTo: 'Jan 26 12:00:00 2029 GMT' },
    coversPublicHost: true,
    provider: { discoveredAt: NOW - 60_000, lastFailure: null },
    ignoredSettings: [],
    ...over,
  });

  it('⭐ local mode: Local only, ok; a healthy server: ok, with its facts', () => {
    assert.deepEqual(accessRow({ mode: 'local' }, NOW), { status: 'ok', detail: 'Local only: this machine, no sign-in' });
    const ok = accessRow(server(), NOW);
    assert.equal(ok.status, 'ok');
    for (const fact of ['https://machine2.local:3443', 'webman/sso', '"owner"', '7 day(s)', '2029-01-26']) assert.ok(ok.detail.includes(fact), fact);
  });

  it('fails: the provider never discovered (with its failure), an expired certificate, or not serving', () => {
    assert.equal(accessRow(server({ provider: { discoveredAt: null, lastFailure: { reason: 'provider-unreachable', detail: 'TypeError', at: NOW } } }), NOW).status, 'fail');
    assert.equal(accessRow(server({ certificate: { subject: 'x', subjectAltName: 'y', validTo: 'Jan 1 00:00:00 2026 GMT' } }), NOW).status, 'fail');
    const ns = accessRow({ mode: 'not-serving', problems: [{ setting: 'OIDC_CLIENT_ID', message: 'is required' }] }, NOW);
    assert.equal(ns.status, 'fail');
    assert.match(ns.detail, /OIDC_CLIENT_ID is required/);
  });

  it('warns: inside 30 days of expiry, or a certificate that does not cover the public host; ignored settings are named', () => {
    const soon = new Date(NOW + 10 * 86_400_000).toUTCString();
    assert.equal(accessRow(server({ certificate: { subject: 'x', subjectAltName: 'y', validTo: soon } }), NOW).status, 'warn');
    assert.equal(accessRow(server({ coversPublicHost: false }), NOW).status, 'warn');
    assert.match(accessRow(server({ ignoredSettings: ['LOCAL_ONLY'] }), NOW).detail, /ignored in server mode: LOCAL_ONLY/);
  });
});

const fingerprint: fc.Arbitrary<CorpusFingerprint> = fc.record({
  counts: fc.dictionary(fc.constantFrom('play', 'observation', 'label_resolution', 'decision_log', 'skip_attempt', 'app_meta'), fc.nat({ max: 100_000 })),
  rulesSha256: fc.oneof(fc.constant(null), fc.stringMatching(/^[0-9a-f]{64}$/)),
});

describe('compareCorpora (PBT-98)', () => {
  it('⭐ a fingerprint compared with itself always passes', () => {
    fc.assert(fc.property(fingerprint, (f) => assert.deepEqual(compareCorpora(f, f), { pass: true })));
  });

  it('pass iff the same tables, equal counts and equal hashes; otherwise every difference is listed', () => {
    fc.assert(
      fc.property(fingerprint, fingerprint, (a, b) => {
        const r = compareCorpora(a, b);
        const tables = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
        const differing = [...tables].filter((t) => a.counts[t] !== b.counts[t] || !Object.hasOwn(a.counts, t) || !Object.hasOwn(b.counts, t));
        const hashDiffers = a.rulesSha256 !== b.rulesSha256;
        if (differing.length === 0 && !hashDiffers) {
          assert.deepEqual(r, { pass: true });
        } else {
          assert.equal(r.pass, false);
          if (!r.pass) {
            assert.equal(r.differences.length, differing.length + (hashDiffers ? 1 : 0));
            for (const t of differing) assert.ok(r.differences.some((d) => d.startsWith(`table ${t}:`)), t);
          }
        }
      }),
    );
  });

  it('one extra row, one missing table, a changed rules file: each is named', () => {
    const a: CorpusFingerprint = { counts: { play: 10, observation: 50 }, rulesSha256: 'a'.repeat(64) };
    const r = compareCorpora(a, { counts: { play: 11 }, rulesSha256: 'b'.repeat(64) });
    assert.deepEqual(r, {
      pass: false,
      differences: ['table observation: only on the first side (50 rows)', 'table play: 10 rows vs 11', `rules file: ${'a'.repeat(64)} vs ${'b'.repeat(64)}`],
    });
  });
});
