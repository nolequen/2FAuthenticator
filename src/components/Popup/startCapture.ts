import {
  getCurrentTab,
  injectContentScript,
  okToInjectContentScript,
} from "../../utils";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useNotificationStore } from "../../store/Notification";

export type CaptureResult =
  "started" | "encrypted" | "unsupported" | "file-import" | "failed";

function sendCapture(tabId: number) {
  return new Promise<unknown>((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: "capture" }, (result) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(result);
    });
  });
}

export async function startCapture(): Promise<CaptureResult> {
  const accounts = useAccountsStore();
  const notification = useNotificationStore();

  if (accounts.currentlyEncrypted) {
    notification.alert(i18n.phrase_incorrect);
    return "encrypted";
  }

  const tab = await getCurrentTab();
  if (!tab || !okToInjectContentScript(tab)) {
    notification.alert(i18n.capture_unsupported);
    return "unsupported";
  }

  if (
    tab.url.startsWith("file:") &&
    (await notification.confirm(i18n.capture_local_file_failed))
  ) {
    window.open("import.html?QrImport", "_blank");
    return "file-import";
  }

  try {
    await injectContentScript(tab);
  } catch (error) {
    console.error(error);
    notification.alert(i18n.capture_failed);
    return "failed";
  }

  chrome.runtime.sendMessage({ action: "updateContentTab", data: tab });
  if ((await sendCapture(tab.id)) !== "beginCapture") {
    notification.alert(i18n.capture_failed);
    return "failed";
  }

  window.close();
  return "started";
}
