/**
 * Receives now-playing updates over a WebSocket (Requirements Q5) and renders them,
 * plus an on-demand diagnostics run against /api/diagnostics.
 *
 * The backend polls the MCP server and pushes; the browser never polls. Progress is
 * interpolated locally between pushes so the bar moves smoothly at 3s push intervals.
 */

import { needsSessionCheck, onClose } from './connectionDecision.js';

const el = (id) => document.getElementById(id);

const ui = {
  card: el('card'),
  status: el('status'),
  title: el('title'),
  titleText: el('title-text'),
  liked: el('liked'),
  likedBadge: el('liked-badge'),
  likedGlyph: el('liked-glyph'),
  artist: el('artist'),
  album: el('album'),
  fill: el('fill'),
  elapsed: el('elapsed'),
  total: el('total'),
  device: el('device'),
  volume: el('volume'),
  shuffle: el('shuffle'),
  repeat: el('repeat'),
  raw: el('raw'),
  enrichment: el('enrichment'),
  released: el('released'),
  age: el('age'),
  following: el('following'),
  albumType: el('album-type'),
  trackNo: el('track-no'),
  explicit: el('explicit'),
  genres: el('genres'),
  enrichWarn: el('enrich-warn'),
  art: el('art'),
  artWrap: el('art-wrap'),
  backdrop: el('backdrop'),
  diag: el('diag'),
  diagBody: el('diag-body'),
  stats: el('stats'),
  statPlays: el('stat-plays'),
  statFirst: el('stat-first'),
  trendTitle: el('trend-title'),
  trendSpan: el('trend-span'),
  trendPlot: el('trend-plot'),
  trendLegend: el('trend-legend'),
  trendNote: el('trend-note'),
  trendTableBody: el('trend-table-body'),
};

const DASH = '—';

let progress = { baseMs: 0, durationMs: 0, at: 0, running: false };

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The track's position within its release: "#3 of 12 tracks".
 *
 * Both halves are optional — Spotify does not always supply either — so each combination is
 * handled rather than assumed:
 *
 *   3, 12   -> "#3 of 12 tracks"
 *   3, 1    -> "#3 of 1 track"      (singular; a "1 tracks" defect was fixed here once before)
 *   3, null -> "#3"                 ("of ?" would be worse than saying less
 *   null, 12-> "12 tracks"          (the total is still a fact worth showing)
 *   null,null -> em dash
 */
function formatTrackPosition(trackNumber, totalTracks) {
  const plural = (n) => `${n} track${n === 1 ? '' : 's'}`;

  if (trackNumber && totalTracks) return `#${trackNumber} of ${plural(totalTracks)}`;
  if (trackNumber) return `#${trackNumber}`;
  if (totalTracks) return plural(totalTracks);
  return DASH;
}

function setState(state, statusText) {
  ui.card.dataset.state = state;
  ui.status.textContent = statusText;
}

/**
 * Swaps the cover art. Tracked by URL so an unchanged track doesn't retrigger the fade,
 * and the backdrop only updates once the image has actually decoded — otherwise a slow
 * network shows a blurred wash with no cover under it.
 */
let currentArtUrl = null;
let lastTrackId = null;

function renderArt(art, albumName) {
  const url = art?.display ?? null;
  if (url === currentArtUrl) return;
  currentArtUrl = url;

  if (!url) {
    ui.artWrap.dataset.hasArt = 'false';
    ui.art.removeAttribute('src');
    ui.art.alt = '';
    ui.backdrop.dataset.active = 'false';
    ui.backdrop.style.backgroundImage = '';
    return;
  }

  const preload = new Image();
  preload.addEventListener('load', () => {
    // A newer track may have arrived while this was loading.
    if (currentArtUrl !== url) return;
    ui.art.src = url;
    ui.art.alt = albumName ? `Album art for ${albumName}` : 'Album art';
    ui.artWrap.dataset.hasArt = 'true';
    ui.backdrop.style.backgroundImage = `url("${(art.full ?? url).replace(/"/g, '%22')}")`;
    ui.backdrop.dataset.active = 'true';
  });
  preload.addEventListener('error', () => {
    if (currentArtUrl !== url) return;
    ui.artWrap.dataset.hasArt = 'false';
    ui.backdrop.dataset.active = 'false';
  });
  preload.src = url;
}

function clearEnrichment() {
  for (const key of ['released', 'age', 'following', 'albumType', 'trackNo', 'explicit']) {
    ui[key].textContent = DASH;
  }
  ui.genres.innerHTML = `<span class="muted">${DASH}</span>`;
  ui.liked.textContent = DASH;
  ui.likedBadge.dataset.liked = 'unknown';
  ui.likedGlyph.textContent = '?';
  ui.enrichWarn.hidden = true;
  ui.enrichment.dataset.loading = 'true';
}

function clearTrack() {
  ui.titleText.textContent = DASH;
  ui.artist.textContent = DASH;
  ui.album.textContent = DASH;
  renderArt(null, null);
  ui.fill.style.width = '0%';
  ui.elapsed.textContent = '0:00';
  ui.total.textContent = '0:00';
  for (const key of ['device', 'volume', 'shuffle', 'repeat']) ui[key].textContent = DASH;
  clearEnrichment();
  clearStats();
  progress.running = false;
}

function paintProgress() {
  requestAnimationFrame(paintProgress);
  if (!progress.running || !progress.durationMs) return;

  const elapsed = Math.min(progress.baseMs + (performance.now() - progress.at), progress.durationMs);
  ui.fill.style.width = `${(elapsed / progress.durationMs) * 100}%`;
  ui.elapsed.textContent = formatTime(elapsed);
}

function renderEnrichment(data, albumName) {
  if (!data) {
    clearEnrichment();
    return;
  }

  ui.enrichment.dataset.loading = 'false';
  renderArt(data.art, albumName);

  ui.released.textContent = data.releaseDate ?? DASH;
  ui.age.textContent = data.ageYears === null ? DASH : `${data.ageYears} yr`;

  ui.following.textContent =
    data.following === null ? DASH : data.following ? 'Yes' : 'No';
  ui.following.dataset.flag = data.following === null ? '' : data.following ? 'yes' : 'no';

  // "Release type" is the album *type* — album, single, compilation. It used to be labelled
  // "Album", which read as though it should show the album name; the name is already in the
  // Playing section above, so duplicating it here would be redundant as well as confusing.
  ui.albumType.textContent = data.albumType ?? DASH;

  // Track position reads as one fact — "#3 of 12 tracks" — rather than a bare "#3" with the
  // total stranded on a different row.
  ui.trackNo.textContent = formatTrackPosition(data.trackNumber, data.totalTracks);
  ui.explicit.textContent = data.explicit === null ? DASH : data.explicit ? 'Yes' : 'No';

  // Genres are rendered by renderGenres() from the snapshot, not from enrichment: Spotify
  // stopped returning them entirely, so the source is MusicBrainz.

  if (data.warnings?.length) {
    ui.enrichWarn.textContent = data.warnings.join(' · ');
    ui.enrichWarn.hidden = false;
  } else {
    ui.enrichWarn.hidden = true;
  }
}

function render(data) {
  // U4: pre-derived by `src/ui/statusBar.ts`; this only paints it.
  if (data.status) {
    lastServerStatus = data.status;
    renderStatusBar();
    refreshAutomationIfStale(data.status.automation);
  }

  if (data.error) {
    setState('error', data.error);
    ui.raw.textContent = data.detail ?? '';
    progress.running = false;
    return;
  }

  if (!data.playing) {
    setState('idle', 'Nothing playing');
    clearTrack();
    ui.raw.textContent = '';
    return;
  }

  setState(data.isPlaying ? 'playing' : 'paused', data.isPlaying ? 'Playing' : 'Paused');

  // Into the inner span: the heading also contains the liked badge, and writing textContent on
  // the heading itself would delete it on the first push.
  ui.titleText.textContent = data.track ?? DASH;
  ui.artist.textContent = data.artist ?? DASH;
  ui.album.textContent = data.album ?? DASH;
  ui.total.textContent = data.duration ?? '0:00';

  progress = {
    baseMs: data.progressMs ?? 0,
    durationMs: data.durationMs ?? 0,
    at: performance.now(),
    running: Boolean(data.isPlaying),
  };

  if (!progress.running && progress.durationMs) {
    ui.fill.style.width = `${(progress.baseMs / progress.durationMs) * 100}%`;
    ui.elapsed.textContent = data.progress ?? '0:00';
  }

  ui.device.textContent = data.device ?? DASH;
  ui.volume.textContent = data.volume ?? DASH;
  ui.shuffle.textContent = data.shuffle ?? DASH;
  ui.repeat.textContent = data.repeat ?? DASH;

  // Enrichment lands a beat after the track. Drop the old cover immediately on a track
  // change, so the previous album's art is never shown against the new title.
  if (data.trackId !== lastTrackId) {
    lastTrackId = data.trackId;
    if (!data.enrichment) renderArt(null, null);
  }

  renderEnrichment(data.enrichment, data.album);
  renderLiked(data.liked ?? null);
  renderLabel(data.label);
  renderGenres(data.label);
  refreshStats(data.trackId ?? null, data.enrichment?.primaryArtistId ?? null,
    data.enrichment?.primaryArtistName ?? null);

  ui.raw.textContent = data.raw ?? '';
}

/**
 * Render the label verdict.
 *
 * ⚠️ **An absent label is `pending`, never `unknown`.** They are different facts: one means the
 * lookup has not happened, the other that it happened and came back empty. At one request per
 * second behind a backfill sweep, `pending` can persist for minutes, so this is a common state
 * rather than a transient one — and collapsing the two would misreport the coverage the panel
 * below is measuring.
 */
function renderLabel(label) {
  const verdict = el('label-verdict');
  const names = el('label-names');

  if (!label) {
    verdict.textContent = 'pending';
    verdict.dataset.verdict = 'pending';
    // Pending, not unknown: the lookup has not happened. At one request per second behind a
    // backfill sweep this state can last minutes, so it is common rather than transient.
    renderLabelNames(names, null, 'pending');
    return;
  }

  verdict.textContent = label.contested ? `${label.verdict} (contested)` : label.verdict;
  verdict.dataset.verdict = label.verdict;
  verdict.title = label.confidence ? `confidence: ${label.confidence}` : '';

  renderLabelNames(names, label.names, label.verdict);
}

/**
 * The label names behind one verdict.
 *
 * ⚠️ **Empty is explained, never left as a bare dash.** `pending` and `unknown` are different
 * facts — not looked up yet, versus looked up and MusicBrainz has no label — and a dash asserts
 * neither. MusicBrainz's coverage on recent releases is about 44%, so empty is the common case
 * here and it needs to read as a measurement rather than as a broken field.
 */
function renderLabelNames(target, names, verdict) {
  if (!target) return;

  if (names === null || names === undefined || names.length === 0) {
    target.replaceChildren(
      muted(
        verdict === 'unknown'
          ? 'MusicBrainz lists no label'
          : verdict === null || verdict === 'pending'
            ? 'not yet resolved'
            : DASH,
      ),
    );
    return;
  }

  target.replaceChildren(
    ...names.map((name) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = name;
      return tag;
    }),
  );
}

/**
 * Saved-track ("liked") status.
 *
 * ⚠️ **`null` is unknown and renders as the word, never as "No".** The set can be unavailable, and
 * a `false` shown in its place would be an observed choice that was never observed — the same
 * rule the recorded `likedAtStart` column follows.
 *
 * The badge carries the age of the answer in its tooltip, because it is a cached set refreshed at
 * startup and every six hours: a `No` can be hours old, and the moment that matters is right after
 * someone has liked the track. Clicking re-reads the set.
 */
