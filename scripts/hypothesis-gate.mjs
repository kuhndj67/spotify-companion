#!/usr/bin/env node
/**
 * The Phase 2 hypothesis gate (BR-11).
 *
 * Runs the comparison fixed in
 * `aidlc-docs/construction/u2-label-enrichment/hypothesis-gate/pre-registration.md`.
 * Read-only: it opens the database with `readOnly` and writes nothing, ever. The
 * gate is an observer of the instrument, not part of it.
 *
 * ⚠️ The eligibility rules, the minimum sample and the stopping rule are NOT
 * parameters of this script. They are pre-registered constants (BR-11.6a,
 * BR-11.7) and changing them here rather than by amending the pre-registration
 * would defeat the point of having one.
 *
 *   node scripts/hypothesis-gate.mjs [path/to/history.db]
 */

import { DatabaseSync } from 'node:sqlite';

/** BR-11.6a — pre-registered 2026-09-05, before any result was seen. */
const MIN_PER_GROUP = 50;
const MIN_SKIPS = 10;

const dbPath = process.argv[2] ?? 'data/history.db';
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

/**
 * Eligibility, per pre-registration §2. Written as one shared predicate rather
 * than repeated per query, so no cut can quietly use a different one.
 *
 * `skip_source = 'rule'` is excluded by BR-11.4: the instrument must not measure
 * itself. There are no rule-initiated skips yet (U5 is unbuilt), but the clause
 * is here now so it is not forgotten once there are.
 */
const ELIGIBLE = `
  outcome IN ('completed','skipped')
  AND (skip_source IS NULL OR skip_source <> 'rule')
`;

const rate = (group) => {
  const r = one(
    `SELECT COUNT(*) n,
            SUM(CASE WHEN outcome='skipped' THEN 1 ELSE 0 END) skipped
       FROM play
      WHERE ${ELIGIBLE} AND ${group.where}`,
  );
  const n = r.n ?? 0;
  const skipped = r.skipped ?? 0;
  return { label: group.label, n, skipped, completed: n - skipped, rate: n ? skipped / n : null };
};

const pct = (v) => (v === null ? '   n/a' : (v * 100).toFixed(1).padStart(5) + '%');
const row = (g) =>
  `  ${g.label.padEnd(28)} n=${String(g.n).padStart(3)}   skipped=${String(g.skipped).padStart(3)}` +
  `   completed=${String(g.completed).padStart(3)}   skip rate ${pct(g.rate)}`;

// ── The primary comparison: latest release-level verdict (BR-11.1a) ──────────
const primary = [
  { label: 'major (release, latest)', where: "label_verdict='major'" },
  { label: 'independent (release)', where: "label_verdict='independent'" },
].map(rate);

// BR-11.2 — reported alongside, never omitted, and not contingent on the result.
const unknownGroup = rate({ label: 'unknown (release)', where: "label_verdict='unknown'" });

const [major, independent] = primary;
const eligibleSkips = major.skipped + independent.skipped;
const meetsN = major.n >= MIN_PER_GROUP && independent.n >= MIN_PER_GROUP;
const meetsSkips = eligibleSkips >= MIN_SKIPS;
const sufficient = meetsN && meetsSkips;

console.log('THE PHASE 2 HYPOTHESIS GATE (BR-11)');
console.log(`database: ${dbPath}`);
console.log(`pre-registration: BR-11.6a  n>=${MIN_PER_GROUP}/group AND >=${MIN_SKIPS} skips\n`);

console.log('PRIMARY COMPARISON — latest release-level verdict (BR-11.1, BR-11.1a)');
primary.forEach((g) => console.log(row(g)));
console.log('\nREPORTED ALONGSIDE (BR-11.2)');
console.log(row(unknownGroup));

// ── The verdict ─────────────────────────────────────────────────────────────
console.log('\nMINIMUM SAMPLE CHECK (BR-11.6a)');
console.log(`  n >= ${MIN_PER_GROUP} in each group   major=${major.n}  independent=${independent.n}   ${meetsN ? 'MET' : 'NOT MET'}`);
console.log(`  >= ${MIN_SKIPS} skips in the eligible set   skips=${eligibleSkips}   ${meetsSkips ? 'MET' : 'NOT MET'}`);
console.log(`\n  ==> ${sufficient ? 'SAMPLE SUFFICIENT — verdict may be issued' : 'INSUFFICIENT DATA (BR-11.6) — no verdict, no trend, no direction'}`);

if (!sufficient) {
  const needMajor = Math.max(0, MIN_PER_GROUP - major.n);
  const needIndie = Math.max(0, MIN_PER_GROUP - independent.n);
  console.log(`      short by: major ${needMajor}, independent ${needIndie}, skips ${Math.max(0, MIN_SKIPS - eligibleSkips)}`);
  console.log('      BR-11.7: this run is NOT the single confirmatory evaluation.');
}

// ── The pre-registered statistic (BR-11.1, pre-registration §2) ─────────────
//
// Two-sided two-proportion test at alpha = 0.05, with a confidence interval on the
// difference. Added 2026-09-10, when the minimum was first met: earlier revisions of this
// script stopped at the sufficiency check because the outcome was fixed at "insufficient
// data" and the statistic could not be needed.
//
// ⚠️ This adds a computation the pre-registration already specified. It does NOT touch
// MIN_PER_GROUP, MIN_SKIPS, the eligibility predicate or the grouping — the quantities a
// pre-registration exists to freeze. The formula below has no free parameters, so there is
// no degree of freedom here to have been chosen after seeing the data. Recorded plainly in
// the result document and in audit.md so the ordering is on the record.

/** Normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). No dependency, no clock. */
const normalCdf = (z) => {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
};

