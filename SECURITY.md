# Security

## Reporting a vulnerability

Please report it **privately**, not in a public issue: on this repository's
**Security** tab, choose **Report a vulnerability**. That opens a private advisory
only the maintainer can see.

If that button is missing, open an issue asking for a private contact, with no
details of the problem in it.

Say what you found, how to reproduce it, and what it lets someone do. You should hear
back within a week. Please give a fix a reasonable time before you talk about the
issue publicly.

## What is in scope

Danmu runs entirely in the browser. It has no backend and no accounts, so most server
risks do not apply. The places worth looking are where outside data or the user's own
secrets meet the app:

- **Room files** (`lib/scene-file.ts`), which someone else may have produced.
- **Photos as files.** The app reads their metadata itself (`lib/exif.ts`) before
  anything else touches them, so a crafted image is in scope.
- **The optional Gemini key.** It stays in the user's own browser (localStorage) and
  is sent only to Google's API, directly. Any path that leaks it, logs it or sends it
  anywhere else is a vulnerability.
- **Photos.** Room captures are stored on the device (IndexedDB) and never included in
  a saved room file. They leave the device only for the optional Gemini detection,
  only when the user turns it on, and only to Google. Any other way out is a
  vulnerability.
- **The on-device detector** (`lib/local-detect.ts`). Its model files are checked
  against known digests wherever they load from. Its runtime loads from this site
  first and from the jsDelivr CDN only as a fallback, and that fallback carries no
  integrity check, because a dynamic import cannot. It is a known weak point and in
  scope.
- **The Content-Security-Policy and Permissions-Policy** in `next.config.mjs`, and the
  service worker in `public/sw.js`.

## Supported versions

Only the latest `main` gets fixes.