function renderLiked(liked) {
  if (!liked) {
    ui.liked.textContent = DASH;
    ui.likedBadge.dataset.liked = 'unknown';
    ui.likedGlyph.textContent = '?';
    ui.likedBadge.title = 'Saved-track status is unavailable.';
    ui.likedBadge.setAttribute('aria-label', 'Liked status unknown');
    return;
  }

  const asOf = liked.asOf ? `as of ${new Date(liked.asOf).toLocaleTimeString()}` : 'never loaded';

  if (liked.isLiked === null) {
    ui.liked.textContent = 'unknown';
    ui.likedBadge.dataset.liked = 'unknown';
    ui.likedGlyph.textContent = '?';
  } else if (liked.isLiked) {
    ui.liked.textContent = liked.addedAt ? `Yes · ${formatDay(liked.addedAt)}` : 'Yes';
    ui.likedBadge.dataset.liked = 'yes';
    ui.likedGlyph.textContent = '♥';
  } else {
    ui.liked.textContent = 'No';
    ui.likedBadge.dataset.liked = 'no';
    ui.likedGlyph.textContent = '♡';
  }

  const state =
    liked.isLiked === null ? 'Liked status unknown' : liked.isLiked ? 'Liked' : 'Not liked';
  ui.likedBadge.title = `${state}, ${asOf}. Click to re-read your saved tracks.`;
  ui.likedBadge.setAttribute('aria-label', `${state}. Click to refresh.`);
}

let likedRefreshing = false;

ui.likedBadge.addEventListener('click', async () => {
  if (likedRefreshing) return;
  likedRefreshing = true;
  ui.likedBadge.dataset.busy = 'true';
  // Pinned at click time. A full re-read is ~12 requests and takes seconds, which is long
  // enough for the track to change underneath it — and applying the answer anyway would show
  // one track's liked status under another track's name.
  const askedFor = lastTrackId;

  try {
    const params = askedFor ? `?trackId=${encodeURIComponent(askedFor)}` : '';
    const response = await fetch(`/api/liked/refresh${params}`, { method: 'POST' });
    if (response.ok) {
      const body = await response.json();
      // The next tick would carry this anyway, but three seconds of an unchanged badge after a
      // deliberate click reads as the click having done nothing.
      if (body.liked && askedFor === lastTrackId) renderLiked(body.liked);
    }
  } catch {
    // Leave the badge showing what it had. A failed refresh means the answer is older than we
    // hoped, not that it is unknown.
  } finally {
    likedRefreshing = false;
    delete ui.likedBadge.dataset.busy;
  }
});

/**
 * Genres.
 *
 * ⚠️ **The source is MusicBrainz, not Spotify.** `GET /artists/{id}` returns no `genres` field at
 * all — one of this project's documentation-vs-reality catches — so the old "Spotify no longer
 * returns artist genres" note was permanent furniture. It is now shown only when we genuinely
 * have nothing from any source.
 *
 * The vote count is rendered as a tooltip rather than inline: it is the only quality signal
 * MusicBrainz gives (eleven people agreeing beats one person's opinion), but it would clutter the
 * tag row.
 */
function renderGenres(label) {
  const genres = label?.genres ?? null;

  if (genres === null) {
    // Unknown, not empty. Distinguished for the same reason `pending` is distinguished from
    // `unknown` elsewhere: we have not asked, or the lookup failed.
    ui.genres.replaceChildren(muted(label ? 'not yet resolved' : DASH));
    return;
  }

  if (genres.length === 0) {
    ui.genres.replaceChildren(muted('MusicBrainz lists none for this artist'));
    return;
  }

  ui.genres.replaceChildren(
    ...genres.slice(0, 10).map((genre) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = genre.name;
      tag.title = `${genre.count} MusicBrainz vote${genre.count === 1 ? '' : 's'}`;
      // One vote is one person's opinion; dim it rather than hiding it.
      if (genre.count <= 1) tag.dataset.weak = 'true';
      return tag;
    }),
  );
}

function muted(text) {
  const span = document.createElement('span');
  span.className = 'muted';
  span.textContent = text;
  return span;
}

// -- Diagnostics ------------------------------------------------------------

// U10 (BR-81.3): `warn` is a risk, not a fault. Its own mark, so colour is never the only channel.
const STATUS_MARK = { ok: '✓', warn: '◐', fail: '✗', skip: '–' };

async function runDiagnostics() {
  ui.diagBody.innerHTML = '<p class="muted">Running…</p>';

  let report;
  try {
    report = await (await fetch('/api/diagnostics')).json();
  } catch (error) {
    ui.diagBody.innerHTML = '<p class="warn"></p>';
    ui.diagBody.querySelector('.warn').textContent = `Could not reach the backend: ${error}`;
    return;
  }

  renderCoverage(report.coverage ?? null);

  ui.diagBody.replaceChildren(
    ...report.steps.map((step) => {
      const row = document.createElement('div');
      row.className = 'diag-row';
      row.dataset.status = step.status;

      const mark = document.createElement('span');
      mark.className = 'diag-mark';
      mark.textContent = STATUS_MARK[step.status] ?? '?';

      const body = document.createElement('div');
      const name = document.createElement('p');
      name.className = 'diag-name';
      name.textContent = step.name;
      const detail = document.createElement('p');
      detail.className = 'diag-detail';
      detail.textContent = step.detail;
      body.append(name, detail);

      const time = document.createElement('span');
      time.className = 'diag-time';
      time.textContent = `${step.durationMs}ms`;

      row.append(mark, body, time);
      return row;
    }),
  );
}

/**
 * Coverage (BR-10).
 *
 * Rendered as a table with no pass/fail status: it is a measurement, and the by-year breakdown
 * is the part that matters. Measured coverage was 100% for pre-2022 releases and 43% for
 * 2022-onward — a single aggregate would hide that the misses concentrate on recent independent
 * releases, which is exactly the population the hypothesis is about.
 */