if (sufficient) {
  const p1 = major.skipped / major.n;
  const p2 = independent.skipped / independent.n;
  const diff = p1 - p2;

  // Pooled SE for the null test; unpooled SE for the interval. Standard practice.
  const pooled = (major.skipped + independent.skipped) / (major.n + independent.n);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / major.n + 1 / independent.n));
  const z = sePooled > 0 ? diff / sePooled : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  const seUnpooled = Math.sqrt(
    (p1 * (1 - p1)) / major.n + (p2 * (1 - p2)) / independent.n,
  );
  const lo = diff - 1.96 * seUnpooled;
  const hi = diff + 1.96 * seUnpooled;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;

  console.log('\nPRIMARY TEST (pre-registration §2 — two-sided, alpha = 0.05)');
  console.log(`  major ${pct(p1)} (${major.skipped}/${major.n})  vs  independent ${pct(p2)} (${independent.skipped}/${independent.n})`);
  console.log(`  difference (major - independent): ${diff >= 0 ? '+' : ''}${pct(diff)}`);
  console.log(`  95% CI on the difference: [${pct(lo)}, ${pct(hi)}]`);
  console.log(`  z = ${z.toFixed(3)}   p = ${pValue.toFixed(3)}`);

  const significant = pValue < 0.05;
  console.log(`\n  ==> ${significant ? 'SIGNIFICANT at alpha = 0.05' : 'NOT SIGNIFICANT at alpha = 0.05'}`);
  console.log(
    significant
      ? `      Direction: ${diff > 0 ? 'major skipped MORE — the direction R1 predicts' : 'major skipped LESS — OPPOSITE to R1; recorded as a finding, not discarded'}`
      : '      R1 is NOT SUPPORTED at the effect size this instrument can resolve.\n' +
        '      This is not proof R1 is false. The CI above is what has been ruled out;\n' +
        '      any effect smaller than that remains possible and undetected.',
  );
}

// ── Coverage (BR-11.3) ──────────────────────────────────────────────────────
console.log('\nCOVERAGE (BR-11.3)');
const totals = one('SELECT COUNT(*) n FROM play');
const byProv = all('SELECT provenance, COUNT(*) c FROM play GROUP BY 1 ORDER BY 1');
console.log(`  plays in corpus: ${totals.n}   (${byProv.map((r) => `${r.provenance} ${r.c}`).join(', ')})`);
const ineligible = all(`
  SELECT CASE
           WHEN outcome='unknown' AND isrc IS NULL THEN 'no trail AND no ISRC (backfilled)'
           WHEN outcome='unknown' THEN 'no measurable outcome'
           WHEN label_verdict IS NULL THEN 'no release verdict'
           WHEN label_verdict='unknown' THEN 'verdict unknown (reported alongside)'
           ELSE 'eligible'
         END reason, COUNT(*) c
    FROM play GROUP BY 1 ORDER BY c DESC`);
ineligible.forEach((r) => console.log(`    ${String(r.c).padStart(4)}  ${r.reason}`));

/*
 * ⚠️ Two DIFFERENT causes make a verdict missing, and averaging them together
 * produces a plausible-looking number that measures neither:
 *
 *   1. no ISRC  -- `recently-played` returns no `external_ids`, so every
 *      backfilled play lacks one (open item 3). This is a SPOTIFY artefact and
 *      says nothing whatever about MusicBrainz's catalogue.
 *   2. ISRC present, MusicBrainz has no label -- this is the real R2 coverage
 *      measure, and the one open item 3b's recency bias is about.
 *
 * Because the backfill is heavily weighted to recent releases, folding cause 1
 * into the denominator makes MusicBrainz look far worse on recent music than it
 * is -- the same shape as the `inc=releases` bug: a wrong denominator is
 * indistinguishable from absent data. So the two are reported separately, and
 * the R2 measure is taken ONLY over plays that actually carried an ISRC.
 */
console.log('\n  (a) ISRC availability by year — a Spotify/backfill artefact, NOT a MusicBrainz measure');
console.log('  (b) label coverage among plays that HAVE an ISRC — the real R2 measure (open item 3b)');
const years = all(`
  SELECT substr(release_date,1,4) yr,
         COUNT(*) plays,
         SUM(CASE WHEN isrc IS NOT NULL THEN 1 ELSE 0 END) with_isrc,
         SUM(CASE WHEN isrc IS NOT NULL AND label_verdict IN ('major','independent') THEN 1 ELSE 0 END) named
    FROM play WHERE release_date IS NOT NULL GROUP BY 1 ORDER BY 1`);
const era = { pre: { isrc: 0, named: 0, plays: 0 }, post: { isrc: 0, named: 0, plays: 0 } };
for (const y of years) {
  const e = Number(y.yr) < 2022 ? era.pre : era.post;
  e.isrc += y.with_isrc; e.named += y.named; e.plays += y.plays;
  const cov = y.with_isrc ? `${y.named}/${y.with_isrc}` : '   —';
  console.log(`    ${y.yr}  plays=${String(y.plays).padStart(3)}  with ISRC=${String(y.with_isrc).padStart(3)}  named verdict=${cov.padStart(6)}`);
}
const share = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : 'n/a');
console.log(`    pre-2022  ISRC ${era.pre.isrc}/${era.pre.plays} (${share(era.pre.isrc, era.pre.plays)})   label coverage ${era.pre.named}/${era.pre.isrc} (${share(era.pre.named, era.pre.isrc)})`);
console.log(`    2022+     ISRC ${era.post.isrc}/${era.post.plays} (${share(era.post.isrc, era.post.plays)})   label coverage ${era.post.named}/${era.post.isrc} (${share(era.post.named, era.post.isrc)})`);

db.close();
