#!/usr/bin/env node
/**
 * Probe P-U5-1 — analyse the marked-transition records against the PRE-REGISTERED predictions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ## The account being tested
 *
 * The probe set out to ask whether Spotify's **audio lags the state its API reports**, on the
 * hypothesis (classifier v2, CLAUDE.md) that *"in the DJ context the API stops reporting a track
 * 18–41 s before it stops playing."*
 *
 * ⚠️ **The first two transitions pointed at the reverse**, and this script exists to test that
 * reversal rather than assume it:
 *
 *   > The DJ **plays tracks short** — segueing ~18–41 s before a track's nominal end — and applies
 *   > a ~5 s crossfade of its own **regardless of the user's crossfade setting**. The API reports
 *   > this accurately. There is no reporting lag; there is an edit.
 *
 * If that holds, classifier v2's **fix stays correct** (those plays are completions, and milliseconds
 * of unobserved tail is the right axis) while its stated **mechanism is wrong**. And FR-46's hazard
 * shrinks from *"a skip truncates 18–41 s of a track the listener was enjoying"* to *"a skip cuts
 * ~5 s of an already-fading crossfade tail, and skips its target as intended."*
 *
 * ## ⚠️ PRE-REGISTERED PREDICTIONS — written before the repetitions were collected
 *
 *   | # | Prediction                                          | Falsified if                     |
 *   |---|-----------------------------------------------------|----------------------------------|
 *   | 1 | audioLag clusters ~5 s, roughly CONSTANT             | it scales with reportedTail      |
 *   | 2 | reportedTail is large, variable, INDEPENDENT of lag  | tail ~= audioLag every time      |
 *   | 3 | impliedTrim = tail - audioLag >> 0                   | it comes out ~= 0                |
 *   | 4 | uiLag ~= 0 — the UI flips with the API               | the UI trails the API            |
 *   | 5 | ⚠️ ALBUM: tail ~= 0, no crossfade, no trim           | albums behave like the DJ        |
 *
 * **Prediction 5 is the control and it dominates.** If album playback shows the same large tails,
 * the DJ is not the cause and the account is wrong however good the DJ numbers look. This is R11's
 * precedent: without the control, an ambiguous result is unusable.
 *
 * ⚠️ The predictions are recorded in this file's source, which was committed before the data was
 * read. They cannot be quietly adjusted afterwards — the BR-11 discipline, applied to a probe.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * usage:
 *   node scripts/probe-p-u5-1-analyse.mjs                      # newest marks file
 *   node scripts/probe-p-u5-1-analyse.mjs <path-to-marks.json>  # a specific one
 *   node scripts/probe-p-u5-1-analyse.mjs --exclude 3,7         # drop transitions by row number
 *
 * Reads only. Writes nothing, opens no database.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(projectRoot, 'aidlc-docs', 'construction', 'u5-automated-skipping', 'probes');

/** Predictions as data, so the report states what it was testing rather than what it found. */
const PREDICTIONS = {
  1: { claim: 'audioLag clusters ~5s, roughly constant', falsifiedIf: 'it scales with reportedTail' },
  2: {
    claim: 'reportedTail is large, variable, independent of audioLag',
    falsifiedIf: 'tail ≈ audioLag every time',
  },
  3: { claim: 'impliedTrim = tail − audioLag ≫ 0', falsifiedIf: 'it comes out ≈ 0' },
  4: { claim: 'uiLag ≈ 0 — the UI flips with the API', falsifiedIf: 'the UI trails the API' },
  5: {
    claim: '⚠️ CONTROL — album: tail ≈ 0, no crossfade, no trim',
    falsifiedIf: 'albums behave like the DJ, which would mean the DJ is not the cause',
  },
};

const AUTOMIX_TAIL_CEILING_MS = 10_000;

const argv = process.argv.slice(2);
const excludeArg = (() => {
  const i = argv.indexOf('--exclude');
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map(Number) : [];
})();
const explicitPath = argv.find((a) => a.endsWith('.json'));

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

async function newestMarksFile() {
  const entries = await readdir(OUT_DIR);
  const candidates = entries.filter((f) => f.startsWith('p-u5-1-marks-') && f.endsWith('.json')).sort();
  if (candidates.length === 0) {
    console.error(red(`no p-u5-1-marks-*.json in ${OUT_DIR}`));
    process.exit(1);
  }
  return join(OUT_DIR, candidates[candidates.length - 1]);
}

const path = explicitPath ?? (await newestMarksFile());
const record = JSON.parse(await readFile(path, 'utf8'));

const isDj = (uri) => typeof uri === 'string' && uri.includes('37i9dQZF1E');

/** Re-derive the rows from the raw flips and marks, rather than trusting the live correlation. */
const ms = (a, z) => new Date(z) - new Date(a);
const nearestMark = (flipAt, kind, windowMs = 90_000) =>
  (record.marks ?? [])
    .filter((m) => m.kind === kind)
    .map((m) => ({ m, delta: ms(flipAt, m.at) }))
    .filter((c) => Math.abs(c.delta) <= windowMs)
    .sort((x, y) => Math.abs(x.delta) - Math.abs(y.delta))[0] ?? null;