function renderCoverage(coverage) {
  const body = el('coverage-body');
  const asOf = el('coverage-asof');

  if (!coverage) {
    asOf.textContent = '';
    body.replaceChildren(muted('Label enrichment is not running.'));
    return;
  }

  // Required, not decorative: the same query run twice can legitimately differ, because a
  // previously-unknown ISRC may have resolved in between.
  asOf.textContent = `as of ${coverage.asOf}`;

  const summary = document.createElement('p');
  const pct = coverage.total === 0 ? 0 : Math.round((coverage.resolved / coverage.total) * 100);
  summary.textContent =
    `${coverage.resolved}/${coverage.total} resolved (${pct}%) · ` +
    `${coverage.pending} pending · ` +
    `unknown: ${Object.entries(coverage.unknownByReason)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${reason} ${n}`)
      .join(', ') || 'none'}`;

  const table = document.createElement('table');
  table.className = 'coverage';
  const head = document.createElement('tr');
  for (const heading of ['Release year', 'Plays', 'Resolved']) {
    const th = document.createElement('th');
    th.textContent = heading;
    head.append(th);
  }
  table.append(head);

  for (const row of coverage.byReleaseYear ?? []) {
    const tr = document.createElement('tr');
    for (const value of [row.year, row.total, `${row.resolved}`]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.append(td);
    }
    table.append(tr);
  }

  body.replaceChildren(summary, table);
}

/** Populate the play selector so the trace can address any play in history (BR-12.4). */
async function loadTracePlays() {
  const select = el('trace-play');
  try {
    const { plays } = await (await fetch('/api/history/recent')).json();
    select.replaceChildren(
      ...plays.map((play) => {
        const option = document.createElement('option');
        option.value = String(play.id);
        option.textContent = `${play.title} — ${play.artistName}`;
        return option;
      }),
    );
  } catch {
    select.replaceChildren();
  }
}

/**
 * Render one level of a resolution trace.
 *
 * The **suppressed** candidates are listed first and by name, because that is the part a reader
 * would otherwise never learn: `unknown` because MusicBrainz knew nothing and `unknown` because a
 * Publisher entry was found and refused are the same verdict with opposite meanings.
 */
function renderTraceLevel(title, trace) {
  const section = document.createElement('div');
  section.className = 'trace-level';

  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);

  if (trace.classifierVersion?.diverged) {
    // R3 guarantees the classifier gets re-tuned. Without this warning the trace would present
    // today's reasoning as the historical record — self-consistent, plausible, never run.
    const warn = document.createElement('p');
    warn.className = 'warn';
    warn.textContent =
      `⚠ Recomputed with classifier v${trace.classifierVersion.running}; ` +
      `this play was classified by v${trace.classifierVersion.storedOnPlay}. ` +
      'The derivation below is what today\u2019s rules would decide, not what ran at the time.';
    section.append(warn);
  }

  const summary = document.createElement('p');
  summary.className = 'trace-summary';
  summary.textContent = trace.summary || '—';
  section.append(summary);

  if (trace.join) {
    const join = document.createElement('p');
    join.className = 'muted';
    join.textContent =
      `join ${trace.join.key} = ${trace.join.value} · match ${trace.join.matchMethod} · ` +
      `tier ${trace.narrowingTier} · ${trace.releaseCount} release(s) · resolved ${trace.join.resolvedAt}`;
    section.append(join);
  }

  if ((trace.candidates ?? []).length > 0) {
    const list = document.createElement('ul');
    list.className = 'trace-candidates';
    for (const candidate of trace.candidates) {
      const item = document.createElement('li');
      item.dataset.eligible = String(candidate.eligible);
      item.textContent = candidate.eligible
        ? `✓ ${candidate.labelName} (${candidate.labelType ?? 'untyped'}, ${candidate.strength})`
        : `✗ ${candidate.labelName} (${candidate.labelType ?? 'untyped'}) — refused by ${candidate.suppressedBy}`;
      list.append(item);
    }
    section.append(list);
  }

  if ((trace.rulesFired ?? []).length > 0) {
    const rules = document.createElement('p');
    rules.className = 'muted';
    rules.textContent = `rules fired: ${trace.rulesFired.join(', ')}`;
    section.append(rules);
  }

  return section;
}

async function loadTrace() {
  const body = el('trace-body');
  const playId = el('trace-play').value;
  if (!playId) return;

  body.replaceChildren(muted('Loading…'));
  try {
    const trace = await (await fetch(`/api/explain/${playId}`)).json();
    if (trace.error) {
      body.replaceChildren(muted(trace.error));
      return;
    }
    // ⚠️ RELEASE level only. The artist-level label verdict was removed on 2026-09-10 (43af45e — it read OTHER
    // artists' record deals through guest credits), and /api/explain stopped returning `artist`. This line kept
    // rendering it, threw on `undefined.classifierVersion`, and took the release level down with it — unnoticed for
    // a month, because app.js has no tests. Found in the hands-on test P-3, 2026-10-09. A level the API does not
    // send is skipped, never dereferenced.
    body.replaceChildren(...(trace.release ? [renderTraceLevel('Release level', trace.release)] : [muted('No release-level trace for this play.')]));
  } catch (error) {
    body.replaceChildren(muted(`Could not load the trace: ${error}`));
  }
}

el('trace-play').addEventListener('change', loadTrace);

el('diag-open').addEventListener('click', () => {
  ui.diag.showModal();
  runDiagnostics();
  void loadTracePlays().then(loadTrace);
});
el('diag-close').addEventListener('click', () => ui.diag.close());
el('diag-run').addEventListener('click', runDiagnostics);

/**
 * Export download (US-25).
 *
 * Navigates rather than fetching: the response carries `Content-Disposition: attachment`, so the
 * browser streams it straight to disk. Buffering it through `fetch` into a Blob would defeat the
 * streaming the server does and could hold a year of history in memory for no benefit.
 */
el('export-open').addEventListener('click', () => {
  const format = window.prompt('Export format — csv or json?', 'csv');
  if (format === null) return;

  const normalised = format.trim().toLowerCase();
  if (normalised !== 'csv' && normalised !== 'json') {
    window.alert(`Unsupported format "${format}". Use csv or json.`);
    return;
  }

  window.location.href = `/api/history/export?format=${normalised}`;
});

// -- Settings: backup & restore (U6, FR-57…FR-59, FR-63) -------------------------------------------
//
// ⚠️ This file only RENDERS. Every label, disabled-reason, comparison row, warning and restart message comes
// from the server (`view`), derived by src/ui/maintenancePanel.ts — because this file has no tests, and the
// surface that can REPLACE the corpus must not be decided where nothing can check it (the U5 precedent).
//
// Every maintenance POST carries the ingest header (BR-46.3). The browser adds the Origin itself.

const INGEST_HEADERS = { 'x-spotify-companion-ingest': '1' };
let restoreToken = null;
let confirmWord = 'RESTORE';

function maintenanceMessage(text) {
  const m = el('maintenance-message');
  m.textContent = text ?? '';
  m.hidden = !text;
}

function renderButton(button, view) {
  button.textContent = view.label;
  button.disabled = view.disabled;
  // A disabled control always says why (BR-51.4) — in the tooltip and, via the message line, in words.
  button.title = view.reason ?? '';
}

async function refreshMaintenance() {
  let body;
  try {
    const r = await fetch('/api/maintenance');
    body = await r.json();
    if (!r.ok) {
      maintenanceMessage(body.error ?? 'Backup and restore are unavailable.');
      for (const id of ['backup-create', 'restore-open']) el(id).disabled = true;
      return null;
    }
  } catch (error) {
    maintenanceMessage(`Could not reach the app: ${error}`);
    return null;
  }
  const v = body.view;
  renderButton(el('backup-create'), v.backup);
  renderButton(el('restore-open'), v.restore);
  el('backup-note').textContent = v.backup.reason ?? v.backupNote;
  el('restore-note').textContent = v.restore.reason ?? v.restoreNote;
  el('undo-row').hidden = v.undo === null;
  if (v.undo) {
    renderButton(el('undo-open'), v.undo);
    el('undo-note').textContent = v.undo.reason ?? v.undo.detail;
  }
  const last = el('backup-last');
  last.hidden = v.lastRestore === null;
  if (v.lastRestore) {
    last.textContent = v.lastRestore.text;
    last.dataset.tone = v.lastRestore.tone;
  }
  return v;
}

el('settings-open').addEventListener('click', () => {
  maintenanceMessage(null);
  el('settings').showModal();
  void refreshAccess();
  void refreshMaintenance();
  void refreshCredentials();
  void refreshSettingsStatus();
});
el('settings-close').addEventListener('click', () => el('settings').close());

/**
 * *Create backup*. Fetched rather than navigated to, because the request must carry the ingest header (a plain
 * link cannot) — then handed to the browser as a download. The archive is small (~1.6 MB) and the server builds
 * it in full before sending, so holding it as a Blob costs little.
 */
el('backup-create').addEventListener('click', async () => {
  maintenanceMessage(null);
  el('backup-create').disabled = true;
  el('backup-create').textContent = 'Creating backup…';
  try {
    const r = await fetch('/api/maintenance/backup', { method: 'POST', headers: INGEST_HEADERS });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      maintenanceMessage(`Backup failed: ${body.error ?? r.statusText}`);
      return;
    }
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'spotify-backup.tar.gz';
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) {
    maintenanceMessage(`Backup failed: ${error}`);
  } finally {
    void refreshMaintenance();
  }
});

function showComparison(view) {
  confirmWord = view.confirmWord;
  el('restore-word').textContent = view.confirmWord;
  const rows = el('restore-rows');
  rows.replaceChildren(
    ...view.rows.map((row) => {
      const tr = document.createElement('tr');
      for (const text of [row.label, row.backup, row.current]) {
        const td = document.createElement(text === row.label ? 'th' : 'td');
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
  el('restore-rules').textContent = view.rulesNote;
  // U7 (BR-59.2): the opt-in. UNCHECKED every time the dialog opens; disabled with the reason when invalid.
  const option = view.rulesOption ?? null;
  el('restore-rules-option').hidden = option === null;
  el('restore-apply-rules').checked = false;
  el('restore-rules-panel').hidden = true;
  if (option) {
    el('restore-rules-label').textContent = option.label;
    el('restore-apply-rules').disabled = option.disabled;
    el('restore-rules-reason').hidden = option.reason === null;
    el('restore-rules-reason').textContent = option.reason ?? '';
    if (option.panel) renderComparisonPanel('restore-rules', option.panel);
  }
  el('restore-warning').replaceChildren(
    ...view.warning.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
  el('restore-typed').value = '';
  el('restore-go').disabled = true;
  el('restore-confirm').hidden = false;
  el('restore-typed').focus();
}

function hideComparison() {
  el('restore-confirm').hidden = true;
  restoreToken = null;
}

el('restore-open').addEventListener('click', () => {
  maintenanceMessage(null);
  el('restore-file').value = '';
  el('restore-file').click();
});

/** Upload: the FILE is the request body (P-41) — never a multipart form. */
el('restore-file').addEventListener('change', async () => {
  const file = el('restore-file').files?.[0];
  if (!file) return;
  hideComparison();
  el('restore-open').disabled = true;
  el('restore-note').textContent = `Checking ${file.name}…`;
  try {
    const r = await fetch('/api/maintenance/restore', {
      method: 'POST',
      headers: { ...INGEST_HEADERS, 'content-type': 'application/gzip' },
      body: file,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      maintenanceMessage(`This file can’t be restored: ${body.error ?? r.statusText}`);
      return;
    }
    restoreToken = body.token;
    showComparison(body.view);
  } catch (error) {
    maintenanceMessage(`Upload failed: ${error}`);
  } finally {
    void refreshMaintenance();
  }
});

el('undo-open').addEventListener('click', async () => {
  maintenanceMessage(null);
  hideComparison();
  const r = await fetch('/api/maintenance/undo', { method: 'POST', headers: INGEST_HEADERS });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    maintenanceMessage(body.error ?? 'Nothing to undo.');
    return;
  }
  restoreToken = body.token;
  showComparison(body.view);
});

// The confirm button stays disabled until the word matches EXACTLY (BR-48.2).
el('restore-typed').addEventListener('input', () => {
  el('restore-go').disabled = el('restore-typed').value !== confirmWord;
});

el('restore-cancel').addEventListener('click', () => {
  const token = restoreToken;
  hideComparison();
  if (token) {
    void fetch('/api/maintenance/restore/cancel', {
      method: 'POST',
      headers: { ...INGEST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }
});

el('restore-go').addEventListener('click', async () => {
  if (!restoreToken) return;
  el('restore-go').disabled = true;
  // Read BEFORE confirming: the restart is recognised by `startedAt` CHANGING, not by seeing the server go
  // down — the app is back in ~0.5 s, faster than any poll would notice it was gone.
  const beforeConfirm = await fetch('/api/maintenance').then((x) => x.json()).catch(() => null);
  const r = await fetch('/api/maintenance/restore/confirm', {
    method: 'POST',
    headers: { ...INGEST_HEADERS, 'content-type': 'application/json' },
    // U7 (BR-59.2/59.3): the one typed RESTORE confirms both — the rules choice rides along, opt-in only.
    body: JSON.stringify({ token: restoreToken, typed: el('restore-typed').value, applyRules: el('restore-apply-rules').checked === true }),
  });
  const body = await r.json().catch(() => ({}));
  if (r.status !== 202) {
    maintenanceMessage(body.error ?? 'The restore could not be started. Nothing was changed.');
    el('restore-go').disabled = false;
    return;
  }
  hideComparison();
  void waitForRestart(beforeConfirm?.view?.restart, beforeConfirm?.startedAt ?? null);
});

/**
 * P-47 — wait for the app to come back, and SAY SO if it does not. Spinning for ever on "reconnecting…" reads
 * as *Spotify is down* — the 2026-09-05 shape.
 */
async function waitForRestart(restart, startedBefore) {
  const view = restart ?? {
    restarting: 'Restarting to finish the restore…',
    notBack: 'The app has not come back. Check that its container is running.',
    timeoutMs: 60_000,
    automatic: true,
  };
  maintenanceMessage(view.restarting);
  for (const id of ['backup-create', 'restore-open', 'undo-open']) el(id).disabled = true;
  if (!view.automatic) return; // under `npm start` nothing restarts the app; the message says so.

  const started = Date.now();
  while (Date.now() - started < view.timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      const r = await fetch('/api/maintenance', { cache: 'no-store' });
      if (r.ok) {
        const body = await r.json();
        if (body.startedAt !== startedBefore) {
          maintenanceMessage(null);
          await refreshMaintenance();
          return;
        }
      }
    } catch {
      // Down, mid-restart. Keep waiting.
    }
  }
  maintenanceMessage(view.notBack);
}

// -- Listening statistics ---------------------------------------------------

/**
 * How often this track has come up, and the weekly trend for its primary artist.
 *
 * Fed by `/api/history/stats`, which touches nothing upstream — so this panel keeps working
 * when Spotify or MusicBrainz does not, and cannot become the reason a track change is slow.
 *
 * ## Stack order and colour
 *
 * `completed` sits on the baseline because it is the series the eye compares week to week; a
 * segment floating above a variable offset cannot be compared by length.
 */

/**
 * The series the chart draws: **outcomes the app actually observed.**
 *
 * ⚠️ **`Not recorded` and `Inconclusive` are different facts, and merging them was a real defect.**
 * Both rendered as one "Unknown" bar until 2026-09-06, so a chart of *listening* was silently
 * reporting the *app's uptime* — completion read as 38% overall where it was **74% on the days the
 * instrument was actually watching**.
 *
 * - `Inconclusive` — the app was watching and could not classify: a pause, a stop, a shutdown
 *   mid-track. A real measurement that happens to be indeterminate, so it is drawn, in a real hue.
 * - `Not recorded` — the app was off. From `recently-played`, which reports no progress at all, so
 *   there is no trail and there never can be. **Not drawn** — see {@link NOT_OBSERVED}.
 */
const DRAWN_SERIES = [
  { key: 'completed', label: 'Completed', fill: 'var(--series-completed)' },
  // ⚠️ `Skipped` means a rejection again, and there is no longer a fourth series beside it.
  // An `Ended early` series existed from 2026-09-21 to 2026-09-22, drawn separately because v1's
  // outcome counted transitions as rejections -- 24 of 46 live skips were tracks that played to
  // 81-90% and were then replaced by something the listener did not choose.
  //
  // Those turned out to be COMPLETIONS: the API had stopped reporting the track while it was
  // still playing (probed 2026-09-22, DJ context only). Classifier v2 records them as
  // `completed`, so the series had nothing left to draw. Do not reinstate a display-layer split
  // -- the correction lives in the outcome now.
  { key: 'skipped', label: 'Skipped', fill: 'var(--series-skipped)' },
  { key: 'inconclusive', label: 'Inconclusive', fill: 'var(--series-inconclusive)' },
];

/**
 * ⚠️ **Counted everywhere, drawn nowhere — and the distinction is the whole point.**
 *
 * `not-observed` was a fourth bar until 2026-09-06. On this corpus that is 84 of 187 plays across
 * seven days the app never ran, so every artist's chart was dominated by columns that record the
 * *instrument's downtime* rather than any listening — the user's report was that the trend is
 * unreadable, and it was.
 *
 * It is removed from the **plot** only. It stays in the legend note, the hover tooltip, the table
 * and the track panel's breakdown, because deleting it from those would be the 2026-09-06 defect
 * again in a quieter form: a reader would take `Times played 6 · 1 completed` for six observed
 * listens. The chart answers "what did the app measure"; the numbers beside it still answer "and
 * how much did it miss". R2 depends on the second question staying askable.
 *
 * The rows themselves are never deleted. They are 73 distinct tracks over seven days that
 * `recently-played` cannot return again — its window is 50 plays — so they are the one thing here
 * that does not come back.
 */
const NOT_OBSERVED = { key: 'not-observed', label: 'Not recorded' };

/** Every bucket, for the surfaces that report rather than draw. */
const ALL_BUCKETS = [...DRAWN_SERIES, NOT_OBSERVED];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-17` -> `17 Aug`. The server bucketed on UTC, so the parts are read, never re-parsed. */
function formatWeek(isoDate) {
  const parts = isoDate.slice(0, 10).split('-');
  return `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1]}`;
}

