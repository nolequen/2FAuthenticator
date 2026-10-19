import Vue from "vue";
import ImportView from "./components/Import.vue";
import CommonComponents from "./components/common/index";
import { loadI18nMessages } from "./store/i18n";

import { Encryption } from "./models/encryption";
import { EntryStorage } from "./models/storage";
import * as CryptoJS from "crypto-js";

async function init() {
  // i18n
  Vue.prototype.i18n = await loadI18nMessages();

  // Load common components globally
  for (const component of CommonComponents) {
    Vue.component(component.name, component.component);
  }

  // Load entries to global
  const cachedSecrets = await getCachedSecrets();
  const encryption = new Encryption(
    cachedSecrets.cachedPassphrase,
    cachedSecrets.cachedKeyId
  );
  const entries = await EntryStorage.get();

  if (encryption.getEncryptionStatus()) {
    for (const entry of entries) {
      await entry.applyEncryption(encryption);
    }
  }

  Vue.prototype.$entries = entries;
  Vue.prototype.$encryption = encryption;

  const instance = new Vue({
    render: (h) => h(ImportView),
  }).$mount("#import");

  // Set title
  try {
    document.title = instance.i18n.extName;
  } catch (e) {
    console.error(e);
  }
}

init();

async function getCachedSecrets() {
  const { cachedPassphrase, cachedKeyId } = await chrome.storage.session.get();

  return { cachedPassphrase, cachedKeyId };
}

export async function decryptBackupData(
  backupData: { [hash: string]: OTPStorage | Key },
  passphrase: string | null
) {
  const decryptedBackupData: { [hash: string]: RawOTPStorage } = {};
  const keys: Map<string, string | null> = new Map();
  for (const hash in backupData) {
    const unknownStorageItem = backupData[hash];
    if (
      typeof unknownStorageItem !== "object" ||
      unknownStorageItem.dataType === "Key"
    ) {
      continue;
    }
    let storageItem: RawOTPStorage;
    if (unknownStorageItem.dataType === "EncOTPStorage") {
      if (!passphrase) {
        continue;
      }

      if (!keys.has(unknownStorageItem.keyId)) {
        keys.set(
          unknownStorageItem.keyId,
          await findAndUnlockKey(
            backupData,
            unknownStorageItem.keyId,
            passphrase
          )
        );
      }
      const decryptKey = keys.get(unknownStorageItem.keyId);
      if (!decryptKey) {
        // wrong password for key
        continue;
      }

      storageItem = {
        ...unknownStorageItem,
        ...JSON.parse(
          CryptoJS.AES.decrypt(unknownStorageItem.data, decryptKey).toString(
            CryptoJS.enc.Utf8
          )
        ),
        encrypted: false,
      };
    } else {
      storageItem = unknownStorageItem;
    }
    if (!storageItem.secret || storageItem.encrypted) {
      continue;
    }
    decryptedBackupData[hash] = storageItem;
  }
  return decryptedBackupData;
}

async function findAndUnlockKey(
  importData: { [key: string]: OTPStorage | Key },
  keyId: string,
  password: string
): Promise<string | null> {
  if (!(keyId in importData)) {
    return null;
  }

  const key = importData[keyId];
  if (key.dataType !== "Key" || key.id !== keyId) {
    return null;
  }

  const rawHash = await new Promise((resolve: (value: string) => void) => {
    const iframe = document.getElementById("argon-sandbox");
    const message = {
      action: "hash",
      value: password,
      salt: key.salt,
    };
    if (iframe) {
      window.addEventListener("message", (response) => {
        resolve(response.data.response);
      });
      // @ts-expect-error bad typings
      iframe.contentWindow.postMessage(message, "*");
    }
  });

  // https://passlib.readthedocs.io/en/stable/lib/passlib.hash.argon2.html#format-algorithm
  const possibleHash = rawHash.split("$")[5];
  if (!possibleHash) {
    throw new Error("argon2 did not return a hash!");
  }

  // verify user password by comparing their password hash with the
  // hash of their password's hash
  const isCorrectPassword = await new Promise(
    (resolve: (value: string) => void) => {
      const iframe = document.getElementById("argon-sandbox");
      const message = {
        action: "verify",
        value: possibleHash,
        hash: key.hash,
      };
      if (iframe) {
        window.addEventListener("message", (response) => {
          resolve(response.data.response);
        });
        // @ts-expect-error bad typings
        iframe.contentWindow.postMessage(message, "*");
      }
    }
  );

  if (!isCorrectPassword) {
    return null;
  }

  return possibleHash;
}
