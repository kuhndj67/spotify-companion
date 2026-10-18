#!/usr/bin/env node
/**
 * Probe P-U5-1, **driven step by step** — the non-interactive sibling of `probe-p-u5-1.mjs`.
 *
 * Same probe, same protocol, same preflights. The difference is who asks the question:
 * `probe-p-u5-1.mjs` prompts the listener itself, which needs a human at the keyboard. This one
 * prints JSON and exits, so an operator (or an agent) can drive one step at a time while the
 * listener only has to drive Spotify and say what they heard.
 *
 * ⚠️ **Read `probe-p-u5-1.mjs`'s header for what this probe is and why.** It is not repeated here.
 * The short version: in the AI DJ context Spotify stops *reporting* a track 18–41 s before it stops
 * *playing*, and nobody knows whether `POST /me/player/next` acts on the player's real state or on
 * that same lagged state. If it acts on the real state, a rule matching the newly-reported track
 * truncates the one still audible.
 *
 * ## ⚠️ The measurement this script adds, which the interactive one only implies
 *
 * `aRemainingMsAtLastSight` = A's `duration_ms − progress_ms` the last time the API reported A.
 *
 * **That is the reporting lag, measured directly, without the listener's ear.** And it decides
 * whether a trial is admissible at all:
 *
 *   | `aRemainingMsAtLastSight` | What the trial can tell you                                    |
 *   |---------------------------|----------------------------------------------------------------|
 *   | ~18 000–41 000 ms         | ✅ The lag is present. **This trial tests the hazard.**         |
 *   | < ~5 000 ms               | ⚠️ **No lag on this trial — it CANNOT test the hazard.** A was  |
 *   |                           | reported nearly to its end, so reported and audible agree and   |
 *   |                           | there is no discrepancy for the POST to land on the wrong side  |
 *   |                           | of. Expected for the album control; a wasted trial in the DJ    |
 *
 * ⚠️ **Counting a no-lag DJ trial as evidence would be the confound this whole probe exists to
 * avoid.** A trial where reported and audible agree will always look like "the skip landed
 * correctly", whichever state the POST acts on.
 *
 * ## usage
 *
 *   node scripts/probe-p-u5-1-step.mjs status
 *       One read. Prints what is playing, the context, and how long until the next boundary.
 *       Read-only; safe with the container up.
 *
 *   node scripts/probe-p-u5-1-step.mjs trial --label "AI DJ" [--max-wait 420] [--no-post]
 *       Polls until the reported track id changes, then POSTs immediately, then re-reads at
 *       +1.5s and +6s. Appends the trial to the record file. ⚠️ Refuses if the container is up,
 *       unless --no-post.
 *
 * Record: aidlc-docs/construction/u5-automated-skipping/probes/p-u5-1-driven.json
 * ⚠️ The listener's account of what they HEARD is added to that file afterwards — it is the
 * measurement, and no endpoint can supply it.
 *
 * Never opens `history.db`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG =
  process.env.SPOTIFY_CONFIG_PATH ?? join(projectRoot, 'secrets', 'app', 'spotify-config.json');
const OUT_DIR = join(projectRoot, 'aidlc-docs', 'construction', 'u5-automated-skipping', 'probes');
const RECORD = join(OUT_DIR, 'p-u5-1-driven.json');

const MODE = process.argv[2];
const NO_POST = process.argv.includes('--no-post');
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const LABEL = argOf('--label', 'unlabelled');
const MAX_WAIT_MS = Number(argOf('--max-wait', '420')) * 1000;

const POLL_MS = 1000;
const AFTER_READS_MS = [1500, 6000];
/** The lag band classifier v2 measured. Used only to CLASSIFY a trial, never to filter silently. */
const LAG_BAND_MS = { low: 18_000, high: 41_000 };
/** Below this, reported and audible agree closely enough that the trial cannot test the hazard. */
const NO_LAG_CEILING_MS = 5_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const out = (obj) => console.log(JSON.stringify(obj, null, 2));

function fail(message, extra = {}) {
  out({ ok: false, error: message, ...extra });
  process.exit(1);
}

