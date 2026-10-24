/**
 * U11 (frontend-components §2, §3): the pages served without a session — *Sign-in problem* and *Signed out*.
 *
 * ⚙️ PURE: text in, HTML out. Self-contained (one stylesheet, `/auth/auth.css`, which admission lets through), with
 * no script: the app's own `app.js` is behind the session.
 *
 * ⚠️ Every value from outside (the subject, the provider's error code) is escaped. Nothing here ever receives a
 * code, a token or a cookie, so nothing here can show one (BR-89.4).
 */

import type { SignInRefusal } from './ProviderClient.js';

const SENTENCES: Record<SignInRefusal, string> = {
  expired: 'That sign-in took longer than 10 minutes, or was already used. Start again.',
  state: 'That sign-in was started in another browser or tab. Start again here.',
  'provider-error': 'The sign-in provider refused: {error}.',
  'provider-unreachable': 'The sign-in provider cannot be reached. Already signed-in devices are unaffected.',
  'provider-mismatch': "The sign-in provider's address does not match this app's configuration (see Diagnostics).",
  verification: "The sign-in provider's answer could not be verified.",
  'wrong-account': 'Signed in as {subject}. This app admits only its owner\'s account.',
};

export function isSignInRefusal(value: unknown): value is SignInRefusal {
  return typeof value === 'string' && Object.hasOwn(SENTENCES, value);
}

export function problemPage(
  reason: SignInRefusal,
  context: { readonly publicOrigin: string; readonly subject?: string; readonly providerError?: string },
): string {
  const sentence = escapeHtml(SENTENCES[reason])
    .replace('{error}', `<code>${escapeHtml(context.providerError ?? 'unspecified')}</code>`)
    .replace('{subject}', `<strong>${escapeHtml(context.subject ?? '')}</strong>`);
  return page(
    'Sign-in did not complete',
    `<h1>Sign-in did not complete</h1>
<p data-testid="sign-in-problem" data-reason="${reason}">${sentence}</p>
<p><a class="button" href="/auth/sign-in">Try again</a></p>
<p class="note">If your sign-in provider shows its own page and does not come back here, open
<a href="${escapeHtml(context.publicOrigin)}/">${escapeHtml(context.publicOrigin)}</a> again.</p>`,
  );
}

export function signedOutPage(): string {
  return page(
    'Signed out',
    `<h1>Signed out</h1>
<p data-testid="signed-out">You are signed out of this app. Your sign-in provider may still have you signed in, so the
next sign-in can be quick.</p>
<p><a class="button" href="/auth/sign-in">Sign in</a></p>`,
  );
}

export const AUTH_CSS = `:root { color-scheme: light dark; --bg: #ffffff; --fg: #1b1b1b; --muted: #555; --accent: #1a6b3c; }
@media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #ececec; --muted: #b0b0b0; --accent: #57c98a; } }
body { background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem 1rem; }
main { max-width: 36rem; margin: 0 auto; }
.brand { color: var(--muted); font-size: 0.9rem; margin: 0 0 1.5rem; }
h1 { font-size: 1.4rem; margin: 0 0 1rem; }
.note { color: var(--muted); font-size: 0.9rem; }
a { color: var(--accent); }
a.button { display: inline-block; padding: 0.5rem 1rem; border: 2px solid var(--accent); border-radius: 6px; text-decoration: none; font-weight: 600; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Spotify Companion</title>
<link rel="stylesheet" href="/auth/auth.css">
</head>
<body>
<main>
<p class="brand">Spotify Companion</p>
${body}
</main>
</body>
</html>
`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
