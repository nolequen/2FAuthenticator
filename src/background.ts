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

import { startCaptureFromCommand } from "./capture";
import { handleAlarm, handleMessage } from "./backgroundEvents";
import { handleStorageChange, scheduleIfConnected } from "./drive/background";

chrome.runtime.onMessage.addListener(handleMessage);

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm).catch((error) => console.error(error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  handleStorageChange(changes, areaName).catch((error) => console.error(error));
});

chrome.runtime.onStartup.addListener(() => {
  scheduleIfConnected().catch((error) => console.error(error));
});

chrome.runtime.onInstalled.addListener(() => {
  scheduleIfConnected().catch((error) => console.error(error));
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