// ── preflight: the container ──────────────────────────────────────────────────────────────────
function containerRunning() {
  try {
    const stdout = execFileSync(
      'docker',
      ['ps', '--filter', 'name=spotify-companion', '--format', '{{.Names}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}

/**
 * ⚠️ A write while the container records injects an artefact `skipped` row: the play closes on
 * `track-change` at near-zero progress, and both classifier-v2 conditions fail. 4–6 of those into a
 * corpus of 22 real skips is up to 27% contamination of the evidence base a rule is validated
 * against. `--no-post` and `status` are exempt because they write nothing.
 */
function preflightContainer() {
  if (NO_POST || MODE === 'status') return { checked: false, reason: 'no write is issued' };
  const running = containerRunning();
  if (running === true) {
    fail(
      'the spotify-companion container is UP. This probe writes to the player and the container ' +
        'records the result as a skipped play. Run `docker compose down` first.',
      { containerRunning: true },
    );
  }
  return { checked: true, containerRunning: running };
}

// ── token, and the scope the POST needs ───────────────────────────────────────────────────────
const REQUIRED_SCOPE = 'user-modify-playback-state';

async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch (error) {
    fail(`could not read ${CONFIG}: ${error.message}. Run \`npm run auth\`.`);
  }
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
    }),
  });
  const body = await res.json();
  if (!res.ok) fail(`token refresh ${res.status}`, { body });

  let scopeOk = null;
  if (typeof body.scope === 'string') {
    scopeOk = body.scope.split(/\s+/).includes(REQUIRED_SCOPE);
    if (!scopeOk && !NO_POST && MODE !== 'status') {
      fail(`the token does not carry ${REQUIRED_SCOPE}; POST would 403. Re-run \`npm run auth\`.`, {
        granted: body.scope,
      });
    }
  }
  return { token: body.access_token, scopeOk };
}

// ── the two calls ─────────────────────────────────────────────────────────────────────────────
async function currentlyPlaying(token) {
  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { at: now(), status: 204, playing: null };
  const body = await res.json().catch(() => null);
  if (!res.ok) return { at: now(), status: res.status, playing: null, body };
  const item = body?.item ?? null;
  return {
    at: now(),
    status: res.status,
    playing: {
      trackId: item?.id ?? null,
      title: item?.name ?? null,
      artist: item?.artists?.map((a) => a.name).join(', ') ?? null,
      progressMs: body?.progress_ms ?? null,
      durationMs: item?.duration_ms ?? null,
      remainingMs:
        item?.duration_ms != null && body?.progress_ms != null
          ? item.duration_ms - body.progress_ms
          : null,
      isPlaying: body?.is_playing ?? null,
      contextType: body?.context?.type ?? null,
      contextUri: body?.context?.uri ?? null,
    },
  };
}

