#!/usr/bin/env node
/**
 * Probe P-U5-1 — does `POST /me/player/next` act on the PLAYER's state, or on the LAGGED state
 * the read endpoints report?
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ## What this probe is for
 *
 * Classifier v2 established that **in the AI DJ context Spotify's API stops reporting a track
 * 18–41 s before it stops playing.** The listener hears track A finish; the API already says B.
 *
 * `EvaluationCoordinator` takes its play boundary from `PlayObserver`, which consumes `tick` — the
 * API's notion of the current track. So in the DJ context the rules engine opens a decision for B
 * while A is **still audible**, and fires its skip ~10 s later (`ENRICHMENT_WAIT_MS`).
 *
 * ⚠️ **Every step of that is established except the last**: which state the skip acts on.
 *
 *   If the lag is in Spotify's REPORTING  -> the skip hits a player still on A, TRUNCATING an
 *                                            unmatched track the listener was enjoying, while B
 *                                            plays on unskipped. In 50–70% of this user's listening.
 *   If the lag is in Spotify's STATE STORE -> the skip lands on B. FR-46 as designed is safe.
 *
 * **Not inferable from anything this project has.** Hence a probe, on the R11 precedent.
 *
 * ## ⚠️ Why the instrument is your EAR and not an endpoint
 *
 * The obvious check — *after the POST, is a different track reported?* — is **exactly the signal
 * the DJ context reports early**. It can say "skip confirmed" when nothing audible happened.
 * A confirmation guaranteed to pass is not a confirmation. So the script records what the API
 * says, and then **asks you what you heard**, and the second one is the measurement.
 *
 * ## The reading
 *
 *   | What you heard                                          | What it means                   |
 *   |---------------------------------------------------------|---------------------------------|
 *   | Audio cut a track that had been playing a while, then    | HAZARD IS REAL. Player state    |
 *   | a new track started                                      | is A. FR-46 needs a guard       |
 *   | The new track had already started audibly, and IT cut    | HAZARD IS NOT REAL              |
 *   | Nothing cut at all                                       | ⚠️ A THIRD finding — the skip    |
 *   |                                                          | did not take effect. FR-48      |
 *   | Mixed across trials                                      | ⚠️ Report as MIXED. Do NOT      |
 *   |                                                          | average it — R11 found exactly  |
 *   |                                                          | a context-dependent answer      |
 *
 * ## The control is not optional
 *
 * 2 trials during **album** playback, where no reporting lag is known. If album behaves
 * differently from the DJ, **that difference is the finding**. Without the control an ambiguous
 * DJ result is unusable. R11 did this and it is why its answer was trustworthy.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ## ⚠️ THE CONTAINER MUST BE DOWN. This script refuses to run otherwise.
 *
 * This probe **writes to the player**, and the container **records what the player does**. Each
 * trial skips a track ~0–3 s in; `PlayObserver` closes that play on `track-change` at near-zero
 * progress, and in `outcomeClassifier` BOTH v2 conditions fail — `unobservedTailMs` is nearly the
 * whole duration against the 55 s cap, `observedPositionRatio` ~0.01 against the 0.75 rail. So it
 * is recorded as **`skipped`, `skip_source = 'user'`**.
 *
 * 4–6 trials would inject 4–6 artefact skips into a corpus of **22 real ones** — up to **27%
 * contamination of the entire evidence base** a rule is validated against (BR-40). That is the
 * exact defect class classifier v2 just spent a day removing.
 *
 * The probe needs no container: it reads `secrets/spotify-config.json` and holds its access token
 * in memory. `webApiClient.ts` documents why that cannot race the MCP server — token handling
 * deliberately never writes back, and Spotify's refresh tokens are long-lived and reusable.
 *
 *     docker compose down        # before
 *     docker compose up -d       # after
 *
 * Cost: ~15 minutes of unrecorded listening. Nothing else is lost.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * usage:
 *   node scripts/probe-p-u5-1.mjs --rehearse    # ⚠️ START HERE. Detects boundaries, NEVER posts
 *   node scripts/probe-p-u5-1.mjs               # the real thing: 4 DJ trials + 2 album controls
 *   node scripts/probe-p-u5-1.mjs --dj 6        # more DJ trials
 *   node scripts/probe-p-u5-1.mjs --skip-control # ⚠️ don't. See "the control is not optional"
 *
 * Writes its record to aidlc-docs/construction/u5-automated-skipping/probes/.
 * Touches `history.db` NEVER — it does not even open it.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG =
  process.env.SPOTIFY_CONFIG_PATH ?? join(projectRoot, 'secrets', 'spotify-config.json');
const OUT_DIR = join(
  projectRoot,
  'aidlc-docs',
  'construction',
  'u5-automated-skipping',
  'probes',
);

const REHEARSE = process.argv.includes('--rehearse');
const SKIP_CONTROL = process.argv.includes('--skip-control');
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const DJ_TRIALS = argOf('--dj', 4);
const CONTROL_TRIALS = SKIP_CONTROL ? 0 : argOf('--control', 2);

/** Poll spacing while watching for a track boundary. 1 req/s for a few minutes is well inside limits. */
const POLL_MS = 1000;
/** How long to wait for a boundary before giving up on a trial. */
const BOUNDARY_TIMEOUT_MS = 6 * 60 * 1000;
/** When to re-read the API after the POST. Two reads: one immediate, one after things settle. */
const AFTER_READS_MS = [1500, 6000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const rl = createInterface({ input: stdin, output: stdout });

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function die(message) {
  console.error(`\n${red('REFUSED')} ${message}\n`);
  rl.close();
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PREFLIGHT 1 — the container must be down
// ═══════════════════════════════════════════════════════════════════════════════════════════════

function containerRunning() {
  try {
    const out = execFileSync(
      'docker',
      ['ps', '--filter', 'name=spotify-now-playing', '--format', '{{.Names}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.trim().length > 0;
  } catch {
    return null; // docker not reachable — cannot prove either way
  }
}

async function preflightContainer() {
  // ⚠️ Rehearsal issues NO write, so it cannot contaminate anything and the container may stay up.
  // The point of rehearsal is to understand the detection loop at zero cost; requiring a shutdown
  // for a read-only run would make the safe path more expensive than the risky one.
  if (REHEARSE) {
    console.log(
      green('✓ rehearsal makes no writes — the container may stay up, and nothing will be recorded'),
    );
    return;
  }

  const running = containerRunning();

  if (running === true) {
    die(
      `the ${b('spotify-now-playing')} container is UP.

  This probe writes to the player, and the container records what the player does. Each trial
  would be recorded as a ${b('skipped')} play with ${b("skip_source = 'user'")} — 4–6 artefact
  skips injected into a corpus of ${b('22 real ones')}. Up to 27% contamination of the evidence
  base a rule is validated against, and the same defect class classifier v2 just removed.

    ${b('docker compose down')}      then re-run this script
    ${b('docker compose up -d')}     when the probe is finished`,
    );
  }

  if (running === null) {
    console.log(
      yellow('\n⚠  Could not reach docker, so the container state is UNPROVEN, not proven-down.'),
    );
    const answer = await rl.question(
      `   ${b('Is the spotify-now-playing container definitely stopped?')} (yes/no) `,
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      die('stopped at your request. Run `docker compose down`, then try again.');
    }
    return;
  }

  console.log(green('✓ container is down — nothing will record these trials'));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PREFLIGHT 2 — token, and the scope this probe actually needs
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ The scope check is not paranoia. `POST /me/player/next` needs `user-modify-playback-state`.
 * `scripts/auth.mjs` requests it, but the REFRESH TOKEN ON DISK was minted by whatever scope set
 * was in force when the user last authorised — which may predate a change to that list. The token
 * endpoint hands back the granted scopes for free, so checking costs nothing and saves finding out
 * via a 403 in the middle of a session that needs the user present.
 *
 * This is the project's own rule pointing at itself: a recorded positive decays as silently as a
 * recorded negative.
 */
const REQUIRED_SCOPE = 'user-modify-playback-state';

async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch (error) {
    die(`could not read ${CONFIG}\n\n  ${error.message}\n\n  Run ${b('npm run auth')} first.`);
  }
  const { clientId, clientSecret, refreshToken } = creds;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) die(`token refresh ${res.status}: ${JSON.stringify(body)}`);

  if (typeof body.scope === 'string') {
    const granted = body.scope.split(/\s+/);
    if (!granted.includes(REQUIRED_SCOPE)) {
      die(
        `the token on disk does NOT carry ${b(REQUIRED_SCOPE)}.

  Granted: ${granted.join(', ')}

  ${b('POST /me/player/next')} would 403. Re-run ${b('npm run auth')} and authorise again.`,
      );
    }
    console.log(green(`✓ token carries ${REQUIRED_SCOPE}`));
  } else {
    console.log(
      yellow(`⚠  the token response did not state its scopes — ${REQUIRED_SCOPE} is UNVERIFIED`),
    );
  }
  return body.access_token;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// The two API calls this probe makes
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function currentlyPlaying(token) {
  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { at: now(), status: 204, playing: null };
  const body = await res.json().catch(() => null);
  if (!res.ok) return { at: now(), status: res.status, playing: null, error: body };
  return {
    at: now(),
    status: res.status,
    playing: {
      trackId: body?.item?.id ?? null,
      title: body?.item?.name ?? null,
      artist: body?.item?.artists?.map((a) => a.name).join(', ') ?? null,
      progressMs: body?.progress_ms ?? null,
      durationMs: body?.item?.duration_ms ?? null,
      isPlaying: body?.is_playing ?? null,
      contextType: body?.context?.type ?? null,
      contextUri: body?.context?.uri ?? null,
    },
  };
}

/** ⚠️ THE ONE WRITE. Returns 204 on success. */
async function skipToNext(token) {
  const res = await fetch('https://api.spotify.com/v1/me/player/next', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { at: now(), status: res.status, body };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Boundary detection
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const fmt = (p) =>
  p ? `${p.title} — ${p.artist} ${dim(`[${Math.round((p.progressMs ?? 0) / 1000)}s/${Math.round((p.durationMs ?? 0) / 1000)}s]`)}` : '(nothing)';

/**
 * Poll until the reported track id CHANGES, then return both sides of the boundary.
 *
 * ⚠️ `firstSeenB` matters as much as the ids. The whole question is what is audible when the POST
 * fires, so how FRESH the boundary is must be recorded — not assumed to be "immediately".
 */
async function awaitBoundary(token, label) {
  const started = Date.now();
  let previous = await currentlyPlaying(token);

  if (previous.status === 204 || !previous.playing?.trackId) {
    die('nothing is playing. Start playback on your device, then re-run.');
  }

  console.log(`  ${dim('watching')} ${fmt(previous.playing)}`);
  let lastA = previous;

  while (Date.now() - started < BOUNDARY_TIMEOUT_MS) {
    await sleep(POLL_MS);
    const sample = await currentlyPlaying(token);
    if (sample.status === 204 || !sample.playing?.trackId) {
      console.log(`  ${yellow('playback stopped — waiting for it to resume')}`);
      continue;
    }
    if (sample.playing.trackId !== lastA.playing.trackId) {
      return { a: lastA, b: sample, detectedAt: sample.at, watchedForMs: Date.now() - started };
    }
    lastA = sample;
  }
  die(`no track boundary within ${BOUNDARY_TIMEOUT_MS / 1000}s during ${label}.`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// One trial
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function askHeard(trialLabel) {
  console.log(`\n  ${b('Now tell me what you HEARD.')} ${dim('This is the measurement.')}`);

  const cut = await rl.question(`  1. Did the audio cut to a different track at all? (y/n) `);
  const didCut = /^y/i.test(cut.trim());

  if (!didCut) {
    const note = await rl.question(`  2. Anything to note? (free text, or blank) `);
    return { didCut: false, newTrackAlreadyAudible: null, heardSeconds: null, note: note.trim() };
  }

  const already = await rl.question(
    `  2. ${b('At the moment it cut')}, had the NEW track already been playing audibly? (y/n/unsure) `,
  );
  const seconds = await rl.question(
    `  3. Roughly how long had the audio you were hearing been playing when it cut? (seconds, or blank) `,
  );
  const note = await rl.question(`  4. Anything else? (free text, or blank) `);

  return {
    didCut: true,
    newTrackAlreadyAudible: /^y/i.test(already.trim())
      ? true
      : /^n/i.test(already.trim())
        ? false
        : null,
    heardSeconds: seconds.trim() === '' ? null : Number(seconds.trim()),
    note: note.trim(),
  };
}

/**
 * ⚠️ A TENTATIVE reading, printed for the operator's benefit. It is NOT the conclusion — the
 * conclusion is drawn across trials, with the control, by a human. A per-trial verdict printed
 * confidently would invite exactly the averaging the R11 precedent forbids.
 */
function tentativeReading(heard) {
  if (!heard.didCut) return 'SKIP-DID-NOT-TAKE-EFFECT (a third finding — relevant to FR-48)';
  if (heard.newTrackAlreadyAudible === false) return 'consistent with HAZARD REAL (player was on A)';
  if (heard.newTrackAlreadyAudible === true) return 'consistent with HAZARD NOT REAL';
  return 'INCONCLUSIVE for this trial';
}

async function runTrial(token, index, label) {
  console.log(`\n${b(`── ${label} trial ${index} ──────────────────────────────────`)}`);
  console.log(dim('  Waiting for the reported track to change. Keep listening.'));

  const boundary = await awaitBoundary(token, label);

  console.log(`  ${dim('A was')} ${fmt(boundary.a.playing)}`);
  console.log(`  ${b('B now reported')} ${fmt(boundary.b.playing)}`);

  if (REHEARSE) {
    console.log(
      `  ${yellow('REHEARSAL — no POST issued.')} ${dim('This is where the real run would skip.')}`,
    );
    return {
      index,
      label,
      rehearsal: true,
      before: boundary,
      post: null,
      after: [],
      heard: null,
    };
  }

  // ── THE ONE WRITE, as immediately after detection as possible ──────────────────────────────
  const post = await skipToNext(token);
  const latencyMs = new Date(post.at) - new Date(boundary.detectedAt);
  console.log(
    `  ${b('POST /me/player/next')} -> ${post.status === 204 ? green('204') : red(post.status)} ` +
      dim(`(${latencyMs}ms after detection)`),
  );
  if (post.status !== 204) {
    console.log(`  ${red('the write failed')} ${JSON.stringify(post.body)}`);
  }

  const after = [];
  let elapsed = 0;
  for (const at of AFTER_READS_MS) {
    await sleep(at - elapsed);
    elapsed = at;
    const sample = await currentlyPlaying(token);
    after.push({ afterMs: at, ...sample });
    console.log(`  ${dim(`+${at}ms API says`)} ${fmt(sample.playing)}`);
  }

  console.log(
    `\n  ${yellow('⚠  Everything above is what the API SAYS, and the API is the suspect.')}`,
  );

  const heard = await askHeard(`${label} ${index}`);
  console.log(`  ${dim('tentative reading:')} ${tentativeReading(heard)}`);

  return {
    index,
    label,
    rehearsal: false,
    before: boundary,
    post: { ...post, latencyMsAfterDetection: latencyMs },
    after,
    heard,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Context identification — ⚠️ verified, never assumed
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function identifyContext(token, expected) {
  const sample = await currentlyPlaying(token);
  if (sample.status === 204 || !sample.playing) {
    die('nothing is playing. Start playback, then re-run.');
  }
  const { contextType, contextUri } = sample.playing;
  console.log(`\n  ${b('playing')} ${fmt(sample.playing)}`);
  console.log(`  ${b('context')} type=${contextType ?? '(none)'} uri=${contextUri ?? '(none)'}`);

  // ⚠️ R11: the DJ and a radio station are BOTH `type: playlist` with the same 37i9dQZF1E prefix.
  // `context.type` cannot distinguish them, so the script must ASK rather than classify.
  if (contextUri?.includes('37i9dQZF1E')) {
    console.log(
      dim(
        '  note: this uri has the 37i9dQZF1E prefix. ⚠️ The AI DJ AND radio stations both do —\n' +
          '        context.type cannot tell them apart (R11). Your answer decides, not the uri.',
      ),
    );
  }

  const answer = await rl.question(
    `  ${b(`Is this ${expected} playback?`)} (yes/no) `,
  );
  if (!/^y(es)?$/i.test(answer.trim())) {
    die(`switch to ${expected} playback, then re-run.`);
  }
  return { contextType, contextUri, confirmedAs: expected };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════════════════════

console.log(`
${b('Probe P-U5-1')} — does POST /me/player/next act on the player's state, or the lagged
               state the read endpoints report?

${REHEARSE ? yellow('REHEARSAL MODE — no writes. Boundary detection only.') : b('LIVE MODE — this will skip tracks you are listening to.')}
plan: ${DJ_TRIALS} AI DJ trial(s)${CONTROL_TRIALS ? ` + ${CONTROL_TRIALS} album control trial(s)` : red(' + NO CONTROL (--skip-control)')}
`);

if (SKIP_CONTROL && !REHEARSE) {
  console.log(
    red('⚠  Without the album control, an ambiguous DJ result is UNUSABLE. R11 ran a control\n') +
      red('   and that is why its answer was trustworthy. Reconsider.\n'),
  );
}

await preflightContainer();
const token = await accessToken();

const record = {
  probe: 'P-U5-1',
  question:
    "does POST /me/player/next act on the player's real state or on the lagged state the read endpoints report?",
  startedAt: now(),
  mode: REHEARSE ? 'rehearsal' : 'live',
  plannedTrials: { dj: DJ_TRIALS, albumControl: CONTROL_TRIALS },
  groups: [],
};

const groups = [
  { label: 'AI DJ', expected: 'AI DJ', trials: DJ_TRIALS },
  ...(CONTROL_TRIALS ? [{ label: 'album (control)', expected: 'album', trials: CONTROL_TRIALS }] : []),
];

for (const group of groups) {
  console.log(`\n${b('═══ ' + group.label + ' ═══')}`);
  if (group.expected === 'album') {
    console.log(
      dim('  The control. Switch to an ALBUM now — no reporting lag is known in this context.\n') +
        dim('  ⚠️ If album behaves differently from the DJ, THAT DIFFERENCE is the finding.'),
    );
    await rl.question(`  ${b('Press enter once album playback is going.')} `);
  }

  const context = await identifyContext(token, group.expected);
  const trials = [];
  for (let i = 1; i <= group.trials; i += 1) {
    trials.push(await runTrial(token, i, group.label));
    if (i < group.trials) {
      await rl.question(`\n  ${dim('Let playback settle, then press enter for the next trial.')} `);
    }
  }
  record.groups.push({ label: group.label, context, trials });
}

record.finishedAt = now();

// ── write the record ──────────────────────────────────────────────────────────────────────────
await mkdir(OUT_DIR, { recursive: true });
const stamp = record.startedAt.replace(/[:.]/g, '-');
const outPath = join(OUT_DIR, `p-u5-1-${REHEARSE ? 'rehearsal-' : ''}${stamp}.json`);
await writeFile(outPath, JSON.stringify(record, null, 2), 'utf8');

// ── summary ───────────────────────────────────────────────────────────────────────────────────
console.log(`\n${b('═══ summary ═══')}\n`);
for (const group of record.groups) {
  console.log(b(group.label));
  for (const trial of group.trials) {
    if (trial.rehearsal) {
      console.log(
        `  trial ${trial.index}: boundary detected ${trial.before.a.playing.title} -> ${trial.before.b.playing.title}`,
      );
      continue;
    }
    const h = trial.heard;
    console.log(
      `  trial ${trial.index}: POST ${trial.post.status} (${trial.post.latencyMsAfterDetection}ms) · ` +
        `cut=${h.didCut ? 'y' : 'n'} · newAlreadyAudible=${h.newTrackAlreadyAudible ?? 'unsure'} · ` +
        `heard~${h.heardSeconds ?? '?'}s`,
    );
    console.log(`            ${dim(tentativeReading(h))}`);
    if (h.note) console.log(`            ${dim('note: ' + h.note)}`);
  }
  console.log();
}

console.log(`record written: ${outPath}\n`);

if (!REHEARSE) {
  console.log(
    yellow('⚠  Do NOT average a mixed result into a conclusion.') +
      ' R11 found a context-dependent\n   answer that neither branch of the execution plan anticipated. If the DJ and album\n   groups disagree, that disagreement IS the finding.\n',
  );
  console.log(`${b('Now:')} docker compose up -d\n`);
}

rl.close();
