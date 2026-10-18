import { Encryption } from "./models/encryption";
import { EntryStorage, ManagedStorage } from "./models/storage";
import {
  getSiteName,
  getMatchedEntries,
  getCurrentTab,
  okToInjectContentScript,
} from "./utils";
import { CodeState } from "./models/otp";

import { getOTPAuthPerLineFromOPTAuthMigration } from "./models/migration";
import { parseOTPAuthURI } from "./models/otpauth";
import { UserSettings } from "./models/settings";
import { addContextMenuListener, updateContextMenu } from "./contextMenu";

let contentTab: chrome.tabs.Tab | undefined;

chrome.runtime.onMessage.addListener(async (message, sender) => {
  await UserSettings.updateItems();

  if (message.action === "getCapture") {
    if (!sender.tab) {
      return;
    }
    const url = await getCapture(sender.tab);
    if (contentTab && contentTab.id) {
      message.info.url = url;
      chrome.tabs.sendMessage(contentTab.id, {
        action: "sendCaptureUrl",
        info: message.info,
      });
    }
  } else if (message.action === "getTotp") {
    getTotp(message.info);
  } else if (message.action === "cachePassphrase") {
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
  } else if (message.action === "updateContentTab") {
    contentTab = message.data;
  } else if (message.action === "updateContextMenu") {
    updateContextMenu();
  }

  // https://stackoverflow.com/a/56483156
  return true;
});

chrome.alarms.onAlarm.addListener(() => {
  chrome.storage.session.set({ cachedPassphrase: null, cachedKeyId: null });
  if (contentTab && contentTab.id) {
    chrome.tabs.sendMessage(contentTab.id, { action: "stopCapture" });
  }
  chrome.runtime.sendMessage({ action: "stopImport" });

  // https://stackoverflow.com/a/56483156
  return true;
});

async function getCapture(tab: chrome.tabs.Tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });

  return dataUrl;
}

async function getTotp(text: string, silent = false) {
  if (!contentTab || !contentTab.id || !text) {
    return false;
  }
  const id = contentTab.id;

  if (text.indexOf("otpauth://") !== 0) {
    if (text.indexOf("otpauth-migration://") === 0) {
      const otpUrls = getOTPAuthPerLineFromOPTAuthMigration(text);
      if (otpUrls.length === 0) {
        !silent && chrome.tabs.sendMessage(id, { action: "errorenc" });
        return false;
      }

      const getTotpPromises: Array<Promise<boolean>> = [];
      for (const otpUrl of otpUrls) {
        getTotpPromises.push(getTotp(otpUrl, true));
      }

      const getTotpResults = await Promise.allSettled(getTotpPromises);
      const failedCount = getTotpResults.filter((res) => !res).length;
      if (failedCount === otpUrls.length) {
        !silent && chrome.tabs.sendMessage(id, { action: "migrationfail" });
        return false;
      }

      if (failedCount > 0) {
        !silent &&
          chrome.tabs.sendMessage(id, { action: "migrationpartlyfail" });
        return true;
      }

      !silent && chrome.tabs.sendMessage(id, { action: "migrationsuccess" });
      return true;
    } else if (text === "error decoding QR Code") {
      !silent && chrome.tabs.sendMessage(id, { action: "errorqr" });
      return false;
    } else {
      !silent && chrome.tabs.sendMessage(id, { action: "text", text });
      return true;
    }
  } else {
    const result = parseOTPAuthURI(text);
    if ("error" in result) {
      if (result.error === "secret") {
        !silent &&
          chrome.tabs.sendMessage(id, {
            action: "secretqr",
            secret: result.secret,
          });
      } else {
        !silent && chrome.tabs.sendMessage(id, { action: "errorqr" });
      }
      return false;
    }

    const {
      cachedPassphrase,
      cachedKeyId,
    } = await chrome.storage.session.get();
    const encryption = new Encryption(cachedPassphrase, cachedKeyId);
    if (
      // If the entries are encrypted and we aren't unlocked, error.
      (await EntryStorage.hasEncryptionKey()) !==
      encryption.getEncryptionStatus()
    ) {
      !silent && chrome.tabs.sendMessage(id, { action: "errorenc" });
      return false;
    }
    await EntryStorage.import(encryption, {
      [result.entry.hash]: result.entry,
    });
    !silent &&
      chrome.tabs.sendMessage(id, {
        action: "added",
        account: result.entry.account,
      });
    return true;
  }
}

chrome.commands.onCommand.addListener(async (command: string) => {
  const { cachedPassphrase, cachedKeyId } = await chrome.storage.session.get();

  let tab: chrome.tabs.Tab | undefined;

  switch (command) {
    case "scan-qr":
      if (cachedPassphrase === null || cachedPassphrase === undefined) {
        return;
      }

      tab = await getCurrentTab();
      if (okToInjectContentScript(tab)) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["/dist/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["/css/content.css"],
        });

        contentTab = tab;
        chrome.tabs.sendMessage(tab.id, { action: "capture" });
      }
      break;

    case "autofill":
      tab = await getCurrentTab();
      if (okToInjectContentScript(tab)) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["/dist/content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["/css/content.css"],
        });

        contentTab = tab;

        const siteName = await getSiteName();
        const entries = await EntryStorage.get();
        const encryption = new Encryption(cachedPassphrase, cachedKeyId);
        for (const entry of entries) {
          entry.applyEncryption(encryption);
        }
        const matchedEntries = getMatchedEntries(siteName, entries);

        if (matchedEntries && matchedEntries.length === 1) {
          const entry = matchedEntries[0];

          if (
            entry.code !== CodeState.Encrypted &&
            entry.code !== CodeState.Invalid
          ) {
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
  const enforcedAutolock = Number(
    await ManagedStorage.get("enforceAutolock", false)
  );

  if (enforcedAutolock && enforcedAutolock > 0) {
    chrome.alarms.create("autolock", { delayInMinutes: enforcedAutolock });
    return;
  }

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

addContextMenuListener();
updateContextMenu();