/** ⚠️ THE ONE WRITE. 204 on success. */
async function skipToNext(token) {
  const res = await fetch('https://api.spotify.com/v1/me/player/next', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { at: now(), status: res.status, body };
}

// ── record file ───────────────────────────────────────────────────────────────────────────────
async function loadRecord() {
  if (!existsSync(RECORD)) {
    return {
      probe: 'P-U5-1',
      question:
        "does POST /me/player/next act on the player's real state, or on the lagged state the read endpoints report?",
      startedAt: now(),
      note: 'Driven step by step. The listener\'s account of what they HEARD is added per trial afterwards — it is the measurement, and no endpoint supplies it.',
      trials: [],
    };
  }
  return JSON.parse(await readFile(RECORD, 'utf8'));
}

async function saveRecord(record) {
  await mkdir(OUT_DIR, { recursive: true });
  record.updatedAt = now();
  await writeFile(RECORD, JSON.stringify(record, null, 2), 'utf8');
}

/**
 * Classify the trial's admissibility from the reported lag alone.
 * ⚠️ Advisory. It never drops a trial — a silently filtered trial is worse than an admitted one
 * that is labelled.
 */
function classifyLag(remainingMs) {
  if (remainingMs == null) return { band: 'unknown', testsHazard: null };
  if (remainingMs < NO_LAG_CEILING_MS) {
    return {
      band: 'no-lag',
      testsHazard: false,
      why: 'A was reported almost to its end, so reported and audible agree. There is no discrepancy for the POST to land on the wrong side of. Expected for an album control; a wasted trial in the DJ.',
    };
  }
  if (remainingMs >= LAG_BAND_MS.low && remainingMs <= LAG_BAND_MS.high) {
    return {
      band: 'in-measured-band',
      testsHazard: true,
      why: `${Math.round(remainingMs / 1000)}s unreported tail — inside the 18-41s band classifier v2 measured. This trial tests the hazard.`,
    };
  }
  return {
    band: remainingMs > LAG_BAND_MS.high ? 'above-band' : 'below-band',
    testsHazard: true,
    why: `${Math.round(remainingMs / 1000)}s unreported tail — outside the measured 18-41s band but still a real discrepancy, so the trial is admissible. ⚠️ Note the band moving.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════

const preflight = preflightContainer();
const { token, scopeOk } = await accessToken();

if (MODE === 'status') {
  const sample = await currentlyPlaying(token);
  const p = sample.playing;
  out({
    ok: true,
    mode: 'status',
    scopeOk,
    status: sample.status,
    playing: p,
    secondsUntilBoundary: p?.remainingMs != null ? Math.round(p.remainingMs / 1000) : null,
    djOrRadioPrefix: p?.contextUri?.includes('37i9dQZF1E') ?? false,
    note: p
      ? '⚠️ context.type cannot distinguish the AI DJ from a radio station — both are type: playlist with the 37i9dQZF1E prefix (R11). The listener must say which it is.'
      : 'nothing is playing',
  });
  process.exit(0);
}

/**
 * Wait for playback to BEGIN, then report the context once. Read-only.
 *
 * Exists so the operator can signal the listener to start and have the context read the instant
 * they do, rather than spending a round trip asking whether they have started yet.
 */
if (MODE === 'await-playback') {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const sample = await currentlyPlaying(token);
    if (sample.status !== 204 && sample.playing?.trackId && sample.playing.isPlaying) {
      const p = sample.playing;
      out({
        ok: true,
        mode: 'await-playback',
        waitedSeconds: Math.round((Date.now() - (deadline - MAX_WAIT_MS)) / 1000),
        playing: p,
        secondsUntilBoundary: p.remainingMs != null ? Math.round(p.remainingMs / 1000) : null,
        djOrRadioPrefix: p.contextUri?.includes('37i9dQZF1E') ?? false,
        note: '⚠️ context.type cannot distinguish the AI DJ from a radio station — both are type: playlist with the 37i9dQZF1E prefix (R11). The listener must confirm which it is.',
      });
      process.exit(0);
    }
    await sleep(2000);
  }
  fail(`playback did not start within ${MAX_WAIT_MS / 1000}s`);
}

if (MODE !== 'trial') {
  fail(`unknown mode ${JSON.stringify(MODE)}. Use "status", "await-playback" or "trial".`);
}

// ── one trial ─────────────────────────────────────────────────────────────────────────────────
const startedWatching = Date.now();
let lastA = await currentlyPlaying(token);
if (lastA.status === 204 || !lastA.playing?.trackId) {
  fail('nothing is playing — start playback, then re-run.');
}

const watchStart = { ...lastA };
let boundary = null;

while (Date.now() - startedWatching < MAX_WAIT_MS) {
  await sleep(POLL_MS);
  const sample = await currentlyPlaying(token);
  if (sample.status === 204 || !sample.playing?.trackId) continue;
  if (sample.playing.trackId !== lastA.playing.trackId) {
    boundary = { a: lastA, b: sample };
    break;
  }
  lastA = sample;
}

if (!boundary) {
  fail(`no reported track boundary within ${MAX_WAIT_MS / 1000}s`, {
    lastSeen: lastA.playing,
    hint: 'the track may be longer than --max-wait; re-run with a larger value',
  });
}

const aRemainingMsAtLastSight = boundary.a.playing.remainingMs;
const lag = classifyLag(aRemainingMsAtLastSight);

let post = null;
let latencyMs = null;
const after = [];

if (NO_POST) {
  post = { skipped: true, reason: '--no-post (rehearsal): boundary detected, no write issued' };
} else {
  post = await skipToNext(token);
  latencyMs = new Date(post.at) - new Date(boundary.b.at);
  let elapsed = 0;
  for (const at of AFTER_READS_MS) {
    await sleep(at - elapsed);
    elapsed = at;
    const sample = await currentlyPlaying(token);
    after.push({ afterMs: at, status: sample.status, playing: sample.playing });
  }
}

const trial = {
  label: LABEL,
  recordedAt: now(),
  rehearsal: NO_POST,
  watchStartedAt: watchStart.at,
  a: { ...boundary.a.playing, lastReportedAt: boundary.a.at },
  b: { ...boundary.b.playing, firstReportedAt: boundary.b.at },
  aRemainingMsAtLastSight,
  lagAssessment: lag,
  post,
  postLatencyMsAfterBoundaryDetected: latencyMs,
  after,
  heard: null, // ⚠️ filled in afterwards. THIS is the measurement.
};

const record = await loadRecord();
record.trials.push(trial);
await saveRecord(record);

out({
  ok: true,
  mode: 'trial',
  trialNumber: record.trials.length,
  preflight,
  trial,
  recordFile: RECORD,
  reminder:
    '⚠️ Everything above is what the API SAYS, and the API is the suspect. Ask the listener what they HEARD: did the audio cut, had the new track already started audibly at that moment, and how long had the audio they were hearing been playing.',
});
