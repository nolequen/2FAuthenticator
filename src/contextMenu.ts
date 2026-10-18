import { isFirefox } from "./browser";
import { UserSettings } from "./models/settings";

function openPopupFromContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
) {
  let popupUrl = "view/popup.html?popup=true";
  if (tab && tab.url && tab.title) {
    popupUrl +=
      "&url=" +
      encodeURIComponent(tab.url) +
      "&title=" +
      encodeURIComponent(tab.title);
  }
  let windowType;
  if (isFirefox) {
    windowType = "detached_panel";
  } else {
    windowType = "panel";
  }
  chrome.windows.create({
    url: chrome.runtime.getURL(popupUrl),
    type: windowType as chrome.windows.createTypeEnum,
    height: 400,
    width: 320,
  });

  // https://stackoverflow.com/a/56483156
  return true;
}

export function addContextMenuListener() {
  if (
    chrome.contextMenus &&
    !chrome.contextMenus.onClicked.hasListener(openPopupFromContextMenu)
  ) {
    chrome.contextMenus.onClicked.addListener(openPopupFromContextMenu);
  }
}

export async function updateContextMenu() {
  await UserSettings.updateItems();

  const result = await chrome.permissions.contains({
    permissions: ["contextMenus"],
  });
  if (!result) {
    return;
  }

  addContextMenuListener();
  chrome.contextMenus.removeAll();
  if (UserSettings.items.enableContextMenu === true) {
    chrome.contextMenus.create({
      id: "otpContextMenu",
      title: chrome.i18n.getMessage("extName"),
      contexts: ["all"],
    });
  }
}
