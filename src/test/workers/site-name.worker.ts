import { getSiteName } from "../../utils";

self.onmessage = async (event: MessageEvent<{ tab: chrome.tabs.Tab }>) => {
  const tab = event.data.tab;
  (self as unknown as { chrome: unknown }).chrome = {
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: { query: async () => [tab] },
  };

  try {
    self.postMessage({ siteName: await getSiteName() });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
