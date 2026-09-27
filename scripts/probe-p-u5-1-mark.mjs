#!/usr/bin/env node
/**
 * Probe P-U5-1, measurement instrument — **the listener marks the transition; the script logs the
 * API.** Correlated afterwards, so nothing depends on anyone reacting in time.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ## Why this exists, and what went wrong with the earlier attempts
 *
 * The question is whether Spotify's **audio output** lags the state its API reports. Two earlier
 * attempts failed for the same reason, and it is worth writing down:
 *
 *   1. The operator polled the API and then ASKED the listener what they heard. ⚠️ The round trip
 *      was slower than the effect — by the time the question arrived, the window had passed. An
 *      answer of "I'm hearing the new track" 12 s after an 8 s lag is consistent with a lag **and**
 *      with no lag, so it discriminates nothing.
 *   2. Reading the reported tail alone. ⚠️ A tail is not a lag. Measured 2026-09-27: a transition
 *      with an **8.3 s** reported tail sounded perfectly natural on video — no cutoff, no gap.
 *      **Automix is ON on this machine** (CLAUDE.md), and it trims a track's trailing fade while
 *      the API still counts those seconds toward `duration_ms`. So a small tail is expected and
 *      means nothing.
 *
 * ✅ **So: three independent timestamps, none of them dependent on reaction time being fast — only
 * on it being consistent.**
 *
 *   | Signal | Source | Captured by |
 *   |--------|--------|-------------|
 *   | Reported flip | `GET /me/player/currently-playing` | this script, polling |
 *   | **Audio** flip | the listener's **ear** | the listener pressing SPACE |
 *   | **UI** flip | the Spotify client's own display | the listener pressing `u` |
 *
 * `audio_mark − api_flip` **is the audio lag.** Positive means the audio trailed the API — the
 * mechanism that would make a rule's skip truncate a track the listener was still enjoying.
 * `ui_mark − api_flip` says whether the client agrees with the API, which tells us whether the
 * lag is in the *state store* or only in *audio rendering*.
 *
 * ⚠️ Human reaction time (~200–500 ms) is irrelevant against an effect of 18–41 s, and it is
 * CONSTANT across marks, so it cancels when comparing transitions.
 *
 * ## ⚠️ What makes a transition worth anything
 *
 * Only transitions where the **reported tail is large** can test the hazard. A near-zero tail means
 * reported and audible agree by construction and the trial is uninformative — which is exactly why
 * the 8.3 s transition came out clean. The summary flags each transition's band so an uninformative
 * one cannot be counted as evidence.
 *
 * ## This script issues NO WRITES
 *
 * It never calls `POST /me/player/next` and never opens `history.db`. **The container may stay up**
 * — nothing here can contaminate the corpus. Run it for as long as you like.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * usage:
 *   node scripts/probe-p-u5-1-mark.mjs                 # runs until you press q
 *   node scripts/probe-p-u5-1-mark.mjs --poll 1000     # poll spacing in ms (default 1000)
 *
 * keys, pressed the INSTANT you observe the thing:
 *   a       the AUDIO just changed to a different track   ← the measurement
 *   SPACE   same as `a`, but see the warning below
 *   u       the SPOTIFY UI just changed track
 *   x       something odd — an abrupt cut, a gap, DJ commentary
 *   q       stop, print the correlation, write the record
 *
 * ## ⚠️ THE INSTRUMENT'S OWN FAILURE MODE, found on its first run
 *
 * Keys go to whichever window has focus, and the listener is naturally **watching Spotify**. On the
 * first run the marks went to the Spotify window — where **SPACE is play/pause** — so instead of
 * recording a transition they stopped the music.
 *
 * Three mitigations, because an instrument that is easy to use wrongly will be used wrongly:
 *   1. **`a` is the recommended key.** SPACE still works, but it is the one key with a destructive
 *      meaning in the other window.
 *   2. The banner says the terminal must hold focus, and that Spotify only needs to be **visible**,
 *      not focused — the audio mark is *heard*, so the listener's eyes are free regardless.
 *   3. ⚠️ The script **watches `is_playing`**. A pause with no mark in the preceding 2.5 s is the
 *      signature of a leaked SPACE, and it says so on the spot rather than letting the session be
 *      wasted. Every toggle is recorded in `playbackToggles` so a contaminated run is auditable
 *      afterwards too.
 *
 * Record: aidlc-docs/construction/u5-automated-skipping/probes/p-u5-1-marks-<stamp>.json
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG =
  process.env.SPOTIFY_CONFIG_PATH ?? join(projectRoot, 'secrets', 'spotify-config.json');
const OUT_DIR = join(projectRoot, 'aidlc-docs', 'construction', 'u5-automated-skipping', 'probes');

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const POLL_MS = argOf('--poll', 1000);

/** Tail bands, for labelling a transition's usefulness. From classifier v2's measurement. */
const LAG_BAND_MS = { low: 18_000, high: 41_000 };
/** At or below this, a tail is explainable by Automix trimming a trailing fade. Uninformative. */
const AUTOMIX_TAIL_CEILING_MS = 10_000;
/** How far from an API flip a listener mark may be and still be considered the same event. */
const MARK_WINDOW_MS = 90_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const clock = () => new Date().toISOString().slice(11, 23);

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

