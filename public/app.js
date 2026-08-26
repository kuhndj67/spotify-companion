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

  // Build via DOM rather than innerHTML — this text comes from an API response.
  if (data.genres?.length) {
    ui.genres.replaceChildren(
      ...data.genres.map((genre) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = genre;
        return tag;
      }),
    );
  } else {
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = data.genresUnavailableReason ?? 'none listed';
    ui.genres.replaceChildren(note);
  }

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

  ui.raw.textContent = data.raw ?? '';
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

el('diag-open').addEventListener('click', () => {
  ui.diag.showModal();
  runDiagnostics();
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
