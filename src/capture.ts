import { importUnderSession } from "./models/session";
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
  const { contentTabId } =
    await chrome.storage.session.get<SessionData>("contentTabId");
  if (contentTabId !== undefined) {
    chrome.tabs
      .sendMessage(contentTabId, { action: "stopCapture" })
      .catch(() => undefined);
    await chrome.storage.session.remove("contentTabId");
  }
}

export async function startCaptureFromCommand() {
  const { cachedPassphrase } = await chrome.storage.session.get<SessionData>();
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
        if (!silent) {
          chrome.tabs.sendMessage(id, { action: "errorenc" });
        }
        return false;
      }

      let failedCount = 0;
      for (const otpUrl of otpUrls) {
        if (!(await getTotp(otpUrl, id, true).catch(() => false))) {
          failedCount++;
        }
      }
      if (failedCount === otpUrls.length) {
        if (!silent) {
          chrome.tabs.sendMessage(id, { action: "migrationfail" });
        }
        return false;
      }

      if (failedCount > 0) {
        if (!silent) {
          chrome.tabs.sendMessage(id, { action: "migrationpartlyfail" });
        }
        return true;
      }

      if (!silent) {
        chrome.tabs.sendMessage(id, { action: "migrationsuccess" });
      }
      return true;
    } else if (text === "error decoding QR Code") {
      if (!silent) {
        chrome.tabs.sendMessage(id, { action: "errorqr" });
      }
      return false;
    } else {
      if (!silent) {
        chrome.tabs.sendMessage(id, { action: "text", text });
      }
      return true;
    }
  } else {
    const result = parseOTPAuthURI(text);
    if ("error" in result) {
      if (result.error === "secret") {
        if (!silent) {
          chrome.tabs.sendMessage(id, {
            action: "secretqr",
            secret: result.secret,
          });
        }
      } else {
        if (!silent) {
          chrome.tabs.sendMessage(id, { action: "errorqr" });
        }
      }
      return false;
    }

    // If the entries are encrypted and we aren't unlocked, error.
    if (!(await importUnderSession({ [result.entry.hash]: result.entry }))) {
      if (!silent) {
        chrome.tabs.sendMessage(id, { action: "errorenc" });
      }
      return false;
    }
    if (!silent) {
      chrome.tabs.sendMessage(id, {
        action: "added",
        account: result.entry.account,
      });
    }
    return true;
  }
}