const TYPE_KEYS = {
  'type-crossfade': 'crossfade',
  'type-hardcut': 'hard-cut',
  'type-djtalk': 'dj-talk',
};

const rows = (record.apiFlips ?? []).map((flip, i) => {
  const tail = flip.fromRemainingMsAtLastSight;
  const audio = nearestMark(flip.at, 'audio');
  const ui = nearestMark(flip.at, 'ui');
  const anomaly = nearestMark(flip.at, 'anomaly', 30_000);
  const audioLag = audio?.delta ?? null;
  // ⚠️ The listener's DECLARED type wins over any inference from the numbers. Inferring the type
  // from the timings would be circular -- the timings are what the type is meant to explain.
  const typed = Object.keys(TYPE_KEYS)
    .map((k) => ({ k, c: nearestMark(flip.at, k, 30_000) }))
    .filter((x) => x.c != null)
    .sort((a, z) => Math.abs(a.c.delta) - Math.abs(z.c.delta))[0];
  return {
    n: i + 1,
    context: isDj(flip.to?.contextUri) ? 'DJ' : (flip.to?.contextType ?? 'other'),
    from: flip.from?.title ?? '?',
    to: flip.to?.title ?? '?',
    reportedTailMs: tail,
    declaredType: typed ? TYPE_KEYS[typed.k] : flip.throughNullGap ? 'gap (unlabelled)' : null,
    throughNullGap: flip.throughNullGap ?? false,
    nullGapMs: flip.nullGapMs ?? null,
    audioLagMs: audioLag,
    uiLagMs: ui?.delta ?? null,
    impliedTrimMs: tail != null && audioLag != null ? tail - audioLag : null,
    anomalyNearby: anomaly != null,
    informative: tail == null ? null : tail > AUTOMIX_TAIL_CEILING_MS,
    excluded: excludeArg.includes(i + 1),
  };
});

const s = (v) => (v == null ? '   —  ' : `${(v / 1000).toFixed(1)}s`.padStart(6));
const stats = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, z) => a - z);
  if (v.length === 0) return null;
  const mean = v.reduce((a, z) => a + z, 0) / v.length;
  return { n: v.length, min: v[0], max: v[v.length - 1], mean, median: v[Math.floor(v.length / 2)] };
};
const fmtStats = (st, label) =>
  st == null
    ? `  ${label.padEnd(16)} ${dim('no data')}`
    : `  ${label.padEnd(16)} n=${String(st.n).padEnd(3)} min ${s(st.min)}  median ${s(st.median)}  mean ${s(st.mean)}  max ${s(st.max)}`;

console.log(`\n${b('Probe P-U5-1 — analysis')}\n${dim(path)}\n`);

console.log(b('Pre-registered predictions (from this script\'s source, committed before the data)'));
for (const [k, p] of Object.entries(PREDICTIONS)) {
  console.log(`  ${b(k)}. ${p.claim}\n     ${dim('falsified if: ' + p.falsifiedIf)}`);
}

console.log(`\n${b('Transitions')}\n`);
console.log(
  `  ${'#'.padStart(2)} ${'ctx'.padEnd(9)} ${'from -> to'.slice(0, 34).padEnd(34)} ${'tail'.padStart(6)} ${'audio'.padStart(6)} ${'ui'.padStart(6)} ${'trim'.padStart(6)}`,
);
for (const r of rows) {
  const label = `${r.from} -> ${r.to}`.slice(0, 33).padEnd(34);
  const paint = r.excluded ? dim : r.informative === false ? dim : (x) => x;
  console.log(
    `  ${String(r.n).padStart(2)} ${paint(r.context.padEnd(9))} ${paint(label)} ${paint(s(r.reportedTailMs))} ${paint(s(r.audioLagMs))} ${paint(s(r.uiLagMs))} ${paint(s(r.impliedTrimMs))}` +
      (r.excluded ? red('  EXCLUDED') : r.anomalyNearby ? yellow('  ⚠ odd') : r.informative === false ? dim('  small tail') : ''),
  );
}

const usable = rows.filter((r) => !r.excluded);
const dj = usable.filter((r) => r.context === 'DJ');
const album = usable.filter((r) => r.context === 'album');
const other = usable.filter((r) => r.context !== 'DJ' && r.context !== 'album');

for (const [label, group] of [
  ['AI DJ', dj],
  ['ALBUM (control)', album],
  ['other contexts', other],
]) {
  if (group.length === 0) continue;
  console.log(`\n${b(label)}  ${dim(`${group.length} transition(s)`)}`);
  console.log(fmtStats(stats(group.map((r) => r.reportedTailMs)), 'reported tail'));
  console.log(fmtStats(stats(group.map((r) => r.audioLagMs)), 'audio lag'));
  console.log(fmtStats(stats(group.map((r) => r.uiLagMs)), 'ui lag'));
  console.log(fmtStats(stats(group.map((r) => r.impliedTrimMs)), 'implied trim'));
}