// ── token ─────────────────────────────────────────────────────────────────────────────────────
async function accessToken() {
  const c = JSON.parse(await readFile(CONFIG, 'utf8'));
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(red(`token refresh ${res.status}: ${JSON.stringify(body)}`));
    process.exit(1);
  }
  return body.access_token;
}

async function currentlyPlaying(token) {
  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return { at: nowIso(), status: 204, playing: null };
  const body = await res.json().catch(() => null);
  if (!res.ok) return { at: nowIso(), status: res.status, playing: null };
  const item = body?.item ?? null;
  return {
    at: nowIso(),
    status: res.status,
    playing: item && {
      trackId: item.id,
      title: item.name,
      artist: item.artists?.map((a) => a.name).join(', ') ?? null,
      progressMs: body.progress_ms ?? null,
      durationMs: item.duration_ms ?? null,
      remainingMs:
        item.duration_ms != null && body.progress_ms != null
          ? item.duration_ms - body.progress_ms
          : null,
      isPlaying: body.is_playing ?? null,
      contextType: body.context?.type ?? null,
      contextUri: body.context?.uri ?? null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════

const token = await accessToken();

/** Every API sample, in order. The raw evidence. */
const samples = [];
/** Reported track changes, derived from consecutive samples. */
const apiFlips = [];
/** What the listener marked, and when. */
const marks = [];
/**
 * ⚠️ Playback pause/resume events, and whether each looks like a MARK THAT LANDED IN THE WRONG
 * WINDOW. SPACE in the Spotify window is play/pause, so a leaked audio mark stops the music --
 * which happened on the first run of this instrument. Detecting it in the moment is worth more than
 * documenting it, because the listener is watching Spotify and not this log.
 */
const playbackToggles = [];

let latest = null;
let running = true;

console.log(`
${b('Probe P-U5-1 — mark the transition')}

${dim('This script only READS. No skips are issued, history.db is never opened,')}
${dim('and the container may stay up. Run it as long as you like.')}

  ${b('a')} ${dim('or')} ${b('SPACE')}   the ${cyan('AUDIO')} just changed track   ${dim('<- the measurement')}
  ${b('u')}           the ${cyan('SPOTIFY UI')} just changed track
  ${b('x')}           something odd (abrupt cut, gap, DJ talking)
  ${b('q')}           stop, correlate, write the record

${red('⚠ THIS TERMINAL MUST HAVE KEYBOARD FOCUS.')} ${dim('Keys go to whatever window is focused.')}
${red('⚠ SPACE in the Spotify window is PLAY/PAUSE')} ${dim('— a leaked mark stops your music.')}
   ${b('Use')} ${b(cyan('a'))} ${b('rather than SPACE')}${dim(', and keep Spotify VISIBLE beside this window')}
   ${dim('rather than focused. You need to SEE Spotify, not click it — and the audio mark is')}
   ${dim('heard, not seen, so your eyes are free anyway.')}

${dim('This script also watches for playback pausing, and will tell you if it looks like a')}
${dim('mark leaked into Spotify instead of landing here.')}

${yellow('Press the key the INSTANT you observe it.')} ${dim('Reaction time is constant, so it cancels.')}
${dim('Watching the API now...')}
`);

// ── keypress capture ──────────────────────────────────────────────────────────────────────────
const isTty = stdin.isTTY;
if (isTty) {
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  stdin.on('data', (key) => {
    if (key === '\u0003' || key === 'q') {
      running = false;
      return;
    }
    // ⚠️ `a` is the RECOMMENDED audio key. SPACE still works for muscle memory, but SPACE in the
    // Spotify window is play/pause, so a mark that lands in the wrong window stops the music.
    const kind =
      key === 'a' || key === ' '
        ? 'audio'
        : key === 'u'
          ? 'ui'
          : key === 'x'
            ? 'anomaly'
            : null;
    if (!kind) return;
    const mark = {
      kind,
      at: nowIso(),
      apiSaidAtThatMoment: latest?.playing
        ? {
            trackId: latest.playing.trackId,
            title: latest.playing.title,
            progressMs: latest.playing.progressMs,
            remainingMs: latest.playing.remainingMs,
          }
        : null,
    };
    marks.push(mark);
    const glyph = kind === 'audio' ? cyan('♪ AUDIO') : kind === 'ui' ? cyan('▣ UI   ') : yellow('⚠ ODD  ');
    console.log(
      `${dim(clock())} ${glyph} marked  ${dim(
        `api currently says: ${mark.apiSaidAtThatMoment?.title ?? '(nothing)'}`,
      )}`,
    );
  });
} else {
  console.log(red('⚠ stdin is not a TTY — keypresses cannot be captured. Run this in a terminal.'));
  process.exit(1);
}

// ── polling loop ──────────────────────────────────────────────────────────────────────────────
while (running) {
  const sample = await currentlyPlaying(token);
  samples.push(sample);

  // ⚠️ A pause with no mark in the preceding couple of seconds is the signature of a SPACE that
  // went to Spotify instead of here. Say so immediately rather than let the session be wasted.
  if (sample.playing && latest?.playing && sample.playing.isPlaying !== latest.playing.isPlaying) {
    const lastMarkAgoMs = marks.length
      ? new Date(sample.at) - new Date(marks[marks.length - 1].at)
      : Infinity;
    const looksLeaked = sample.playing.isPlaying === false && lastMarkAgoMs > 2500;
    playbackToggles.push({
      at: sample.at,
      isPlaying: sample.playing.isPlaying,
      msSinceLastMark: Number.isFinite(lastMarkAgoMs) ? lastMarkAgoMs : null,
      looksLikeLeakedMark: looksLeaked,
    });
    if (looksLeaked) {
      console.log(
        `${dim(clock())} ${red('⚠ PLAYBACK PAUSED')} and no mark arrived here. ` +
          `${yellow('Did a SPACE go to the Spotify window?')}`,
      );
      console.log(
        `           ${dim('Click THIS terminal to give it focus, un-pause Spotify, and use')} ${b(cyan('a'))} ${dim('instead.')}`,
      );
    } else {
      console.log(
        `${dim(clock())} ${dim(sample.playing.isPlaying ? 'playback resumed' : 'playback paused')}`,
      );
    }
  }

  if (sample.playing) {
    if (latest?.playing && latest.playing.trackId !== sample.playing.trackId) {
      const flip = {
        at: sample.at,
        from: { ...latest.playing, lastReportedAt: latest.at },
        to: { ...sample.playing, firstReportedAt: sample.at },
        fromRemainingMsAtLastSight: latest.playing.remainingMs,
      };
      apiFlips.push(flip);
      const tail = flip.fromRemainingMsAtLastSight;
      const band =
        tail == null
          ? dim('tail unknown')
          : tail <= AUTOMIX_TAIL_CEILING_MS
            ? dim(`tail ${(tail / 1000).toFixed(1)}s — small, Automix-explainable, UNINFORMATIVE`)
            : tail >= LAG_BAND_MS.low && tail <= LAG_BAND_MS.high
              ? green(`tail ${(tail / 1000).toFixed(1)}s — IN BAND, this one counts`)
              : yellow(`tail ${(tail / 1000).toFixed(1)}s — outside 18-41s but non-trivial`);
      console.log(
        `${dim(clock())} ${b('→ API FLIP')} ${flip.from.title} ${dim('->')} ${flip.to.title}   ${band}`,
      );
    } else if (!latest?.playing) {
      console.log(
        `${dim(clock())} ${dim('watching')} ${sample.playing.title} — ${sample.playing.artist} ` +
          dim(`[${Math.round((sample.playing.remainingMs ?? 0) / 1000)}s left]`),
      );
    }
    latest = sample;
  } else if (latest?.playing) {
    console.log(`${dim(clock())} ${yellow('playback stopped or idle')}`);
    latest = sample;
  }

  await sleep(POLL_MS);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// correlate
// ═══════════════════════════════════════════════════════════════════════════════════════════════
if (isTty) stdin.setRawMode(false);
stdin.pause();

const ms = (a, z) => new Date(z) - new Date(a);

/**
 * Pair each API flip with the listener's nearest mark of each kind.
 * ⚠️ Nearest, not next — a mark may legitimately PRECEDE the API flip if the audio led it, and
 * assuming the API is first would build the expected answer into the instrument.
 */
const correlated = apiFlips.map((flip) => {
  const nearest = (kind) => {
    const candidates = marks
      .filter((m) => m.kind === kind)
      .map((m) => ({ mark: m, deltaMs: ms(flip.at, m.at) }))
      .filter((c) => Math.abs(c.deltaMs) <= MARK_WINDOW_MS)
      .sort((x, y) => Math.abs(x.deltaMs) - Math.abs(y.deltaMs));
    return candidates[0] ?? null;
  };
  const tail = flip.fromRemainingMsAtLastSight;
  return {
    apiFlipAt: flip.at,
    from: flip.from.title,
    to: flip.to.title,
    reportedTailMs: tail,
    informative:
      tail == null ? null : tail > AUTOMIX_TAIL_CEILING_MS,
    tailBand:
      tail == null
        ? 'unknown'
        : tail <= AUTOMIX_TAIL_CEILING_MS
          ? 'small-automix-explainable'
          : tail >= LAG_BAND_MS.low && tail <= LAG_BAND_MS.high
            ? 'in-measured-band'
            : 'outside-band-but-nontrivial',
    audioLagMs: nearest('audio')?.deltaMs ?? null,
    uiLagMs: nearest('ui')?.deltaMs ?? null,
    anomalyNearby: nearest('anomaly') != null,
  };
});

console.log(`\n${b('═══ correlation ═══')}\n`);
if (correlated.length === 0) {
  console.log(dim('  no API track flips were observed.\n'));
} else {
  console.log(
    `  ${'from -> to'.padEnd(44)} ${'tail'.padStart(7)} ${'audio lag'.padStart(10)} ${'ui lag'.padStart(8)}  band`,
  );
  for (const row of correlated) {
    const label = `${row.from} -> ${row.to}`.slice(0, 43).padEnd(44);
    const tail = row.reportedTailMs == null ? '   ?  ' : `${(row.reportedTailMs / 1000).toFixed(1)}s`.padStart(7);
    const al = row.audioLagMs == null ? '  (none)  ' : `${(row.audioLagMs / 1000).toFixed(1)}s`.padStart(10);
    const ul = row.uiLagMs == null ? ' (none) ' : `${(row.uiLagMs / 1000).toFixed(1)}s`.padStart(8);
    const colour = row.informative === false ? dim : (s) => s;
    console.log(
      `  ${colour(label)} ${colour(tail)} ${colour(al)} ${colour(ul)}  ${colour(row.tailBand)}` +
        (row.anomalyNearby ? yellow('  ⚠ odd') : ''),
    );
  }
  console.log(`
  ${b('Reading it')}
  ${dim('audio lag = (your SPACE mark) - (API flip). POSITIVE means the audio TRAILED the API,')}
  ${dim('which is the mechanism that would make a skip truncate a track you were still enjoying.')}
  ${dim('ui lag    = same for the Spotify UI. It separates a STATE-STORE lag from an AUDIO-ONLY one.')}

  ${yellow('⚠ Rows marked small-automix-explainable prove nothing')} ${dim('— a near-zero tail means')}
  ${dim('reported and audible agree by construction. Only the larger-tail rows test the hazard.')}
`);
}

const record = {
  probe: 'P-U5-1',
  instrument: 'listener-marked transitions, correlated against API polling',
  question:
    'does Spotify audio output lag the state its API reports, such that a skip at the reported boundary truncates a still-audible track?',
  startedAt: samples[0]?.at ?? nowIso(),
  finishedAt: nowIso(),
  pollMs: POLL_MS,
  constants: { LAG_BAND_MS, AUTOMIX_TAIL_CEILING_MS, MARK_WINDOW_MS },
  caveats: [
    'Automix is ON on this machine (CLAUDE.md), and trims trailing fades while duration_ms still counts them. A small reported tail is therefore expected and uninformative.',
    'Human reaction latency (~200-500ms) is constant across marks and negligible against an 18-41s effect.',
    'Marks are paired with the NEAREST api flip, not the next one — a mark may legitimately precede a flip, and assuming otherwise would build the expected answer into the instrument.',
  ],
  apiFlips,
  marks,
  playbackToggles,
  correlated,
  sampleCount: samples.length,
  samples,
};

await mkdir(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `p-u5-1-marks-${record.startedAt.replace(/[:.]/g, '-')}.json`);
await writeFile(outPath, JSON.stringify(record, null, 2), 'utf8');
console.log(`record written: ${outPath}\n`);
process.exit(0);
