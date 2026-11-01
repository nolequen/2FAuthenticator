import { isAndroid } from "./browser";

const NEW_TAB_LINK = "a[target='_blank']:not([download])";

export function markAndroid() {
  if (isAndroid) {
    document.documentElement.classList.add("android");
  }
}

export async function openTab(url: string) {
  await chrome.tabs.create({ url });
  if (isAndroid) {
    window.close();
  }
}

export function openInTab(event: MouseEvent) {
  const link =
    event.target instanceof Element ? event.target.closest(NEW_TAB_LINK) : null;
  if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented) {
    return;
  }
  event.preventDefault();
  openTab(link.href);
}

export function openLinksInTabs() {
  if (isAndroid) {
    document.addEventListener("click", openInTab);
  }
}