/**
 * ⚠️ `timeZone` is REQUIRED for correctness on an instant, and optional only so this stays total.
 *
 * Slicing the ISO string yields the UTC date. Since 2026-09-22 every bucket on this page is
 * computed in the report zone, and 63% of this corpus's plays fall between 23:00Z and 04:00Z --
 * the previous local evening. So a sliced date sitting next to a locally-bucketed chart is wrong
 * by a day for half the plays, and the two disagree with nothing on screen explaining why.
 *
 * Without a zone it falls back to the old slice rather than to the BROWSER's zone: browser-local
 * is usually right on a single-user machine, which is precisely what would make a wrong answer
 * survive. A visibly-UTC date is better than an invisibly-assumed one.
 */
function formatDay(iso, timeZone) {
  if (!iso) return DASH;
  if (timeZone) {
    try {
      const parts = {};
      for (const part of new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date(iso))) {
        if (part.type !== 'literal') parts[part.type] = part.value;
      }
      return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
    } catch {
      // An unknown zone or an unparseable instant: fall through to the slice rather than throwing
      // inside a render.
    }
  }
  const parts = iso.slice(0, 10).split('-');
  return `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1]} ${parts[0]}`;
}

/** Rounded at the data end, square at the baseline — the top segment of a stack only. */
function topRoundedPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  return (
    `M${x} ${y + height}` +
    `L${x} ${y + r}Q${x} ${y} ${x + r} ${y}` +
    `L${x + width - r} ${y}Q${x + width} ${y} ${x + width} ${y + r}` +
    `L${x + width} ${y + height}Z`
  );
}

const VB_WIDTH = 520;
const PLOT_HEIGHT = 96;
const PLOT_TOP = 8;
const AXIS_HEIGHT = 18;
/** Surface gap: 2px of background separates touching marks, stacked and adjacent alike. */
const GAP = 2;

function trendSvg(weeks, maxTotal) {
  const step = VB_WIDTH / weeks.length;
  const barWidth = Math.max(3, Math.min(24, step - GAP));
  const baseline = PLOT_TOP + PLOT_HEIGHT;
  const parts = [];

  // Recessive hairlines: the baseline, and one gridline carrying the only y label.
  parts.push(
    `<line class="grid" x1="0" y1="${baseline}" x2="${VB_WIDTH}" y2="${baseline}" />`,
    `<line class="grid" x1="0" y1="${PLOT_TOP}" x2="${VB_WIDTH}" y2="${PLOT_TOP}" opacity="0.6" />`,
    `<text class="axis-text" x="0" y="${PLOT_TOP - 3}">${maxTotal}</text>`,
  );

  // The x axis is labelled by month once the window is long enough to have months in it, and by
  // week date while it is not. A young corpus is entirely within one month, and an axis whose
  // every tick reads "Aug" tells the reader nothing at all.
  const spansMonths = new Set(weeks.map((week) => week.weekStart.slice(0, 7))).size > 2;
  let lastLabelledAt = -99;
  let lastMonth = null;

  weeks.forEach((week, index) => {
    const x = index * step + (step - barWidth) / 2;

    // Lay the stack out on the true scale first, so the surface gaps come out of the segments
    // rather than being added to the column — a gap that lengthened the bar would overstate
    // every multi-outcome week by 2px per boundary.
    const drawn = [];
    let cumulative = 0;
    for (const series of DRAWN_SERIES) {
      const value = week.byBucket[series.key] ?? 0;
      if (value === 0) continue;
      const yBottom = baseline - (cumulative / maxTotal) * PLOT_HEIGHT;
      cumulative += value;
      const yTop = baseline - (cumulative / maxTotal) * PLOT_HEIGHT;
      drawn.push({ series, yTop, yBottom });
    }

    const marks = drawn.map((segment, position) => {
      const isTop = position === drawn.length - 1;
      // The gap is taken off the top of the lower segment, so the boundary moves, not the total.
      const top = isTop ? segment.yTop : segment.yTop + GAP;
      // A single play in a busy week rounds to well under a pixel, and an invisible 1 reads as
      // a 0. Two pixels is the floor at which a mark exists at all.
      const height = Math.max(2, segment.yBottom - top);
      const y = segment.yBottom - height;
      const style = `style="fill:${segment.series.fill}"`;
      return isTop
        ? `<path d="${topRoundedPath(x, y, barWidth, height, 4)}" ${style} />`
        : `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" ${style} />`;
    });

    // The hit target is the whole column, not the mark: a one-play bar is 2px tall and would
    // otherwise be unhoverable.
    parts.push(
      `<g class="week" data-index="${index}">` +
        `<rect class="hit" x="${index * step}" y="${PLOT_TOP}" width="${step}" ` +
        `height="${PLOT_HEIGHT}" rx="3" />` +
        marks.join('') +
        `</g>`,
    );

    // Ticks are selective by design — 26 dates would be unreadable and go unread. The ends are
    // always labelled, because the span of the axis is the one thing the reader must not guess.
    const month = week.weekStart.slice(5, 7);
    const isLast = index === weeks.length - 1;
    const isEnd = index === 0 || isLast;
    const wantsMonthTick = spansMonths && month !== lastMonth && index - lastLabelledAt >= 3;

    if (isEnd || (wantsMonthTick && index < weeks.length - 3)) {
      const text = isEnd || !spansMonths ? formatWeek(week.weekStart) : MONTHS[Number(month) - 1];
      const anchor = isLast ? ` text-anchor="end"` : '';
      const x = isLast ? VB_WIDTH : index * step;
      parts.push(
        `<text class="axis-text" x="${x}" y="${baseline + 12}"${anchor}>${text}</text>`,
      );
      lastLabelledAt = index;
    }
    lastMonth = month;
  });

  return (
    `<svg viewBox="0 0 ${VB_WIDTH} ${PLOT_TOP + PLOT_HEIGHT + AXIS_HEIGHT}" ` +
    `role="img" aria-label="Weekly counts of observed plays by outcome. Values, including plays ` +
    `the app did not observe, are in the table view below.">` +
    parts.join('') +
    `</svg>`
  );
}

function renderLegend(totals) {
  ui.trendLegend.replaceChildren(
    ...DRAWN_SERIES.map((series) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = series.fill;
      const label = document.createElement('span');
      label.textContent = series.label;
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = totals[series.key];
      item.append(swatch, label, count);
      return item;
    }),
  );
}

function renderTrendTable(weeks, totals) {
  const active = weeks.filter((week) => week.total > 0);
  if (active.length === 0) {
    ui.trendTableBody.replaceChildren(muted('No plays in this window.'));
    return;
  }

  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const heading of [
    'Week of',
    'Completed',
    'Skipped',
    'Inconcl.',
    'Not rec.',
    'Total',
  ]) {
    const cell = document.createElement('th');
    cell.textContent = heading;
    head.append(cell);
  }

  const body = table.createTBody();
  for (const week of active) {
    const row = body.insertRow();
    const first = document.createElement('th');
    first.textContent = formatWeek(week.weekStart);
    row.append(first);
    for (const value of [
      week.byBucket.completed,
      week.byBucket.skipped,
      week.byBucket.inconclusive,
      week.byBucket['not-observed'],
      week.total,
    ]) {
      row.insertCell().textContent = value;
    }
  }

  const foot = table.createTFoot().insertRow();
  const label = document.createElement('th');
  label.textContent = 'Total';
  foot.append(label);
  const grand = ALL_BUCKETS.reduce((sum, series) => sum + totals[series.key], 0);
  for (const value of [
    totals.completed,
    totals.skipped,
    totals.inconclusive,
    totals['not-observed'],
    grand,
  ]) {
    foot.insertCell().textContent = value;
  }

  ui.trendTableBody.replaceChildren(table);
}