// ── verdicts, stated against the predictions ──────────────────────────────────────────────────
// -- by declared type -------------------------------------------------------------------------
// ⚠️ The DJ's transition behaviour is NOT consistent (measured 2026-09-27). A single median over
// several mechanisms describes none of them -- R11's "do not average a context-dependent answer",
// applied to transition types instead of playback contexts.
const byType = {};
for (const r of usable.filter((x) => x.context === 'DJ')) {
  (byType[r.declaredType ?? 'unlabelled'] ??= []).push(r);
}
const typeKeys = Object.keys(byType);
if (typeKeys.length > 0 && !(typeKeys.length === 1 && typeKeys[0] === 'unlabelled')) {
  console.log(`
${b('DJ transitions BY DECLARED TYPE')} ${dim('-- never pooled')}`);
  for (const [type, group] of Object.entries(byType)) {
    const t = stats(group.map((r) => r.reportedTailMs));
    const a = stats(group.map((r) => r.audioLagMs));
    const tr = stats(group.map((r) => r.impliedTrimMs));
    console.log(
      `  ${type.padEnd(18)} n=${String(group.length).padEnd(3)} tail ${t ? s(t.median) : '   -  '}  audio ${a ? s(a.median) : '   -  '}  trim ${tr ? s(tr.median) : '   -  '}  ${dim('(medians)')}`,
    );
  }
  if (byType.unlabelled?.length) {
    console.log(
      `  ${yellow('⚠')} ${byType.unlabelled.length} transition(s) carry NO type label -- shown, but not attributable to a mechanism.`,
    );
  }
}

console.log(`\n${b('Verdicts')}\n`);
console.log(dim('  ⚠ Verdicts 1-3 pool ALL DJ transitions. If the by-type table above shows'));
console.log(dim('    the types behaving differently, prefer THAT table -- prediction 1 assumed a'));
console.log(dim('    single mechanism, and a pooled median over several mechanisms describes none.'));
console.log('');

const djTail = stats(dj.map((r) => r.reportedTailMs));
const djAudio = stats(dj.map((r) => r.audioLagMs));
const djTrim = stats(dj.map((r) => r.impliedTrimMs));
const djUi = stats(dj.map((r) => r.uiLagMs));
const albTail = stats(album.map((r) => r.reportedTailMs));

const say = (n, verdict, detail) => {
  const tag =
    verdict === 'held' ? green('HELD') : verdict === 'failed' ? red('FAILED') : yellow('INSUFFICIENT');
  console.log(`  ${b(n)}. ${tag}  ${detail}`);
};

if (djAudio == null || djAudio.n < 3) say(1, 'insufficient', `need ≥3 DJ audio marks, have ${djAudio?.n ?? 0}`);
else {
  const spread = djAudio.max - djAudio.min;
  say(
    1,
    spread <= 6000 ? 'held' : 'failed',
    `audio lag ${(djAudio.min / 1000).toFixed(1)}–${(djAudio.max / 1000).toFixed(1)}s (spread ${(spread / 1000).toFixed(1)}s), median ${(djAudio.median / 1000).toFixed(1)}s`,
  );
}

if (djTail == null || djAudio == null || djTail.n < 3) say(2, 'insufficient', 'need ≥3 DJ transitions');
else
  say(
    2,
    djTail.max - djTail.min > 8000 ? 'held' : 'insufficient',
    `tail ${(djTail.min / 1000).toFixed(1)}–${(djTail.max / 1000).toFixed(1)}s vs audio lag median ${(djAudio.median / 1000).toFixed(1)}s`,
  );

if (djTrim == null || djTrim.n < 3) say(3, 'insufficient', `need ≥3 paired DJ transitions, have ${djTrim?.n ?? 0}`);
else
  say(
    3,
    djTrim.median > 8000 ? 'held' : djTrim.median < 3000 ? 'failed' : 'insufficient',
    `implied trim median ${(djTrim.median / 1000).toFixed(1)}s — audio the DJ appears never to have played`,
  );

if (djUi == null || djUi.n < 2) say(4, 'insufficient', `need ≥2 DJ ui marks, have ${djUi?.n ?? 0}`);
else
  say(
    4,
    Math.abs(djUi.median) <= 3000 ? 'held' : 'failed',
    `ui lag median ${(djUi.median / 1000).toFixed(1)}s`,
  );

if (albTail == null || albTail.n < 2)
  say(5, 'insufficient', `⚠️ NO ALBUM CONTROL (${albTail?.n ?? 0} transitions). The DJ numbers cannot be attributed to the DJ without it.`);
else
  say(
    5,
    albTail.median <= AUTOMIX_TAIL_CEILING_MS ? 'held' : 'failed',
    `album tail median ${(albTail.median / 1000).toFixed(1)}s vs DJ ${djTail ? (djTail.median / 1000).toFixed(1) : '?'}s`,
  );

console.log(`
${yellow('⚠ Read the verdicts together, not individually.')} ${dim('Prediction 5 is the control and it')}
${dim('dominates: if albums behave like the DJ, the DJ is not the cause whatever 1-4 say.')}
${dim('And an INSUFFICIENT is not a pass — it means the repetition was not collected.')}
`);
