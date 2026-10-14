# Security

## Reporting a vulnerability

Please report it **privately**, not in a public issue: on this repository's
**Security** tab, choose **Report a vulnerability**. That opens a private advisory
only the maintainer can see.

Say what you found, how to reproduce it, and what it lets someone do. You should hear
back within a week. Please give a fix a reasonable time before you talk about the
issue publicly.

## What is in scope

Danmu runs entirely in the browser. It has no backend and no accounts, so most server
risks do not apply. The places worth looking are where outside data or the user's own
secrets meet the app:

- **Room files** (`lib/scene-file.ts`). They are the only bytes the app parses that
  someone else produced.
- **The optional Gemini key.** It stays in the user's own browser (localStorage) and
  is sent only to Google's API, directly. Any path that leaks it, logs it or sends it
  anywhere else is a vulnerability.
- **Photos.** Room captures stay on the device (IndexedDB) and are never included in a
  saved room file.
- **The Content-Security-Policy and Permissions-Policy** in `next.config.mjs`, and the
  service worker in `public/sw.js`.

## Supported versions

Only the latest `main`, and the site deployed from it, gets fixes.
