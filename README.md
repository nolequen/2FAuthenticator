# 2FAuthenticator

2FAuthenticator generates two-factor authentication codes in your browser.

## About

2FAuthenticator is a fork of [Authenticator](https://github.com/Authenticator-Extension/Authenticator) by Authenticator Extension, based on version 8.0.2 and distributed under the [MIT License](LICENSE).

How it differs from the original:

- its own name and extension ID in Chrome, Edge and Firefox;
- backups go to a file or to your own Google Drive, always encrypted; Dropbox and OneDrive backups are gone;
- the interface is in English and Russian only;
- no Advisor, browser context menu, permissions page, enterprise policies or Steam and Battle.net account types;
- bug fixes.

## Installation

Download the files from the [latest release](https://github.com/nolequen/2FAuthenticator/releases/latest).

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

### Firefox for Android

1. Download `2fauthenticator-<version>-firefox.xpi` on the phone: it is the same file as for Firefox on a computer.
2. In Firefox, open **Settings** > **About Firefox** and tap the Firefox logo five times to turn on the debug menu.
3. Go back to **Settings**, choose **Install extension from file** and pick the downloaded file.

To open the extension, open any web page and choose **Extensions** > **2FAuthenticator** in the Firefox menu. On the phone the extension shows the accounts of one of your computer browsers from Google Drive: see [On a phone](#on-a-phone). To update, install the newer `.xpi` the same way.

### Verifying a download

Each release has `SHA256SUMS.txt` with the SHA-256 checksum of every package. In PowerShell:

```powershell
Get-FileHash .\2fauthenticator-<version>-firefox.xpi
```

Compare the hash with the line for that file in `SHA256SUMS.txt`. On Linux, run `sha256sum -c SHA256SUMS.txt --ignore-missing` in the download folder, on macOS compare with the output of `shasum -a 256 <file>`.

### Moving from Authenticator

2FAuthenticator is a separate extension with its own storage: it does not see the accounts of Authenticator, and installing it changes nothing in Authenticator. To move your accounts, open **Backup** in Authenticator and download a backup file, then open **Backup** in 2FAuthenticator, click **Import Backup** and choose the file. If you set a password in Authenticator, use **Download Password-Protected Backup** and enter that password when importing. Otherwise **Download Backup File** saves all your secrets as plain text: delete the file right after the import. A password-protected backup made by Authenticator older than 8.0 does not import: import it into Authenticator and download the backup again.

## Google Drive backups

**Backup and import** > **Connect Google Drive** opens a tab where you sign in to Google. After that the extension keeps an encrypted copy of your accounts in the folder `2FAuthenticator` in your Drive:

- the copy is updated a minute after you add, change, reorder or delete an account, and **Save now** updates it at once;
- each browser writes one file a day, `2fauthenticator-<browser>-<date>.json`, and keeps its last 30 files; older files go to the Drive trash;
- the copy is always encrypted: with the extension password, or, when there is none, with a separate backup password that you set when you connect. Without that password the copies cannot be restored, and it cannot be reset;
- only accounts go into the copy, no settings. The file names and labels in Drive show the browser, the date and the number of accounts, never the names of the accounts;
- the extension asks Google only for access to the files it creates itself (`drive.file`): it does not see any other file in your Drive.

**Restore** in the Google Drive section lists the copies of all your browsers. A copy can also be downloaded from drive.google.com and imported as a file with **Import**.

**Disconnect** forgets the sign-in in this browser only: the access of the extension in your Google account and the copies in Drive stay. **Delete all** in the extension options disconnects Google Drive too. **Sign out on all devices** in Firefox revokes the access of the extension at Google and then disconnects: Firefox on every computer and phone connected to this Google account has to sign in again. Chrome and Edge sign in to Google separately, and there the button is **Sign out of all Chrome and Edge**. To remove every access at once, use [myaccount.google.com/connections](https://myaccount.google.com/connections). In Firefox the extension asks for the permission to transfer data when you connect; Chrome and Edge ask for no extra permission.

### On a phone

Firefox for Android keeps no accounts of its own. It shows the accounts of one of your computer browsers from its copies in Google Drive and never uploads anything.

1. Connect Google Drive in that browser on the computer first.
2. On the phone, open the extension and tap **Connect**. Allow what Firefox asks for: the transfer of sign-in data, and access to `127.0.0.1`, where Google returns after the sign-in.
3. Sign in to the same Google account, choose the browser and enter the password of its copy: the extension password on that computer or the backup password.

After that the phone replaces its whole list with each newer copy of that browser, including deletions, order and groups: when the popup opens, once an hour and with **Update now**. **Change browser** picks another source. If the computer changes the password, the phone asks for the new one. If a copy has fewer than half of the phone's accounts, the phone asks before applying it.

On the phone the codes open without a password: the phone keeps the key of the copy, so the screen lock of the phone protects them. You cannot add, edit, reorder or delete accounts there, scan QR codes, import or export, set a password or show the next HOTP code: make changes on the computer. Tapping an account copies the code and closes the popup. **Disconnect** on the phone also removes its accounts.

If you lose the phone, click **Sign out on all devices** in Firefox on the computer, or remove the access of 2FAuthenticator at [myaccount.google.com/connections](https://myaccount.google.com/connections), and connect the computer again. This does not erase the accounts already on the phone, and the phone keeps the key that opens your older copies: change the extension password or the backup password on the computer, and re-issue two-factor secrets if someone may have used the phone.

## Privacy

The extension has no server and collects no analytics. What it sends, where and when is described in the [privacy policy](PRIVACY.md).

## Building

You need Node.js 24 and npm. The commands work in PowerShell on Windows as well as on Linux and macOS.

```
npm ci
npm run chrome
npm run firefox
npm run edge
```

Each command builds the extension into the `chrome/`, `firefox/` or `edge/` folder. `npm run prod` builds all three into `release/`. The package submitted to addons.mozilla.org is the `release/firefox` folder built by `npm ci` and `npm run prod`.

Google Drive in Firefox needs the secret of the Desktop OAuth client in `secrets/google-oauth.json` (`{"desktopClientSecret": "..."}`) or in the `DRIVE_DESKTOP_SECRET` environment variable. The folder is ignored by git; without the secret the Firefox build shows Google Drive as unavailable. Chrome and Edge do not use it.

`npm test` rebuilds the test build and runs the tests in headless Chrome started by Puppeteer.

`npm run lint` checks the code style, `npm run format` fixes it.

## Development

`npm run dev:chrome` and `npm run dev:firefox` rebuild the extension into `chrome/` or `firefox/` on every change.

`npm run start:firefox` starts Firefox with a temporary profile and the extension from `firefox/`. Run it together with `npm run dev:firefox` in a second terminal.

Changes reach `main` only through pull requests merged with squash. CI checks every pull request: style, the three builds, the tests and the update from the latest release in Chrome and in Firefox Developer Edition.

The update check installs the old package in a fresh browser profile, adds test accounts, sets a password, installs the new package over it and checks the accounts, the password and the backup page:

```
npm run update-check -- chrome <old .zip> <new folder or .zip>
npm run update-check -- firefox <old .xpi> <new folder or .xpi>
```

When both packages have the same version, the new one is installed as `<version>.1`. Firefox has to accept unsigned add-ons, so the check uses Firefox Developer Edition of the version in `.github/firefox-devedition-version`: install it with `npx puppeteer browsers install firefox@devedition_<version>`, or set `UPDATE_CHECK_FIREFOX` to another Firefox that accepts unsigned add-ons. The steps in the old version follow the interface of the latest release; when a change moves the menu or the password form, keep a branch for the old interface in `scripts/update-check.mjs` until the next release.

## Releasing

The version lives only in `package.json`, the build writes it into the manifests. Firefox builds are signed on addons.mozilla.org (AMO) as unlisted. The **Release** workflow in GitHub Actions builds, checks and signs a release when a version tag is pushed.

1. In a branch from `main`, bump the version, update the date in `PRIVACY.md` if the policy changed, and open a pull request titled `release X.Y.Z`:

   ```powershell
   npm version 9.4.0 --no-git-tag-version
   git commit -am "release 9.4.0"
   ```

   Merge it with squash when CI is green.

2. Tag the commit the pull request left in `main`. Take it from the pull request, not from the tip of `main`, which may have moved on. Write the release notes into `notes.md` first: the tag message becomes the release notes, and `--cleanup=whitespace` keeps the Markdown lines that start with `#`.

   ```powershell
   git fetch origin
   $commit = gh pr view <number> --json mergeCommit --jq .mergeCommit.oid
   git log --oneline v9.3.0..$commit
   git tag -a v9.4.0 $commit -F notes.md --cleanup=whitespace
   git push origin v9.4.0
   ```

3. The workflow checks the tag (annotated, with a message, on `main`, named after the version in `package.json`, newer than the latest release), runs the tests, builds the packages, checks the update from the latest release in Chrome and Firefox Developer Edition, signs the Firefox package on AMO and creates a draft release with the five files and the notes. It takes about 20 minutes.
4. Open the draft, check it and click **Publish release** with **Set as the latest release** on. Firefox finds updates through `releases/latest/download/updates.json`, so every release needs its own `updates.json` and must be the latest release, not a draft or a pre-release. After publishing, the workflow checks that `updates.json` offers the new version with the hash of the published `.xpi`; if not, GitHub emails you about the failed run.

If the workflow fails before the **Sign** job, delete the tag (`git tag -d v9.4.0`, `git push origin :refs/tags/v9.4.0`), fix the problem in a pull request and tag the new commit. Once **Sign** has started, AMO may already have the version, and it accepts every version number only once: use **Re-run failed jobs** only. `npm run sign` finds a version AMO already has, uploads its source code if it is missing, downloads the signed file and checks it against the build. **Re-run all jobs** would build the packages again. If the draft cannot be created at all, take the five files from the `release-files` artifact of the run and create the release by hand.

**Run workflow** on the **Release** workflow starts a dry run from `main`. It goes through every step without submitting anything to AMO: the tag checks on an optional throwaway annotated tag whose name does not start with `v`, the tests, the build, both update checks from the latest release to `main`, `npm run sign -- --dry-run` (it finds the latest version on AMO, checks that it has its source code and that its signed file matches the GitHub release), and a draft that is created and deleted. Run it after changing the workflow or `scripts/package.js` and after updating puppeteer or `.github/firefox-devedition-version`.

One-time setup in the repository settings:

1. **Environments**: environment `amo` with deployment branches and tags limited to the tag `v*` and the branch `main`, and the secrets `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret) from AMO **Developer Hub** > **Manage API Keys**.
2. **Secrets and variables** > **Actions**: repository secret `DRIVE_DESKTOP_SECRET` with the `desktopClientSecret` of `secrets/google-oauth.json`.
3. **Rules** > **Rulesets**: a tag ruleset for `v*` that restricts creations, updates and deletions, with the Repository admin role allowed to bypass it.
4. **General** > **Pull Requests**: only **Allow squash merging**, with **Pull request title** as the default message, and **Automatically delete head branches**.
5. **Rules** > **Rulesets**: a branch ruleset for the default branch with **Restrict deletions**, **Block force pushes**, **Require a pull request before merging** (no approvals, squash only) and **Require status checks to pass** with the seven checks of the CI workflow (`Style checks`, `Build chrome`, `Build firefox`, `Build edge`, `Run tests`, `Update check chrome`, `Update check firefox`), without **Require branches to be up to date**, and nobody in the bypass list. Renaming a job of `main.yml` needs the same change in the ruleset.

The AMO key is valid for the whole AMO account, and anyone who can push to this repository can now release a signed update that Firefox installs by itself. Keep two-factor sign-in on GitHub, keep no write tokens you do not need, and regenerate the key in Developer Hub at once if it may have leaked.

`npm run package` and `npm run sign` also work locally as a fallback. Run them only after the release pull request is merged, in a clean checkout of the commit that gets the tag: `npm run sign` refuses a commit that is not in `origin/main`. `npm run package` builds `release/` and puts the Chrome and Edge ZIPs into `artifacts/<version>/`; `npm run sign` asks before submitting, signs the Firefox package and writes the `.xpi`, `updates.json` and `SHA256SUMS.txt` next to them. The key exists only in this PowerShell window and only while `npm run sign` runs:

```powershell
$env:WEB_EXT_API_KEY = Read-Host 'JWT issuer'; $env:WEB_EXT_API_SECRET = [Net.NetworkCredential]::new('', (Read-Host 'JWT secret' -AsSecureString)).Password; try { npm run sign } finally { Remove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue }
```

After a local signing, tag the commit as above and create the release by hand from the five files in `artifacts/<version>/`. Cancel the workflow run the tag starts: it would compare the AMO file with its own build, which is not always byte for byte the same as the local one.

## Acknowledgements

Thanks to the authors and contributors of the original [Authenticator](https://github.com/Authenticator-Extension/Authenticator).
