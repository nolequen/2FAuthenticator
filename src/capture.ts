import { Encryption } from "./models/encryption";
import { EntryStorage } from "./models/storage";
import { getCurrentTab, okToInjectContentScript } from "./utils";
import { getOTPAuthPerLineFromOPTAuthMigration } from "./models/migration";
import { parseOTPAuthURI } from "./models/otpauth";

export async function handleCaptureMessage(
  message: { action: string; info?: unknown; data?: chrome.tabs.Tab },
  sender: chrome.runtime.MessageSender,
) {
  if (message.action === "getCapture") {
    if (!sender.tab || sender.tab.id === undefined) {
      return;
    }
    const id = sender.tab.id;
    const url = await getCapture(sender.tab);
    const info = message.info as { url?: string };
    info.url = url;
    chrome.tabs.sendMessage(id, {
      action: "sendCaptureUrl",
      info,
    });
  } else if (message.action === "getTotp") {
    if (!sender.tab || sender.tab.id === undefined) {
      return;
    }
    await getTotp(message.info as string, sender.tab.id);
  } else if (message.action === "updateContentTab") {
    if (message.data?.id !== undefined) {
      await chrome.storage.session.set({ contentTabId: message.data.id });
    }
  }
}

export async function stopCaptureOnAutolock() {
  const { contentTabId } = await chrome.storage.session.get("contentTabId");
  if (contentTabId !== undefined) {
    chrome.tabs
      .sendMessage(contentTabId, { action: "stopCapture" })
      .catch(() => undefined);
    await chrome.storage.session.remove("contentTabId");
  }
}

export async function startCaptureFromCommand() {
  const { cachedPassphrase } = await chrome.storage.session.get();
  if (
    (cachedPassphrase === null || cachedPassphrase === undefined) &&
    (await EntryStorage.hasEncryptionKey())
  ) {
    return;
  }

  const tab = await getCurrentTab();
  if (okToInjectContentScript(tab)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["/dist/content.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["/css/content.css"],
    });

    await chrome.storage.session.set({ contentTabId: tab.id });
    chrome.tabs.sendMessage(tab.id, { action: "capture" });
  }
}

async function getCapture(tab: chrome.tabs.Tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });

  return dataUrl;
}

async function getTotp(text: string, id: number, silent = false) {
  if (!text) {
    return false;
  }

  if (text.indexOf("otpauth://") !== 0) {
    if (text.indexOf("otpauth-migration://") === 0) {
      const otpUrls = getOTPAuthPerLineFromOPTAuthMigration(text);
      if (otpUrls.length === 0) {
        !silent && chrome.tabs.sendMessage(id, { action: "errorenc" });
        return false;
      }

      const getTotpPromises: Array<Promise<boolean>> = [];
      for (const otpUrl of otpUrls) {
        getTotpPromises.push(getTotp(otpUrl, id, true));
      }

      const getTotpResults = await Promise.allSettled(getTotpPromises);
      const failedCount = getTotpResults.filter(
        (res) => res.status === "rejected" || !res.value,
      ).length;
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

    const { cachedPassphrase, cachedKeyId } =
      await chrome.storage.session.get();
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
