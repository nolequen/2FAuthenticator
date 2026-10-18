# 2FAuthenticator

2FAuthenticator generates two-factor authentication codes in your browser.

## About

2FAuthenticator is a fork of [Authenticator](https://github.com/Authenticator-Extension/Authenticator) by Authenticator Extension, based on version 8.0.2 and distributed under the [MIT License](LICENSE).

How it differs from the original:

- its own name and extension ID in Chrome, Edge and Firefox;
- no cloud backups (Google Drive, Dropbox, OneDrive): backups are exported to a file only;
- bug fixes.

## Installation

Download the files from the [latest release](https://github.com/nolequen/Authenticator/releases/latest).

### Firefox

1. Download `2fauthenticator-<version>-firefox.xpi`. The file is signed by Mozilla, so release Firefox keeps it after a restart.
2. Open the file in Firefox, or go to `about:addons`, click the gear button and choose **Install Add-on From File**.

Firefox updates the extension by itself. To check now, click **Check for Updates** under the gear button in `about:addons`. You can also install a newer `.xpi` over the old one: your accounts stay.

### Chrome and Edge

1. Download `2fauthenticator-<version>-chrome.zip` or `2fauthenticator-<version>-edge.zip`.
2. Extract it into a folder you will keep, for example `Documents\2FAuthenticator`. Use the same folder for every update.
3. Open `chrome://extensions` or `edge://extensions`, turn on **Developer mode** and click **Load unpacked**. Choose the folder with `manifest.json`.
4. Check that the extension ID is `fghognhaimenkmcpmohoogammffofkgn`.

To update, delete the old files from the folder, extract the new ZIP into it and click **Reload** on the extension card. Your accounts stay because the extension ID does not change. Do not remove the extension: removing it deletes your accounts. Chrome and Edge do not update unpacked extensions, so watch the repository releases (**Watch** > **Custom** > **Releases**) to hear about new versions.

### Verifying a download

Each release has `SHA256SUMS.txt` with the SHA-256 checksum of every package. In PowerShell:

```powershell
Get-FileHash .\2fauthenticator-<version>-firefox.xpi
```

Compare the hash with the line for that file in `SHA256SUMS.txt`. On Linux, run `sha256sum -c SHA256SUMS.txt --ignore-missing` in the download folder, on macOS compare with the output of `shasum -a 256 <file>`.

### Moving from Authenticator

2FAuthenticator is a separate extension with its own storage: it does not see the accounts of Authenticator, and installing it changes nothing in Authenticator. To move your accounts, open **Backup** in Authenticator and download a backup file, then open **Backup** in 2FAuthenticator, click **Import Backup** and choose the file. If you set a password in Authenticator, use **Download Password-Protected Backup** and enter that password when importing. Otherwise **Download Backup File** saves all your secrets as plain text: delete the file right after the import.

## Building

You need Node.js 24 and npm. The commands work in PowerShell on Windows as well as on Linux and macOS.

```
npm ci
npm run chrome
npm run firefox
npm run edge
```

Each command builds the extension into the `chrome/`, `firefox/` or `edge/` folder. `npm run prod` builds all three into `release/`. The package submitted to addons.mozilla.org is the `release/firefox` folder built by `npm ci` and `npm run prod`.

`npm test` rebuilds the test build and runs the tests in a Chrome window opened by Puppeteer.

`npm run lint` checks the code style, `npm run format` fixes it.

## Development

`npm run dev:chrome` and `npm run dev:firefox` rebuild the extension into `chrome/` or `firefox/` on every change.

`npm run start:firefox` starts Firefox with a temporary profile and the extension from `firefox/`. Run it together with `npm run dev:firefox` in a second terminal.

## Releasing

The version lives only in `package.json`, the build writes it into the manifests. Firefox builds are signed on addons.mozilla.org as unlisted; the API key comes from **Developer Hub** > **Manage API Keys** and never goes into files.

1. Bump the version and commit:

   ```powershell
   npm version 8.1.1 --no-git-tag-version
   git commit -am "release 8.1.1"
   ```

2. Build the packages from the clean commit: `npm ci`, then `npm run package`. It builds `release/`, runs `web-ext lint` and puts the Chrome and Edge ZIPs into `artifacts/<version>/`.
3. Test the builds before signing: load the ZIPs unpacked in Chrome and Edge and run `npx web-ext run --source-dir release/firefox`. addons.mozilla.org accepts every version number only once, so a bug found after signing needs a new version.
4. Sign the Firefox build. The key exists only in this PowerShell window and only while `npm run sign` runs:

   ```powershell
   $env:WEB_EXT_API_KEY = Read-Host 'JWT issuer'
   $env:WEB_EXT_API_SECRET = [Net.NetworkCredential]::new('', (Read-Host 'JWT secret' -AsSecureString)).Password
   try { npm run sign } finally { Remove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue }
   ```

   `npm run sign` uploads `release/firefox` with the source code archive, waits for the signed `.xpi` and writes `updates.json` and `SHA256SUMS.txt` next to the ZIPs. If signing fails, follow the message it prints instead of running it again.
5. Tag the commit that `npm run sign` printed as `v<version>` and push the tag.
6. Create a GitHub release from the tag, attach the five files from `artifacts/<version>/` and keep **Set as the latest release** on. Firefox finds updates through `releases/latest/download/updates.json`, so every release needs its own `updates.json` and must not be a draft or a pre-release.

## Acknowledgements

Thanks to the authors and contributors of the original [Authenticator](https://github.com/Authenticator-Extension/Authenticator).
