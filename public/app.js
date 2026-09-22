/**
 * Receives now-playing updates over a WebSocket (Requirements Q5) and renders them,
 * plus an on-demand diagnostics run against /api/diagnostics.
 *
 * The backend polls the MCP server and pushes; the browser never polls. Progress is
 * interpolated locally between pushes so the bar moves smoothly at 3s push intervals.
 */

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

const STATUS_MARK = { ok: '✓', fail: '✗', skip: '–' };

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
    body.replaceChildren(
      renderTraceLevel('Release level', trace.release),
      renderTraceLevel('Artist level', trace.artist),
    );
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
  { key: 'skipped', label: 'Skipped', fill: 'var(--series-skipped)' },
  // ⚠️ Added 2026-09-21, and drawn SEPARATELY from `Skipped` on purpose. The track played to
  // 81-90% and was then replaced by something the listener did not choose -- 19 of 36 skips on
  // this corpus. Folding it back into `Skipped` tells someone they rejected music they sat
  // through, which is how this was found: the panel showed skips of an artist the listener
  // never skips.
  { key: 'ended-early', label: 'Ended early', fill: 'var(--series-ended-early)' },
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

function formatDay(iso) {
  if (!iso) return DASH;
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
    'Ended early',
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
      week.byBucket['ended-early'],
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
    totals['ended-early'],
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
    ui.statFirst.textContent = formatDay(track.firstPlayedAt);
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
    default:
      return { level: 'unknown', label: 'Connection', detail: 'Not yet attempted.' };
  }
}

function renderStatusBar() {
  const dots = el('statusbar-dots');
  const message = el('statusbar-message');
  if (!dots) return;

  const server = lastServerStatus;
  const indicators = [
    server?.recording ?? { level: 'unknown', label: 'Recording', detail: 'No status yet.' },
    server?.rules ?? { level: 'unknown', label: 'Rules', detail: 'No status yet.' },
    connectionIndicatorView(),
    server?.spotify ?? { level: 'unknown', label: 'Spotify', detail: 'No snapshot yet.' },
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

  // ⚠️ One message, not a list. A bar showing three problems at once reads as broken rather
  // than informative, and the most serious one is what needs acting on.
  const worst = indicators.find((i) => i.level === 'fail');
  if (message) {
    message.hidden = worst === undefined;
    message.textContent = worst === undefined ? '' : worst.detail;
  }
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

function wireRulesDialog() {
  const dialog = el('rules');
  const open = el('rules-open');
  const close = el('rules-close');
  const reload = el('rules-reload');
  const matchedOnly = el('decisions-matched-only');
  if (!dialog || !open) return;

  open.addEventListener('click', () => {
    dialog.showModal();
    void loadRules();
    void loadDecisions();
  });
  close?.addEventListener('click', () => dialog.close());
  matchedOnly?.addEventListener('change', () => void loadDecisions());

  // Re-READS the file. Nothing in U4 writes rules; `./config` stays mounted read-only.
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

  socket.addEventListener('close', () => {
    setState('error', 'Disconnected — reconnecting…');
    progress.running = false;
    // ⚠️ `reconnecting`, not `closed`: a retry is pending, and the two are different facts.
    // `closed` is reserved for a socket with nothing scheduled behind it.
    setConnectionState('reconnecting');
    setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

requestAnimationFrame(paintProgress);
connect();
