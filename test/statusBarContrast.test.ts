/**
 * The status bar's labels must be readable in BOTH colour schemes (issue #14, 2026-10-21).
 *
 * `.statusbar` has a fixed near-black background whatever the page's scheme. Its labels (`.status-dot .text`) set no
 * colour, so they show whatever `.statusbar` gives them. With no `color` of its own, the bar passed on the page's
 * `--text`, which in the light scheme is near-black: the labels vanished and only the coloured glyphs showed. Nobody
 * saw it on the development machine, which runs in dark mode.
 *
 * There is no browser in the suite, so this reads `public/styles.css` and computes what a browser would: the text
 * colour the labels end up with (the bar's own, or else the light-scheme `--text` it would inherit), against the bar's
 * background composited over a white page (the light scheme, the worst case for light text on a translucent bar).
 * WCAG AA for normal text is 4.5:1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'public', 'styles.css'), 'utf8');

type Rgba = [number, number, number, number];

function parseColour(value: string): Rgba {
  const v = value.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1] ?? '', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] === undefined ? 1 : Number(fn[4])];
  throw new Error(`unparsed colour: ${value}`);
}

/** The declarations of the FIRST top-level rule whose selector is exactly `selector`. */
function rule(text: string, selector: string): Record<string, string> {
  const at = text.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'));
  assert.ok(at >= 0, `no ${selector} rule in styles.css`);
  const body = text.slice(text.indexOf('{', at) + 1, text.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries(
    body.split(';').map((d) => d.split(':')).filter((p) => p.length >= 2).map(([k, ...v]) => [k!.trim(), v.join(':').trim()]),
  );
}

const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: Rgba = [255, 255, 255, 1];

/** The label colour against the bar, in the light scheme. */
function labelContrast(stylesheet: string): number {
  const bar = rule(stylesheet, '.statusbar');
  const lightText = rule(stylesheet, ':root')['--text'];
  assert.ok(lightText, 'no light-scheme --text in :root');
  const text = parseColour(bar['color'] ?? lightText);
  const background = over(parseColour(bar['background'] ?? ''), WHITE);
  return contrast(text, background);
}

describe('status-bar labels are readable in the light scheme (issue #14)', () => {
  it('label text against the bar is at least 4.5:1', () => {
    const ratio = labelContrast(css);
    assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}:1`);
  });

  it('positive control: the bar as it was (no color of its own) is reported', () => {
    const before = css.replace(/^ {2}color: #f2f3f5;\r?\n/m, '');
    assert.notEqual(before, css, 'the control did not remove the colour; it proves nothing');
    assert.ok(labelContrast(before) < 4.5, `the pre-fix CSS should fail, got ${labelContrast(before).toFixed(2)}:1`);
  });
});
