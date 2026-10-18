# 2FAuthenticator

2FAuthenticator generates two-factor authentication codes in your browser.

## About

2FAuthenticator is a fork of [Authenticator](https://github.com/Authenticator-Extension/Authenticator) by Authenticator Extension, based on version 8.0.2 and distributed under the [MIT License](LICENSE).

How it differs from the original:

- its own name and extension ID in Chrome, Edge and Firefox;
- no cloud backups (Google Drive, Dropbox, OneDrive): backups are exported to a file only;
- bug fixes.

## Installation

Builds will be published on [GitHub Releases](https://github.com/nolequen/Authenticator/releases) starting with the first release.

## Building

You need Node.js 24 and npm. The commands work in PowerShell on Windows as well as on Linux and macOS.

```
npm ci
npm run chrome
npm run firefox
npm run edge
```

Each command builds the extension into the `chrome/`, `firefox/` or `edge/` folder. `npm run prod` builds all three into `release/`.

`npm test` rebuilds the test build and runs the tests in a Chrome window opened by Puppeteer.

`npm run lint` checks the code style, `npm run format` fixes it.

## Development

`npm run dev:chrome` and `npm run dev:firefox` rebuild the extension into `chrome/` or `firefox/` on every change.

`npm run start:firefox` starts Firefox with a temporary profile and the extension from `firefox/`. Run it together with `npm run dev:firefox` in a second terminal.

## Acknowledgements

Thanks to the authors and contributors of the original [Authenticator](https://github.com/Authenticator-Extension/Authenticator).
