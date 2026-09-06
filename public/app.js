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
  ui.enrichWarn.hidden = true;
  ui.enrichment.dataset.loading = 'true';
}

function clearTrack() {
  ui.title.textContent = DASH;
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

  ui.title.textContent = data.track ?? DASH;
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
  const artistVerdict = el('artist-label-verdict');
  const names = el('label-names');

  if (!label) {
    verdict.textContent = 'pending';
    verdict.dataset.verdict = 'pending';
    artistVerdict.textContent = DASH;
    names.replaceChildren(muted(DASH));
    return;
  }

  verdict.textContent = label.contested ? `${label.verdict} (contested)` : label.verdict;
  verdict.dataset.verdict = label.verdict;
  verdict.title = label.confidence ? `confidence: ${label.confidence}` : '';

  artistVerdict.textContent = label.artistVerdict ?? DASH;
  if (artistVerdict.dataset) artistVerdict.dataset.verdict = label.artistVerdict ?? '';

  const all = [...(label.names ?? [])];
  names.replaceChildren(
    ...(all.length === 0
      ? [muted(DASH)]
      : all.map((name) => {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = name;
          return tag;
        })),
  );
}

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
 * segment floating above a variable offset cannot be compared by length. `unknown` is a
 * low-chroma neutral with a hatch rather than a third hue: it is not an outcome, it is the
 * absence of an observation trail (every backfilled play has one), and colouring it like a
 * verdict would assert a judgement the data does not contain.
 */

const SERIES = [
  { key: 'completed', label: 'Completed', fill: 'var(--series-completed)' },
  { key: 'skipped', label: 'Skipped', fill: 'var(--series-skipped)' },
  { key: 'unknown', label: 'Unknown', fill: 'url(#hatch-unknown)' },
];

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
    for (const series of SERIES) {
      const value = week.byOutcome[series.key] ?? 0;
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
    `role="img" aria-label="Weekly play counts by outcome. Values are in the table view below.">` +
    `<defs><pattern id="hatch-unknown" width="6" height="6" patternUnits="userSpaceOnUse" ` +
    `patternTransform="rotate(45)">` +
    `<rect width="6" height="6" style="fill:var(--series-unknown)" />` +
    `<line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--series-unknown-line);stroke-width:2" />` +
    `</pattern></defs>` +
    parts.join('') +
    `</svg>`
  );
}

function renderLegend(totals) {
  ui.trendLegend.replaceChildren(
    ...SERIES.map((series) => {
      const item = document.createElement('li');
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      // The hatch is an SVG paint server, so the legend swatch restates it as a CSS gradient of
      // the same two colours rather than trying to reuse the pattern.
      swatch.style.background =
        series.key === 'unknown'
          ? 'repeating-linear-gradient(45deg, var(--series-unknown) 0 2px,' +
            ' var(--series-unknown-line) 2px 4px)'
          : series.fill;
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
  for (const heading of ['Week of', 'Completed', 'Skipped', 'Unknown', 'Total']) {
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
      week.byOutcome.completed,
      week.byOutcome.skipped,
      week.byOutcome.unknown,
      week.total,
    ]) {
      row.insertCell().textContent = value;
    }
  }

  const foot = table.createTFoot().insertRow();
  const label = document.createElement('th');
  label.textContent = 'Total';
  foot.append(label);
  for (const value of [
    totals.completed,
    totals.skipped,
    totals.unknown,
    totals.completed + totals.skipped + totals.unknown,
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
    for (const series of SERIES) {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const name = document.createElement('span');
      name.textContent = series.label;
      const value = document.createElement('span');
      value.textContent = week.byOutcome[series.key];
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

  const totals = { completed: 0, skipped: 0, unknown: 0 };
  let maxTotal = 0;
  for (const week of artist.weeks) {
    for (const key of Object.keys(totals)) totals[key] += week.byOutcome[key] ?? 0;
    if (week.total > maxTotal) maxTotal = week.total;
  }

  if (maxTotal === 0) {
    ui.trendPlot.replaceChildren(muted('First time hearing this artist.'));
    ui.trendLegend.replaceChildren();
    ui.trendTableBody.replaceChildren();
    return;
  }

  // The SVG carries no user-supplied text — only week dates and integers — so building it as
  // markup is safe here. Everything with a name in it goes through textContent above.
  ui.trendPlot.innerHTML = trendSvg(artist.weeks, maxTotal);
  attachTrendTooltip(artist.weeks);
  renderLegend(totals);
  renderTrendTable(artist.weeks, totals);
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
  ui.statPlays.textContent = track === null ? DASH : String(track.totalPlays);
  ui.statFirst.textContent = track === null ? DASH : formatDay(track.firstPlayedAt);
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

  socket.addEventListener('close', () => {
    setState('error', 'Disconnected — reconnecting…');
    progress.running = false;
    setTimeout(connect, 2000);
  });

  socket.addEventListener('error', () => socket.close());
}

requestAnimationFrame(paintProgress);
connect();