function attachTrendTooltip(weeks) {
  const tip = document.createElement('div');
  tip.className = 'trend-tip';
  tip.hidden = true;
  ui.trendPlot.append(tip);

  const show = (index, event) => {
    const week = weeks[index];
    if (!week) return;
    tip.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'tip-week';
    heading.textContent = `Week of ${formatWeek(week.weekStart)}`;
    tip.append(heading);
    for (const series of DRAWN_SERIES) {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const name = document.createElement('span');
      name.textContent = series.label;
      const value = document.createElement('span');
      value.textContent = week.byBucket[series.key];
      row.append(name, value);
      tip.append(row);
    }

    // Reported on hover even though it is not drawn: a week whose column is short because most
    // of it went unobserved must not read as a quiet week.
    const missed = week.byBucket[NOT_OBSERVED.key] ?? 0;
    if (missed > 0) {
      const row = document.createElement('div');
      row.className = 'tip-row muted';
      const name = document.createElement('span');
      name.textContent = NOT_OBSERVED.label;
      const value = document.createElement('span');
      value.textContent = missed;
      row.append(name, value);
      tip.append(row);
    }
    tip.hidden = false;

    const bounds = ui.trendPlot.getBoundingClientRect();
    const left = Math.min(
      Math.max(0, event.clientX - bounds.left - tip.offsetWidth / 2),
      Math.max(0, bounds.width - tip.offsetWidth),
    );
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, event.clientY - bounds.top - tip.offsetHeight - 10)}px`;
  };

  for (const group of ui.trendPlot.querySelectorAll('.week')) {
    const index = Number(group.dataset.index);
    group.addEventListener('mousemove', (event) => show(index, event));
    group.addEventListener('mouseleave', () => {
      tip.hidden = true;
    });
  }
}

function renderTrend(artist, artistName) {
  if (!artist) {
    ui.trendTitle.textContent = 'Weekly plays';
    ui.trendSpan.textContent = DASH;
    ui.trendPlot.replaceChildren(muted('No artist id for this track.'));
    ui.trendLegend.replaceChildren();
    ui.trendNote.textContent = '';
    ui.trendTableBody.replaceChildren();
    return;
  }

  const heading = document.createElement('span');
  heading.textContent = `Weekly plays · ${artistName ?? 'this artist'}`;
  const qualifier = document.createElement('span');
  qualifier.className = 'muted';
  // Said every time, not once in a footnote: the number is a known undercount for any artist
  // who guests on other people's tracks, and a chart that hides that is worse than no chart.
  qualifier.textContent = ' (as primary artist)';
  ui.trendTitle.replaceChildren(heading, qualifier);

  ui.trendSpan.textContent = artist.window.capped
    ? 'last 26 weeks'
    : `all history, from ${formatWeek(artist.window.start)}`;

  const totals = { completed: 0, skipped: 0, inconclusive: 0, 'not-observed': 0 };
  // ⚠️ Two maxima, and using the wrong one is the trap. `week.total` counts plays the chart no
  // longer draws, so scaling to it would shrink every bar against an axis whose height comes from
  // columns that are not there -- a week of 8 observed plays would read as a third of a week that
  // was 24 unobserved. The axis measures what is drawn.
  let drawnMax = 0;
  let anyPlays = 0;
  for (const week of artist.weeks) {
    for (const key of Object.keys(totals)) totals[key] += week.byBucket[key] ?? 0;
    const drawn = DRAWN_SERIES.reduce((sum, series) => sum + (week.byBucket[series.key] ?? 0), 0);
    if (drawn > drawnMax) drawnMax = drawn;
    anyPlays += week.total;
  }

  if (anyPlays === 0) {
    ui.trendPlot.replaceChildren(muted('First time hearing this artist.'));
    ui.trendLegend.replaceChildren();
    ui.trendNote.textContent = '';
    ui.trendTableBody.replaceChildren();
    return;
  }

  // ⚠️ Distinct from the line above, and it has to be. "Never heard this artist" and "heard them
  // and watched none of it" are different facts, and an empty plot asserts neither on its own --
  // the same mistake `Label detail` made by rendering a bare dash until someone nearly deleted it
  // as broken.
  if (drawnMax === 0) {
    ui.trendPlot.replaceChildren(
      muted(`${anyPlays} ${anyPlays === 1 ? 'play' : 'plays'}, none observed — the app was not running.`),
    );
    ui.trendLegend.replaceChildren();
    // Not `renderTrendNote` — it would print the same sentence a second line down. The plot has
    // said it; the table below still carries the per-week counts.
    ui.trendNote.textContent = '';
    renderTrendTable(artist.weeks, totals);
    return;
  }

  // The SVG carries no user-supplied text — only week dates and integers — so building it as
  // markup is safe here. Everything with a name in it goes through textContent above.
  ui.trendPlot.innerHTML = trendSvg(artist.weeks, drawnMax);
  attachTrendTooltip(artist.weeks);
  renderLegend(totals);
  renderTrendNote(totals);
  renderTrendTable(artist.weeks, totals);
}

/**
 * The plays this window holds that the app never watched.
 *
 * Stated as a number rather than drawn as a bar. Silence here would be the dishonest option: a
 * chart covering seven days the app was off, saying nothing about them, invites the reader to
 * take the bars for the whole story.
 */
function renderTrendNote(totals) {
  const missed = totals[NOT_OBSERVED.key] ?? 0;
  ui.trendNote.textContent =
    missed === 0
      ? ''
      : `${missed} ${missed === 1 ? 'play' : 'plays'} not observed — the app was not running.`;
}

let statsKey = null;
let statsAbort = null;
let statsSettleTimer = null;

/**
 * Reset the panel when playback stops.
 *
 * `statsKey` is cleared too, so resuming the *same* track refetches rather than being deduped
 * against the key from before the pause — by then the play may well have been recorded.
 */
function clearStats() {
  statsKey = null;
  statsAbort?.abort();
  clearTimeout(statsSettleTimer);
  ui.stats.dataset.state = 'loading';
  ui.statPlays.textContent = DASH;
  ui.statFirst.textContent = DASH;
  renderTrend(null, null);
}

function renderStats(payload, artistName) {
  ui.stats.dataset.state = 'ready';
  const track = payload.track;
  if (track === null) {
    ui.statPlays.textContent = DASH;
    ui.statFirst.textContent = DASH;
  } else {
    // The breakdown rides the count, because the count alone invites the same misreading the
    // chart used to: six plays of which five predate the app is not six observed listens.
    const parts = ALL_BUCKETS.filter((series) => track.byBucket[series.key] > 0).map(
      (series) => `${track.byBucket[series.key]} ${series.label.toLowerCase()}`,
    );
    ui.statPlays.textContent = parts.length
      ? `${track.totalPlays} · ${parts.join(', ')}`
      : String(track.totalPlays);
    ui.statFirst.textContent = formatDay(track.firstPlayedAt, payload.timeZone);
  }
  renderTrend(payload.artist, artistName);
}

/**
 * Fetch statistics for a track, once per (track, artist) pair.
 *
 * `render` runs on every push — every three seconds — so this must not turn the panel into a
 * poller. The key is the pair rather than the track alone because enrichment lands a beat after
 * the track, and `primaryArtistId` is null on that first push.
 *
 * ⚠️ **The settle pass is not belt-and-braces.** The previous play is written by `PlayObserver`
 * on the same track change that triggers this, so an immediate read can beat the write and
 * report a count one too low — most visibly when a track repeats, where the panel would then
 * sit on the stale number for the whole play. The second read happens once the write has landed.
 */
function refreshStats(trackId, artistId, artistName) {
  if (trackId === null) return;
  const key = `${trackId}|${artistId ?? ''}`;
  if (key === statsKey) return;
  statsKey = key;

  const load = async () => {
    statsAbort?.abort();
    const controller = new AbortController();
    statsAbort = controller;

    const params = new URLSearchParams({ trackId });
    if (artistId) params.set('artistId', artistId);

    try {
      const response = await fetch(`/api/history/stats?${params}`, { signal: controller.signal });
      if (!response.ok) {
        // History being unavailable is a degraded state, not an error state: the display above
        // is unaffected, so the panel says so quietly rather than colouring the whole card.
        ui.stats.dataset.state = 'unavailable';
        ui.statPlays.textContent = DASH;
        ui.statFirst.textContent = DASH;
        return;
      }
      renderStats(await response.json(), artistName);
    } catch {
      if (controller.signal.aborted) return;
      ui.stats.dataset.state = 'unavailable';
    }
  };

  load();
  clearTimeout(statsSettleTimer);
  statsSettleTimer = setTimeout(() => {
    if (statsKey === key) load();
  }, 6000);
}

// -- U4: status bar, rules panel, decision log ------------------------------
//
// ⚠️ DOM WIRING ONLY. Every judgement about what an indicator MEANS is made in
// `src/ui/statusBar.ts`, which is tested, and arrives here pre-derived on the snapshot.
// This file has no tests and is outside the orphan check; a false green would come from
// exactly that judgement, and it matters most on Recording, where green says "your listening
// is being saved" about the one artefact that cannot be regenerated.
//
// ⚠️ The Connection dot is the one exception, because its input is this browser's own socket
// state and no server can know it. That is the safe one to except: its failure mode is
// VISIBLE — a page that has stopped updating is apparent on screen — whereas a Recording dot
// that is wrongly green looks exactly like one that is rightly green.

const CONNECTION_GLYPH = { ok: '●', warn: '◐', fail: '✕', unknown: '○' };


let connectionState = null;
let lastServerStatus = null;
let openDetail = null;

function connectionIndicatorView() {
  switch (connectionState) {
    case 'open':
      return { level: 'ok', label: 'Connected', detail: 'Live updates are arriving.' };
    case 'reconnecting':
      return {
        level: 'warn',
        label: 'Reconnecting',
        detail: 'The live connection dropped and is retrying.',
      };
    case 'closed':
      return {
        level: 'fail',
        label: 'Disconnected',
        detail: 'No live connection. The page is not updating.',
      };
    // U11 (BR-93.3, frontend-components §3): the session ended. Text, not only colour; reconnecting has stopped.
    case 'signedOut':
      return {
        level: 'fail',
        label: 'Signed out',
        detail: 'Your sign-in has ended. Sign in again to see live updates.',
      };
    default:
      return { level: 'unknown', label: 'Connection', detail: 'Not yet attempted.' };
  }
}

function renderStatusBar() {
  const dots = el('statusbar-dots');
  if (!dots) return;

  const server = lastServerStatus;
  const indicators = [
    server?.recording ?? { level: 'unknown', label: 'Recording', detail: 'No status yet.' },
    server?.rules ?? { level: 'unknown', label: 'Rules', detail: 'No status yet.' },
    connectionIndicatorView(),
    server?.spotify ?? { level: 'unknown', label: 'Spotify', detail: 'No snapshot yet.' },
    // FC-U5-1 (U5). ⚠️ Omitted entirely when the server does not send it, rather than drawn as
    // `unknown`: a deployment without U5 has no automation to be unknown about.
    ...(server?.automation ? [server.automation] : []),
    // U10 (BR-86.5): the Status light, always sent; its detail ends "Check the Diagnostics page." at warn/fail.
    ...(server?.health ? [server.health] : []),
    // U10 (BR-86.3): only when a newer version exists.
    ...(server?.update ? [server.update] : []),
  ];

  dots.replaceChildren();
  for (const indicator of indicators) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-dot';
    button.dataset.level = indicator.level;
    // Named for screen readers: the glyph alone says nothing out loud.
    button.setAttribute(
      'aria-label',
      `${indicator.label}: ${indicator.level}. ${indicator.detail}`,
    );

    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = indicator.glyph ?? CONNECTION_GLYPH[indicator.level];
    glyph.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = indicator.label;

    button.append(glyph, text);
    button.addEventListener('click', () => {
      openDetail = openDetail === indicator.label ? null : indicator.label;
      renderStatusBar();
    });
    dots.append(button);

    if (openDetail === indicator.label) {
      const detail = document.createElement('p');
      detail.className = 'status-detail';
      detail.textContent = indicator.detail;
      dots.append(detail);
    }
  }
  // Owner, 2026-10-23: NO persistent message under the bar. A detail appears only while its indicator is clicked.
}

function setConnectionState(state) {
  connectionState = state;
  renderStatusBar();
}

// -- FC-2: the rules panel ---------------------------------------------------

async function loadRules() {
  const body = el('rules-body');
  if (!body) return;

  try {
    const response = await fetch('/api/rules');
    if (!response.ok) {
      // ⚠️ An empty state that does not explain itself gets read as broken, or removed by
      // someone who assumes it is. `Label detail` rendered a bare dash and was nearly deleted.
      body.replaceChildren(muted('The rules engine is not running, so there is nothing to show.'));
      return;
    }

    const data = await response.json();
    body.replaceChildren();

    const head = document.createElement('p');
    head.className = 'muted';
    head.textContent =
      data.version === 0
        ? 'No rules file has been loaded yet.'
        : `Version ${data.version} · ${data.state} · loaded ${formatDay(data.loadedAt)}`;
    body.append(head);

    // ⚠️ Red names the version STILL IN FORCE. A light that only says "something failed"
    // leaves exactly the ambiguity it exists to remove, and a silent last-known-good is
    // indistinguishable from a successful reload.
    if (data.rejection) {
      const warn = document.createElement('p');
      warn.className = 'rule-reason';
      warn.textContent =
        `A newer file was rejected: ${data.rejection.errors.join('; ')} ` +
        `Still running v${data.version}.`;
      body.append(warn);
    }

    if (data.rules.length === 0) {
      body.append(muted('This rule set is empty — no rules are being evaluated.'));
      return;
    }

    for (const rule of data.rules) {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const name = document.createElement('div');
      name.className = 'rule-name';
      name.textContent = rule.name;
      row.append(name);

      const flags = document.createElement('div');
      flags.className = 'rule-flags';
      const add = (text, kind) => {
        const flag = document.createElement('span');
        flag.className = 'rule-flag';
        if (kind) flag.dataset.kind = kind;
        flag.textContent = text;
        flags.append(flag);
      };
      add(rule.action);
      add(`on unknown: ${rule.onUnknown}`);
      if (!rule.enabled) add('switched off', 'disabled');
      if (rule.status.state === 'disabled') add('disabled', 'disabled');
      // In U4 every decision is dry-run anyway; the flag is shown when the rule asks for it.
      if (rule.dryRun) add('dry run', 'dry-run');
      row.append(flags);

      // ⚠️ A disabled rule must say WHY, in words. A rule that silently does nothing is
      // indistinguishable from a rule that does not match — and `onUnknown: 'hold'` is
      // disabled by design until U5, which is exactly what someone would read as broken.
      if (rule.status.state === 'disabled') {
        const reason = document.createElement('p');
        reason.className = 'rule-reason';
        reason.textContent = `Disabled (${rule.status.reason}): ${rule.status.detail}`;
        row.append(reason);
      }

      body.append(row);
    }
  } catch (error) {
    body.replaceChildren(muted(`Could not load the rule set: ${error.message}`));
  }
}

// -- FC-3: the decision log --------------------------------------------------

async function loadDecisions() {
  const body = el('decisions-body');
  if (!body) return;

  const matchedOnly = el('decisions-matched-only')?.checked ?? false;

  try {
    const response = await fetch(`/api/decisions?limit=60${matchedOnly ? '&matchedOnly=true' : ''}`);
    if (!response.ok) {
      body.replaceChildren(muted('The decision log is unavailable.'));
      return;
    }

    const data = await response.json();
    body.replaceChildren();

    if (data.traces.length === 0) {
      // ⚠️ Two different empty states, because they mean different things and the fix differs.
      body.append(
        muted(
          matchedOnly
            ? 'No matches recorded. Rules have run; none of them matched.'
            : 'No decisions recorded yet — either no rules are active, or nothing has played ' +
              'for long enough since the last restart.',
        ),
      );
      return;
    }

    for (const trace of data.traces) {
      const wrap = document.createElement('div');
      wrap.className = 'decision';

      const head = document.createElement('div');
      head.className = 'decision-head';
      const when = document.createElement('strong');
      when.textContent = formatDay(trace.decidedAt);
      head.append(when);

      // The track, between the date and the enrichment status.
      //
      // ⚠️ Derived server-side: `decision_log` has no title column, so the repository looks it up
      // from the most recent `play` row for this `track_id`. Keyed on track_id rather than play_id
      // because play_id is null while the play is still OPEN -- which is the row a reader of a LIVE
      // log is most likely looking at.
      //
      // ⚠️ `null` is not a missing field and must not render blank: no play row carries this
      // track_id yet, which means this is the FIRST time the track has been heard. Same family as
      // the `Label detail` dash -- an empty state that does not explain itself gets read as broken.
      const track = document.createElement('span');
      track.className = 'decision-track';
      if (trace.title) {
        track.textContent = trace.title;
      } else {
        track.classList.add('muted');
        track.textContent = 'first play of this track';
        track.title = `No completed play recorded for ${trace.trackId} yet, so there is no title to show.`;
      }
      head.append(track);

      // ⚠️ `partialData` means THE WAIT TIMED OUT, not "a field read null" (FQ3). It is the
      // measurement that says whether ENRICHMENT_WAIT_MS is right, so it is on screen.
      const trigger = document.createElement('span');
      trigger.className = 'decision-trigger';
      trigger.textContent =
        trace.trigger.kind === 'deadline'
          ? 'decided before enrichment finished'
          : 'enrichment settled first';
      head.append(trigger);
      wrap.append(head);

      for (const rule of trace.rules) {
        const line = document.createElement('div');
        line.className = 'decision-head';

        const name = document.createElement('span');
        name.textContent = rule.ruleName;

        const verdict = document.createElement('span');
        verdict.className = 'verdict';
        verdict.dataset.v = rule.verdict;
        verdict.textContent = rule.verdict;

        const matched = document.createElement('span');
        matched.className = 'decision-trigger';
        matched.textContent = rule.matched ? 'matched' : 'did not match';

        line.append(name, verdict, matched);
        if (rule.restedOnUnknown) {
          const rested = document.createElement('span');
          rested.className = 'decision-trigger';
          rested.textContent = 'rested on unknown';
          line.append(rested);
        }
        wrap.append(line);

        const details = document.createElement('details');
        details.className = 'decision-fields';
        const summary = document.createElement('summary');
        summary.textContent = `${rule.fields.length} field(s) read`;
        details.append(summary);

        for (const field of rule.fields) {
          const row = document.createElement('div');
          row.className = 'field-row';
          const key = document.createElement('span');
          key.textContent = field.name;
          const value = document.createElement('span');
          // ⚠️ Never blank and never `false`. A blank cell hides a bias instead of showing
          // it, and missing data here correlates with what is being measured (R2).
          if (field.wasUnknown) value.className = 'unknown';
          value.textContent = field.display;
          row.append(key, value);
          details.append(row);
        }

        wrap.append(details);
      }

      body.append(wrap);
    }
  } catch (error) {
    body.replaceChildren(muted(`Could not load the decision log: ${error.message}`));
  }
}

// -- FC-U5-2 / FC-U5-3: the kill switch and the halt acknowledgement ---------
//
// ⚠️ DOM WIRING ONLY, and here that is not a style preference but the defence against the
// documented worst case for this control: *a kill switch that works in the UI and does not persist*.
// Every label, every `disabled`, every warning below is computed by `src/ui/automationPanel.ts`,
// which is pure and tested, and arrives on the response as `view` and `haltPanel`.
//
// ⚠️ **Nothing here keeps optimistic state.** After any write, the panel re-renders from the
// RESPONSE BODY, which the server read back from disk. There is no local `enabled` variable to get
// out of step with the file -- which is what would make the button flip while a restart silently
// re-armed automation.

/** The last payload, so a failed write can re-render without a second request. */
let lastAutomation = null;

/** The automation level the Rules panel was last rendered against. ⚠️ See `refreshAutomationIfStale`. */
let renderedAutomationLevel = null;

/**
 * Re-read `/api/automation` when the panel has gone stale, while the Rules pop-up is OPEN.
 *
 * ## ⚠️ The bug this fixes: two surfaces contradicting each other
 *
 * `loadAutomation()` ran only from the dialog's open handler, so a halt that latched **while the pop-up
 * was already open** never reached it. Observed 2026-10-05: the status bar read `Automation HALTED` while
 * the panel still showed `Turn automation off` and *"Rules that match will skip the track."*
 *
 * ⚠️ **That is worse than a missing alert.** The panel was not merely out of date, it was asserting the
 * opposite of the truth — rules would NOT skip, the halt guaranteed it — and offering a switch that is
 * meant to be suppressed while halted. A stale control that states a false fact is exactly what this
 * component exists to prevent, and it reappeared one layer up.
 *
 * ## Driven by the snapshot, not a timer
 *
 * The WebSocket snapshot already carries the pre-derived automation indicator every 3 s, so the change is
 * an event we already receive — no new polling, and no new WebSocket surface (Infrastructure Q6).
 *
 * ⚠️ **Only on a LEVEL CHANGE, deliberately not on every snapshot.** `loadAutomation()` replaces the
 * panel's DOM children, which would move focus out from under someone reaching for a button if it ran
 * every 3 s. The level encodes every state that changes what the panel renders: halted, disabled, idle,
 * hold, decided, and the unconfirmed-skip failure.
 *
 * ⚠️ Known limit: a change that does NOT move the level — `/state` becoming unwritable, say — leaves the
 * panel's warning stale until it is reopened. That is reported on `/api/diagnostics`, and it is not worth
 * re-rendering under the user's cursor for.
 */
function refreshAutomationIfStale(indicator) {
  const level = indicator?.level ?? null;
  if (level === renderedAutomationLevel) return;
  renderedAutomationLevel = level;

  // Closed: the open handler will load it fresh, so there is nothing to refresh.
  if (!el('rules')?.open) return;
  void loadAutomation();
}

async function loadAutomation() {
  const section = el('automation-section');
  const body = el('automation-body');
  if (!section || !body) return;

  try {
    const response = await fetch('/api/automation');
    if (response.status === 503) {
      // U5 is not deployed. ⚠️ Hide the section rather than showing an empty one: an empty state that
      // does not explain itself gets read as broken, and this one has nothing to explain.
      section.hidden = true;
      return;
    }
    lastAutomation = await response.json();
  } catch (error) {
    section.hidden = false;
    body.replaceChildren(muted(`Could not read the automation state: ${error.message}`));
    return;
  }

  section.hidden = false;
  renderAutomation();
}

function renderAutomation() {
  const body = el('automation-body');
  const data = lastAutomation;
  if (!body || !data) return;

  // ⚠️ Keep the staleness marker in step with what is on screen. Without this, a change the user made
  // THEMSELVES (acknowledging, or throwing the switch) would arrive on the next snapshot as a level
  // change and trigger a redundant re-render a moment after their click.
  renderedAutomationLevel = lastServerStatus?.automation?.level ?? renderedAutomationLevel;

  const view = data.view;
  const children = [];

  const row = document.createElement('div');
  row.className = 'automation-row';

  // ⚠️ **ONE CONTROL AT A TIME.** While halted the server returns `rendered: false` and the halt panel
  // below owns the only available action. Showing the switch as well is what made recovery a state
  // machine -- and it read "Turn automation off" while the halt already guaranteed nothing was skipped.
  if (view.rendered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'automation-switch';
    button.dataset.testid = 'automation-switch';
    // ⚠️ Every one of these comes from the server's derived view. None is decided here.
    button.textContent = view.label;
    button.disabled = view.disabled;
    button.dataset.on = String(view.on);
    button.setAttribute('aria-pressed', String(view.on));
    if (view.nextEnabled !== null) {
      button.addEventListener('click', () => void setAutomation(view.nextEnabled));
    }
    row.append(button);
  }

  const explanation = document.createElement('span');
  explanation.className = 'muted';
  explanation.textContent = view.explanation;
  row.append(explanation);

  children.push(row);

  if (view.warning) {
    const warning = document.createElement('p');
    warning.className = 'automation-warning';
    warning.dataset.testid = 'automation-warning';
    warning.textContent = view.warning;
    children.push(warning);
  }

  // FC-U5-3. ⚠️ Absent when nothing is halted, rather than an empty box.
  if (data.haltPanel) children.push(haltPanelView(data.haltPanel));

  body.replaceChildren(...children);
}

function haltPanelView(panel) {
  const box = document.createElement('div');
  box.className = 'automation-halt';
  box.dataset.testid = 'automation-halt';

  const heading = document.createElement('h4');
  heading.textContent = panel.heading;

  const detail = document.createElement('p');
  detail.textContent = panel.detail;

  // ⚠️ The attempt ids, or the note saying they are missing. `attemptsNote` carries both cases, and
  // an empty list is a DEFECT REPORT rather than an empty state -- BR-35.8 requires this surface to
  // say which rule-skips counted.
  const attempts = document.createElement('p');
  attempts.className = 'muted';
  attempts.textContent = panel.attemptsNote;

  // ⚠️ **ONE button.** It clears the halt AND leaves automation off, and its label says both.
  //
  // FC-U5-3 originally specified two -- "I have reviewed this" and "turn automation back on" -- to keep
  // acknowledging distinct from resuming (BR-35.5). The distinction is right and the mechanism was
  // wrong: three controls on screen at once made a linear recovery combinatorial. Sequencing the two
  // acts separates them more strictly than juxtaposing them, because resuming now cannot happen in the
  // same click.
  const actions = document.createElement('div');
  actions.className = 'automation-halt-actions';

  const acknowledge = document.createElement('button');
  acknowledge.type = 'button';
  acknowledge.className = 'automation-switch';
  acknowledge.dataset.testid = 'automation-acknowledge';
  acknowledge.textContent = panel.acknowledgeLabel;
  acknowledge.addEventListener('click', () => void acknowledgeHalt());

  actions.append(acknowledge);
  box.append(heading, detail, attempts, actions);
  return box;
}

/**
 * ⚠️ Re-renders from the RESPONSE, on success and on failure alike.
 *
 * A 503 still carries the full payload, with the state read back from disk and `writeError` set. So
 * the failure path and the success path are the same path -- which is why there is no branch here
 * that could leave the button saying something the file does not.
 */
async function setAutomation(enabled) {
  await postAutomation('/api/automation', { enabled });
}

/**
 * ⚠️ No parameter. Acknowledging always leaves automation OFF; resuming is the ordinary switch, which
 * reappears once the halt is cleared. The route rejects `reArm` outright rather than ignoring it.
 */
async function acknowledgeHalt() {
  await postAutomation('/api/automation/acknowledge-halt', {});
}

async function postAutomation(path, payload) {
  const body = el('automation-body');
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    // ⚠️ A 409 (arming while halted, or acknowledging nothing) carries the real state but no `view`,
    // so re-read rather than render a partial body.
    if (data.view) {
      lastAutomation = data;
      renderAutomation();
    } else {
      await loadAutomation();
    }
  } catch (error) {
    if (body) body.append(muted(`The change could not be sent: ${error.message}`));
  }
}

// -- U7: the rules file (FR-66–FR-68) and credentials (FR-69, FR-70) --------
//
// ⚠️ This only RENDERS. Every label, disabled reason, comparison line, warning and guidance sentence comes from
// the server (`view`), derived by src/ui/rulesFilePanel.ts and src/ui/credentialsPanel.ts — app.js has no tests.

/** One rendering of a rules comparison, for the Rules pop-up (`rules`) and the restore dialog (`restore-rules`). */
function renderComparisonPanel(prefix, panel) {
  el(prefix === 'rules' ? 'rules-compare-heading' : 'restore-rules-heading').textContent = panel.heading;
  const live = el(prefix === 'rules' ? 'rules-live-warning' : 'restore-rules-live');
  live.replaceChildren(...panel.liveWarning.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  live.hidden = panel.liveWarning.length === 0;
  const sections = el(prefix === 'rules' ? 'rules-compare-sections' : 'restore-rules-sections');
  sections.replaceChildren(
    ...panel.sections.map((section) => {
      const wrap = document.createElement('div');
      wrap.className = 'rules-compare-section';
      const h = document.createElement('p');
      h.className = 'muted';
      h.textContent = section.title;
      const ul = document.createElement('ul');
      ul.append(...section.items.map((item) => Object.assign(document.createElement('li'), { textContent: item })));
      wrap.append(h, ul);
      return wrap;
    }),
  );
  if (prefix === 'restore-rules') el('restore-rules-panel').hidden = true;
}

el('restore-apply-rules').addEventListener('change', () => {
  // The comparison is shown only once the user opts in — it is the consequence of ticking, stated beside the box.
  el('restore-rules-panel').hidden = !el('restore-apply-rules').checked;
});

let rulesToken = null;
let rulesWord = 'REPLACE';
let rulesWordNeeded = false;
/**
 * BR-54.2's base: the hash of the version THIS PAGE last DOWNLOADED. ⚠️ Not the version merely displayed — an old
 * file uploaded after just opening the pop-up would then pass as current. No download this session → unknown, and
 * the server requires the typed word instead (BR-54.4).
 */
let rulesBaseHash = null;

function rulesFileMessage(text) {
  const m = el('rules-file-message');
  m.textContent = text ?? '';
  m.hidden = !text;
}

async function refreshRulesFile() {
  try {
    const r = await fetch('/api/rules/file/status');
    const body = await r.json();
    if (!r.ok) {
      el('rules-file-section').hidden = true;
      return;
    }
    const v = body.view;
    renderButton(el('rules-download'), v.download);
    renderButton(el('rules-upload-open'), v.upload);
    renderButton(el('rules-undo-open'), v.undo);
    // One description per row; a disabled button's row carries its reason (the view decides which).
    el('rules-download-note').textContent = v.rowNotes.download;
    el('rules-upload-note').textContent = v.rowNotes.upload;
    el('rules-undo-reason').textContent = v.rowNotes.undo;
    el('rules-file-note').textContent = v.note;
    el('rules-file-last').hidden = v.lastWrite === null;
    el('rules-file-last').textContent = v.lastWrite ?? '';
    rulesWord = body.replaceWord;
  } catch (error) {
    rulesFileMessage(`Could not reach the app: ${error}`);
  }
}

function hideRulesConfirm() {
  el('rules-confirm').hidden = true;
  rulesToken = null;
}

function showRulesConfirm(body) {
  rulesToken = body.token;
  renderComparisonPanel('rules', body.view.panel);
  const confirm = body.view.confirm;
  rulesWordNeeded = confirm.needsWord;
  el('rules-word-row').hidden = !confirm.needsWord;
  el('rules-word-reason').textContent = confirm.reason ?? '';
  el('rules-word').textContent = confirm.word;
  el('rules-typed').value = '';
  el('rules-go').textContent = confirm.applyLabel;
  el('rules-go').disabled = confirm.needsWord;
  el('rules-confirm').hidden = false;
  (confirm.needsWord ? el('rules-typed') : el('rules-go')).focus();
}

el('rules-download').addEventListener('click', async () => {
  rulesFileMessage(null);
  const r = await fetch('/api/rules/file');
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    rulesFileMessage(body.error ?? 'The rules file could not be downloaded.');
    return;
  }
  rulesBaseHash = r.headers.get('x-rules-hash');
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'rules.json';
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

el('rules-upload-open').addEventListener('click', () => {
  rulesFileMessage(null);
  el('rules-upload-file').value = '';
  el('rules-upload-file').click();
});

/** The upload is the file's TEXT (text/plain), with the base hash in a header. Nothing is written until confirm. */
el('rules-upload-file').addEventListener('change', async () => {
  const file = el('rules-upload-file').files?.[0];
  if (!file) return;
  hideRulesConfirm();
  const headers = { ...INGEST_HEADERS, 'content-type': 'text/plain' };
  if (rulesBaseHash) headers['x-rules-base-hash'] = rulesBaseHash;
  try {
    const r = await fetch('/api/rules/upload', { method: 'POST', headers, body: await file.text() });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = Array.isArray(body.errors) && body.errors.length > 0 ? ` — ${body.errors.slice(0, 3).join('; ')}` : '';
      rulesFileMessage(`${body.error ?? 'The file was refused.'}${detail}`);
      return;
    }
    showRulesConfirm(body);
  } catch (error) {
    rulesFileMessage(`Upload failed: ${error}`);
  }
});

el('rules-undo-open').addEventListener('click', async () => {
  rulesFileMessage(null);
  hideRulesConfirm();
  const r = await fetch('/api/rules/undo', { method: 'POST', headers: INGEST_HEADERS });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    rulesFileMessage(body.error ?? 'Nothing to undo yet.');
    return;
  }
  showRulesConfirm(body);
});

// The Apply button stays disabled until the word matches EXACTLY (BR-54.1/54.4).
el('rules-typed').addEventListener('input', () => {
  el('rules-go').disabled = rulesWordNeeded && el('rules-typed').value !== rulesWord;
});

el('rules-cancel').addEventListener('click', hideRulesConfirm);

el('rules-go').addEventListener('click', async () => {
  if (!rulesToken) return;
  el('rules-go').disabled = true;
  const r = await fetch('/api/rules/confirm', {
    method: 'POST',
    headers: { ...INGEST_HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify({ token: rulesToken, typed: rulesWordNeeded ? el('rules-typed').value : null }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    rulesFileMessage(body.error ?? 'The change was not applied.');
    if (body.reason !== 'confirmation-required') hideRulesConfirm();
    el('rules-go').disabled = false;
    return;
  }
  hideRulesConfirm();
  // The file changed: a later upload must be based on a fresh download.
  rulesBaseHash = null;
  rulesFileMessage(body.view.message);
  await refreshRulesFile();
  await loadRules();
});

// -- Credentials --

function credentialMessage(id, text) {
  const m = el(id);
  m.textContent = text ?? '';
  m.hidden = !text;
}

const SPOTIFY_FIELDS = [
  ['clientId', 'sp-client-id'],
  ['clientSecret', 'sp-client-secret'],
  ['redirectUri', 'sp-redirect'],
  ['refreshToken', 'sp-refresh'],
];

function spotifyFormComplete() {
  return SPOTIFY_FIELDS.every(([, id]) => el(id).value.trim() !== '');
}

/** The Save row's text: set from the server's view once loaded; the defaults match it until then. */
let spotifyRowNotes = { saveReady: 'Replaces your current credentials — you will see a warning first.', saveIncomplete: 'Fill in all four fields to save.' };

function updateSpotifySave() {
  const complete = spotifyFormComplete();
  el('sp-save').disabled = !complete;
  el('sp-save-reason').textContent = complete ? spotifyRowNotes.saveReady : spotifyRowNotes.saveIncomplete;
}

function clearSpotifyForm() {
  for (const [, id] of SPOTIFY_FIELDS) {
    el(id).value = '';
    el(id).removeAttribute('aria-invalid');
  }
  updateSpotifySave();
}

async function refreshCredentials() {
  try {
    const r = await fetch('/api/settings/credentials');
    const body = await r.json();
    // U8 (LC-57): rendered only -- the value comes from the server, which reads package.json. Never blank.
    el('app-version').textContent = `Version ${body.appVersion ?? 'unknown'}`;
    if (!r.ok) {
      el('sp-status').textContent = body.error ?? 'Credential settings are unavailable.';
      el('mb-status').textContent = body.error ?? 'Credential settings are unavailable.';
      return;
    }
    const v = body.view;
    el('sp-status').textContent = v.spotify.status;
    el('sp-guidance').replaceChildren(...v.spotify.guidance.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
    el('sp-warning').replaceChildren(...v.spotify.saveWarning.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
    el('sp-fill-note').textContent = v.spotify.rowNotes.fill;
    spotifyRowNotes = v.spotify.rowNotes;
    updateSpotifySave();
    el('mb-status').textContent = v.musicbrainz.status;
    el('mb-note').hidden = v.musicbrainz.note === null;
    el('mb-note').textContent = v.musicbrainz.note ?? '';
  } catch (error) {
    el('sp-status').textContent = `Could not reach the app: ${error}`;
    el('app-version').textContent = 'Version unknown';
  }
}

for (const [, id] of SPOTIFY_FIELDS) el(id).addEventListener('input', updateSpotifySave);

el('sp-fill').addEventListener('click', () => {
  credentialMessage('sp-message', null);
  el('sp-file').value = '';
  el('sp-file').click();
});

/**
 * Reads the file IN THE BROWSER and fills the form (BR-56.1) — the server never receives the file, only the four
 * fields on Save. Missing values are highlighted rather than guessed.
 */
el('sp-file').addEventListener('change', async () => {
  const file = el('sp-file').files?.[0];
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    credentialMessage('sp-message', 'That file is not valid JSON — is it the spotify-config.json that `npm run auth` wrote?');
    return;
  }
  const missing = [];
  for (const [key, id] of SPOTIFY_FIELDS) {
    const value = typeof parsed?.[key] === 'string' ? parsed[key] : '';
    el(id).value = value;
    if (value === '') {
      missing.push(key);
      el(id).setAttribute('aria-invalid', 'true');
    } else {
      el(id).removeAttribute('aria-invalid');
    }
  }
  updateSpotifySave();
  credentialMessage('sp-message', missing.length > 0 ? `The file has no ${missing.join(', ')} — run \`npm run auth\` to produce a complete one.` : null);
});

