export const i18n: { [key: string]: string } = {};

export function t(key: string, ...substitutions: string[]) {
  return chrome.i18n.getMessage(key, substitutions);
}

export async function loadI18nMessages() {
  return new Promise(
    (
      resolve: (value: { [key: string]: string }) => void,
      reject: (reason: Error) => void,
    ) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.overrideMimeType("application/json");
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            const i18nMessage: I18nMessage = JSON.parse(xhr.responseText);
            for (const key of Object.keys(i18nMessage)) {
              i18n[key] = chrome.i18n.getMessage(key);
            }
            return resolve(i18n);
          }
          return;
        };
        xhr.open("GET", chrome.runtime.getURL("/_locales/en/messages.json"));
        xhr.send();
      } catch (error) {
        if (typeof error === "string" || error === undefined) {
          return reject(Error(error));
        } else if (error instanceof Error) {
          return reject(error);
        } else {
          return reject(Error(String(error)));
        }
      }
    },
  );
}
