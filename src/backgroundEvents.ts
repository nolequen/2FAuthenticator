import { UserSettings } from "./models/settings";
import { handleCaptureMessage, stopCaptureOnAutolock } from "./capture";
import { DRIVE_ALARM, DRIVE_CHECK_ALARM } from "./drive/config";
import {
  backupAfterUnlock,
  handleDriveMessage,
  isDriveMessage,
} from "./drive/background";
import { runBackup } from "./drive/upload";

export function handleMessage(
  message: { action: string; [key: string]: unknown },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) {
  if (isDriveMessage(message)) {
    if (!fromExtensionPage(sender)) {
      return false;
    }
    handleDriveMessage(message).then(sendResponse, (error) => {
      console.error(error);
      sendResponse({ error: "network" });
    });
    return true;
  }

  handleExtensionMessage(message, sender).then(
    () => sendResponse(true),
    (error) => {
      console.error(error);
      sendResponse(false);
    },
  );
  return true;
}

function fromExtensionPage(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url?.startsWith(chrome.runtime.getURL(""))
  );
}

async function handleExtensionMessage(
  message: { action: string; [key: string]: unknown },
  sender: chrome.runtime.MessageSender,
) {
  await UserSettings.updateItems();

  await handleCaptureMessage(message, sender);
  if (message.action === "cachePassphrase") {
    await chrome.storage.session.set({
      cachedPassphrase: message.value as string,
      cachedKeyId: message.keyId as string,
    });
    chrome.alarms.clear("autolock");
    setAutolock();
    await backupAfterUnlock();
  } else if (message.action === "lock") {
    chrome.storage.session.set({ cachedPassphrase: null, cachedKeyId: null });
  } else if (message.action === "resetAutolock") {
    chrome.alarms.clear("autolock");
    setAutolock();
  }
}

export async function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name === DRIVE_ALARM || alarm.name === DRIVE_CHECK_ALARM) {
    await runBackup();
  } else if (alarm.name === "autolock") {
    chrome.storage.session.set({ cachedPassphrase: null, cachedKeyId: null });
    stopCaptureOnAutolock();
    chrome.runtime.sendMessage({ action: "stopImport" });
  }
}

export async function setAutolock() {
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
