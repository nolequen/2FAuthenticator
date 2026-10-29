# Privacy Policy

Effective date: October 29, 2026

2FAuthenticator is a browser extension for Chrome, Edge and Firefox that generates two-factor authentication codes. It is developed in the open at [github.com/nolequen/2FAuthenticator](https://github.com/nolequen/2FAuthenticator).

## In short

- The extension has no server of its own. It collects no analytics or telemetry and shows no ads.
- The developer never receives your accounts, secrets, codes, passwords, Google data or anything else about you.
- Your data leaves the browser only in the cases listed under [What leaves your browser](#what-leaves-your-browser), and each of them is something you start or a setting you can turn off.

## What stays in your browser

- **Accounts**: the issuer, the account name, the secret, the website, the group and the order you set. They are kept in the extension's storage in your browser. If you set an extension password, the secrets are stored encrypted with a key derived from it.
- **Settings**: the theme, the auto-lock time and the other preferences.
- **Google Drive connection**: when you connect Google Drive, the email address of the Google account and the sign-in tokens described below.

If you turn on **Sync via browser**, your accounts are kept in the browser's sync storage instead. The browser then copies them to your other devices through your Google, Microsoft or Mozilla account, under the privacy policy of that browser.

When you scan a QR code, the extension takes a screenshot of the visible part of the current tab and reads the code on your device. The screenshot is not stored or sent anywhere.

When **Autofill** is on, a code you copy is also typed into the active field of the current page, so that website receives the code, as if you had typed it yourself.

Removing the extension deletes all of this data from the browser.

## What leaves your browser

### Google Drive backups

This happens only after you connect Google Drive in **Backup and import**.

- **Access**: the extension asks Google only for the `https://www.googleapis.com/auth/drive.file` permission. It can see and change only the folder and the files it creates itself. It cannot see any other file in your Drive.
- **Account email**: the extension reads the email address of your Google account from the Drive API to show which account is connected. The address is stored only in the extension's storage in your browser.
- **Backup copies**: the extension saves your accounts to the folder `2FAuthenticator` in your Drive, one file per browser and day, named `2fauthenticator-<browser>-<date>.json`. A copy contains only accounts, no settings. The file names and the file labels in Drive show the browser, the date and the number of accounts, never the names of the accounts.
- **Encryption**: every copy is encrypted on your device with the extension password or, if there is none, with a separate backup password. The password never leaves your device. Neither the developer nor Google can read the accounts in a copy.
- **Sign-in tokens**: in Chrome and Edge the extension keeps a short-lived access token from Google in the browser's session storage, which is cleared when the browser closes. In Firefox it also keeps a refresh token in the extension's storage, so it can renew the access without a sign-in window. The tokens are sent only to Google: `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`.
- **Firefox permission**: Firefox asks you to allow the transfer of authentication information when you connect, because the extension sends these sign-in tokens to Google. They go only to Google, never to the developer.

**Disconnect** revokes the extension's access at Google and deletes the tokens and the email address from the extension. **Delete all** in the options does the same. You can also remove the access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). The copies stay in your Drive until you delete them there. The extension keeps the last 30 copies of each browser and moves older ones to the Drive trash.

2FAuthenticator's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. The data received from Google is used only to save and restore your backup copies. It is not transferred to anyone, not used for advertising, not used to train AI models and not read by people.

### Clock check

Codes depend on the time, so the extension can compare your clock with Google's. This happens only after you choose **Sync clock** and allow it: from then on, the extension sends a request to `https://www.google.com/generate_204` when you choose **Sync clock** and each time the popup opens, and reads only the time from the answer. The request carries no account data. Google receives it like any request from your browser, with your IP address and browser details.

### Website icons

When **Website icons** is on, which is the default, the popup shows the icon of each account's website. It loads the icon directly from that website (`https://<website>/favicon.ico`), so the website receives a request from your browser, with your IP address and browser details, as on any visit. No account data is sent. You can turn website icons off in the settings, for all accounts or for one account.

## Sharing

The developer does not sell, rent or share your data, because the developer never receives it. Apart from the cases above, the extension sends nothing anywhere.

## Changes to this policy

Changes are published in this file in the repository, and the file history shows every change. A change that lets more data leave your browser will be described in the release notes.

## Contact

Ask questions in [GitHub Issues](https://github.com/nolequen/2FAuthenticator/issues). Report security problems privately as described in [SECURITY.md](SECURITY.md).
