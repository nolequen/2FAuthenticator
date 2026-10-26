import { Encryption } from "./models/encryption";
import { EntryStorage } from "./models/storage";
import {
  getSiteName,
  getMatchedEntries,
  getCurrentTab,
  injectContentScript,
  okToInjectContentScript,
} from "./utils";
import { isCodeReady } from "./models/otp";

import { UserSettings } from "./models/settings";
import {
  handleCaptureMessage,
  startCaptureFromCommand,
  stopCaptureOnAutolock,
} from "./capture";

chrome.runtime.onMessage.addListener(async (message, sender) => {
  await UserSettings.updateItems();

  await handleCaptureMessage(message, sender);
  if (message.action === "cachePassphrase") {
    chrome.storage.session.set({
      cachedPassphrase: message.value,
      cachedKeyId: message.keyId,
    });
    chrome.alarms.clear("autolock");
    setAutolock();
  } else if (message.action === "lock") {
    chrome.storage.session.set({ cachedPassphrase: null, cachedKeyId: null });
  } else if (message.action === "resetAutolock") {
    chrome.alarms.clear("autolock");
    setAutolock();
  }

  // https://stackoverflow.com/a/56483156
  return true;
});

chrome.alarms.onAlarm.addListener(() => {
  chrome.storage.session.set({ cachedPassphrase: null, cachedKeyId: null });
  stopCaptureOnAutolock();
  chrome.runtime.sendMessage({ action: "stopImport" });

  // https://stackoverflow.com/a/56483156
  return true;
});

chrome.commands.onCommand.addListener(async (command: string) => {
  const { cachedPassphrase, cachedKeyId } =
    await chrome.storage.session.get<SessionData>();

  let tab: chrome.tabs.Tab | undefined;

  switch (command) {
    case "scan-qr":
      await startCaptureFromCommand();
      break;

    case "autofill":
      tab = await getCurrentTab();
      if (okToInjectContentScript(tab)) {
        await injectContentScript(tab);

        const siteName = await getSiteName();
        const entries = await EntryStorage.get();
        const encryption = new Encryption(
          cachedPassphrase ?? "",
          cachedKeyId ?? "",
        );
        for (const entry of entries) {
          await entry.applyEncryption(encryption);
        }
        const matchedEntries = getMatchedEntries(siteName, entries);

        if (matchedEntries && matchedEntries.length === 1) {
          const entry = matchedEntries[0];

          if (isCodeReady(entry.code)) {
            chrome.tabs.sendMessage(tab.id, {
              action: "pastecode",
              code: matchedEntries[0].code,
            });
          }
        }
      }
      break;

    default:
      break;
  }

  // https://stackoverflow.com/a/56483156
  return true;
});

async function setAutolock() {
  // Set default autolock value
  if (UserSettings.items.autolock === undefined) {
    UserSettings.items.autolock = 30;
  }

  if (Number(UserSettings.items.autolock) > 0) {
    chrome.alarms.create("autolock", {
      delayInMinutes: Number(UserSettings.items.autolock),
    });
  }
}