// Save shows the BR-56.6 warning first; only "Replace credentials" sends anything.
el('sp-save').addEventListener('click', () => {
  if (!spotifyFormComplete()) return;
  el('sp-confirm').hidden = false;
  el('sp-go').focus();
});
el('sp-cancel').addEventListener('click', () => {
  el('sp-confirm').hidden = true;
});

el('sp-go').addEventListener('click', async () => {
  el('sp-go').disabled = true;
  const payload = Object.fromEntries(SPOTIFY_FIELDS.map(([key, id]) => [key, el(id).value.trim()]));
  try {
    const r = await fetch('/api/settings/spotify', {
      method: 'POST',
      headers: { ...INGEST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    el('sp-confirm').hidden = true;
    if (!r.ok) {
      for (const field of body.fields ?? []) {
        const id = SPOTIFY_FIELDS.find(([key]) => key === field)?.[1];
        if (id) el(id).setAttribute('aria-invalid', 'true');
      }
      credentialMessage('sp-message', body.error ?? 'The credentials were not saved.');
      return;
    }
    // ⚠️ Cleared on success: the secrets must not sit in the page after they have been sent.
    clearSpotifyForm();
    credentialMessage('sp-message', 'Saved. Checking with Spotify on the next poll — watch the Spotify indicator.');
    await refreshCredentials();
  } catch (error) {
    credentialMessage('sp-message', `Save failed: ${error}`);
  } finally {
    el('sp-go').disabled = false;
  }
});

el('mb-contact').addEventListener('input', () => {
  el('mb-save').disabled = el('mb-contact').value.trim() === '';
});

el('mb-save').addEventListener('click', async () => {
  el('mb-save').disabled = true;
  try {
    const r = await fetch('/api/settings/musicbrainz', {
      method: 'POST',
      headers: { ...INGEST_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ contact: el('mb-contact').value.trim() }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      credentialMessage('mb-message', body.error ?? 'The contact was not saved.');
      el('mb-save').disabled = false;
      return;
    }
    el('mb-contact').value = '';
    credentialMessage('mb-message', body.restartNeeded ? 'Saved. Label lookups start after the next restart.' : 'Saved. The next MusicBrainz request uses it.');
    await refreshCredentials();
  } catch (error) {
    credentialMessage('mb-message', `Save failed: ${error}`);
    el('mb-save').disabled = false;
  }
});

function wireRulesDialog() {
  const dialog = el('rules');
  const open = el('rules-open');
  const close = el('rules-close');
  const reload = el('rules-reload');
  const matchedOnly = el('decisions-matched-only');
  if (!dialog || !open) return;

  open.addEventListener('click', () => {
    dialog.showModal();
    void loadAutomation();
    void refreshRulesFile();
    void loadRules();
    void loadDecisions();
  });
  close?.addEventListener('click', () => dialog.close());
  matchedOnly?.addEventListener('change', () => void loadDecisions());

  // Re-READS the file — for a hand edit. U7's uploads reload by themselves (the writer calls the same loader).
  reload?.addEventListener('click', async () => {
    reload.disabled = true;
    try {
      await fetch('/api/rules/reload', { method: 'POST' });
      await loadRules();
    } finally {
      reload.disabled = false;
    }
  });
}

wireRulesDialog();
renderStatusBar();

// -- Transport --------------------------------------------------------------

function connect() {
  const socket = new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  );

  socket.addEventListener('message', (event) => {
    try {
      render(JSON.parse(event.data));
    } catch (error) {
      console.error('Malformed message from server', error);
    }
  });

  socket.addEventListener('open', () => setConnectionState('open'));

  socket.addEventListener('close', async (event) => {
    progress.running = false;
    // U11 (BR-93.3): 4401 is the server's *signed out*; any other close asks the session check first, because a
    // browser cannot see the 401 a refused handshake gets. In local mode that check is a 404, so this reconnects.
    const status = needsSessionCheck(event.code) ? await sessionStatus() : null;
    if (onClose(event.code, status) === 'signedOut') {
      enterSignedOut();
      return;
    }
    setState('error', 'Disconnected — reconnecting…');
    // ⚠️ `reconnecting`, not `closed`: a retry is pending, and the two are different facts.
    // `closed` is reserved for a socket with nothing scheduled behind it.
    setConnectionState('reconnecting');
    setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

// -- U11: signed out, and Settings → Access (BR-93, BR-94; frontend-components §3, §4) -----------------------------
//
// ⚠️ DOM WIRING ONLY. The server decides who is signed in and until when (`/auth/session`); the close decision is
// `connectionDecision.js`, which is tested. In local mode `/auth/session` is a 404 and none of this shows.

let signedOut = false;

/** The session check's status, or null if it could not be asked (the server is restarting, say). */
async function sessionStatus() {
  try {
    return (await realFetch('/auth/session', { cache: 'no-store' })).status;
  } catch {
    return null;
  }
}

/** BR-93.3: stop reconnecting, say *Signed out* in words, offer the sign-in, disable what would only fail. */
function enterSignedOut() {
  if (signedOut) return;
  signedOut = true;
  progress.running = false;
  setState('error', 'Signed out');
  setConnectionState('signedOut');
  const banner = el('signed-out-banner');
  const link = el('signed-out-signin');
  link.href = `/auth/sign-in?return=${encodeURIComponent(location.pathname + location.search)}`;
  banner.hidden = false;
  for (const button of document.querySelectorAll('button')) {
    if (button.closest('#signed-out-banner')) continue;
    button.disabled = true;
    button.title = 'Signed out: sign in again first';
  }
}

// An API call answered 401 (server mode, the session ended): the same state as a 4401 close.
const realFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await realFetch(...args);
  if (response.status === 401 && !signedOut) enterSignedOut();
  return response;
};

async function refreshAccess() {
  const section = el('access-section');
  let session = null;
  try {
    const r = await realFetch('/auth/session', { cache: 'no-store' });
    if (r.ok) session = await r.json();
  } catch {
    session = null;
  }
  // Local mode (404) or no session: the section is not drawn at all.
  section.hidden = session === null;
  if (session === null) return;
  el('access-subject').textContent = session.subject;
  el('access-ends').textContent = new Date(session.expiresAt).toLocaleString();
  el('access-origin').textContent = session.publicOrigin;
  el('access-message').textContent = '';
}

async function signOut(path) {
  const message = el('access-message');
  message.textContent = '';
  try {
    const r = await realFetch(path, { method: 'POST', headers: INGEST_HEADERS });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.next) {
      location.href = body.next;
      return;
    }
    message.textContent = body.error ?? `Sign-out did not complete (${r.status}).`;
  } catch {
    message.textContent = 'Sign-out did not complete: the app did not answer.';
  }
}

el('access-sign-out').addEventListener('click', () => void signOut('/auth/sign-out'));
el('access-sign-out-everywhere').addEventListener('click', () => {
  if (window.confirm('This ends every session, on every device, including this one.')) void signOut('/auth/sign-out-everywhere');
});

requestAnimationFrame(paintProgress);
connect();

// -- U10: Settings → Version and Backup & restore (FR-80…82, BR-86) -----------
//
// ⚠️ DOM WIRING ONLY: every judgement (is a version newer, is a page URL this repository's, is a reminder due)
// is made on the server and arrives decided. Text from GitHub is only ever set as textContent.

function shortTime(iso) {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '';
}

function renderUpdateCheck(check) {
  const available = el('update-available');
  const link = el('update-link');
  const newer = check?.status === 'newer' && check.newest;
  available.hidden = !newer;
  el('update-how').hidden = !newer;
  if (newer) {
    link.textContent = `${check.newest.version} is available: what changed`;
    if (check.newest.pageUrl) link.href = check.newest.pageUrl;
    else link.removeAttribute('href');
  }
  el('update-check-switch').checked = check ? check.status !== 'off' : false;
  el('update-check-switch').disabled = !check;
  const parts = [];
  if (check?.status === 'current') parts.push(`Up to date (checked ${shortTime(check.lastSuccessAt)}).`);
  else if (check?.status === 'not-yet') parts.push('Not checked yet.');
  else if (check?.status === 'newer') parts.push(`Checked ${shortTime(check.lastSuccessAt)}.`);
  if (check && check.status !== 'off' && check.lastFailureAt && (!check.lastSuccessAt || check.lastFailureAt > check.lastSuccessAt)) {
    parts.push(`Could not check (${shortTime(check.lastFailureAt)}).`);
  }
  el('update-checked').textContent = parts.join(' ');
}

function renderBackups(backups, reminder) {
  const status = el('backups-status');
  if (backups) {
    const age = (iso) => (iso ? new Date(iso).toLocaleString() : 'none yet');
    status.dataset.level = backups.health.level;
    status.textContent =
      `Automatic backups: newest ${age(backups.scheduled.newestAt)} (${backups.scheduled.count} kept) · before a change: ` +
      `${age(backups.beforeChange.newestAt)} (${backups.beforeChange.count} kept). Kept in ${backups.folder}; to restore one, ` +
      `choose it with Restore backup.` +
      (backups.health.level === 'warn' || backups.health.level === 'fail' ? ` ${backups.health.level === 'fail' ? '✕' : '◐'} ${backups.health.detail}` : '');
  } else {
    status.textContent = '';
  }
  const sw = el('backup-reminder-switch');
  sw.disabled = !reminder;
  sw.checked = reminder ? reminder.enabled : false;
  el('backup-reminder-last').textContent = reminder
    ? (reminder.verdict.level === 'warn' ? `◐ ${reminder.verdict.detail}` : reminder.lastDownloadAt ? `Last downloaded ${reminder.lastDownloadAt.slice(0, 10)}.` : 'No backup downloaded yet.')
    : '';
}

async function refreshSettingsStatus() {
  try {
    const body = await (await fetch('/api/settings/status')).json();
    el('app-version').textContent = `Version ${body.appVersion ?? 'unknown'}`;
    renderUpdateCheck(body.updateCheck);
    renderBackups(body.backups, body.backupReminder);
  } catch (error) {
    el('update-checked').textContent = `Could not reach the app: ${error}`;
  }
}

async function postSwitch(path, enabled) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
}

el('update-check-switch').addEventListener('change', async (event) => {
  try {
    await postSwitch('/api/update-check', event.target.checked);
  } finally {
    void refreshSettingsStatus();
  }
});

el('backup-reminder-switch').addEventListener('change', async (event) => {
  try {
    await postSwitch('/api/backup-reminder', event.target.checked);
  } finally {
    void refreshSettingsStatus();
  }
});
