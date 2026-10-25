<template>
  <div>
    <!-- File Backup -->
    <div v-if="!defaultEncryption" class="text warning">
      {{ i18n.export_info }}
    </div>
    <div class="text">
      {{ i18n.backup_file_info }}
    </div>
    <div v-if="currentlyEncrypted" class="text warning">
      {{ i18n.phrase_incorrect_export }}
    </div>
    <a-button-link
      v-if="exportOneLineOtpAuthFile"
      download="authenticator.txt"
      :href="exportOneLineOtpAuthFile"
      >{{ i18n.download_backup }}</a-button-link
    >
    <a-button-link
      v-if="!!defaultEncryption && exportEncryptedFile"
      download="authenticator.json"
      :href="exportEncryptedFile"
      >{{ i18n.download_enc_backup }}</a-button-link
    >
    <a-button-link href="import.html">{{ i18n.import_backup }}</a-button-link>
  </div>
</template>
<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { BrowserStorage, EntryStorage } from "../../models/storage";
import { useAccountsStore } from "../../store/Accounts";
import { useStyleStore } from "../../store/Style";

const accounts = useAccountsStore();
const { defaultEncryption, currentlyEncrypted } = storeToRefs(accounts);
const { style } = storeToRefs(useStyleStore());

const exportEncryptedFile = ref("");
const exportOneLineOtpAuthFile = ref("");
let builds = 0;

buildBackupFiles();

watch(
  () => style.value.fadein,
  (shown) => {
    if (shown) {
      buildBackupFiles();
    }
  },
);

onUnmounted(() => {
  builds++;
  revokeBackupFiles();
});

async function buildBackupFiles() {
  const build = ++builds;
  revokeBackupFiles();

  const exportData = (await EntryStorage.getExport(accounts.entries)) as {
    [hash: string]: RawOTPStorage;
  };
  const exportEncData = (await EntryStorage.getExport(
    accounts.entries,
    true,
  )) as { [hash: string]: OTPStorage };
  const keys = (await BrowserStorage.getKeys()).reduce(
    (prev: { [id: string]: Key }, key) => {
      prev[key.id] = key;
      return prev;
    },
    {},
  );

  if (build !== builds) {
    return;
  }
  exportEncryptedFile.value = getBackupFile({ ...exportEncData, ...keys });
  exportOneLineOtpAuthFile.value = getOneLineOtpBackupFile(exportData);
}

function revokeBackupFiles() {
  for (const file of [exportEncryptedFile, exportOneLineOtpAuthFile]) {
    if (file.value) {
      URL.revokeObjectURL(file.value);
      file.value = "";
    }
  }
}

function getBackupFile(entryData: { [hash: string]: OTPStorage | Key }) {
  let json = JSON.stringify(entryData, null, 2);
  // for windows notepad
  json = json.replace(/\n/g, "\r\n");
  return downloadFileUrlBuilder(json);
}

function getOneLineOtpBackupFile(entryData: { [hash: string]: RawOTPStorage }) {
  const otpAuthLines: string[] = [];
  for (const hash of Object.keys(entryData)) {
    const otpStorage = entryData[hash];
    const issuer = otpStorage.issuer
      ? removeUnsafeData(otpStorage.issuer)
      : otpStorage.issuer;
    const account = otpStorage.account
      ? removeUnsafeData(otpStorage.account)
      : otpStorage.account;
    const label = issuer ? issuer + ":" + (account || "") : account || "";
    let type: string;
    if (otpStorage.type === "totp" || otpStorage.type === "hex") {
      type = "totp";
    } else if (otpStorage.type === "hotp" || otpStorage.type === "hhex") {
      type = "hotp";
    } else {
      continue;
    }

    const otpAuthLine =
      "otpauth://" +
      type +
      "/" +
      label +
      "?secret=" +
      otpStorage.secret +
      (issuer ? "&issuer=" + issuer : "") +
      (type === "hotp" ? "&counter=" + otpStorage.counter : "") +
      (type === "totp" && otpStorage.period
        ? "&period=" + otpStorage.period
        : "") +
      (otpStorage.digits ? "&digits=" + otpStorage.digits : "") +
      (otpStorage.algorithm ? "&algorithm=" + otpStorage.algorithm : "");

    otpAuthLines.push(otpAuthLine);
  }

  return downloadFileUrlBuilder(otpAuthLines.join("\r\n"));
}

function downloadFileUrlBuilder(content: string) {
  const blob = new Blob([content], { type: "application/octet-stream" });
  return URL.createObjectURL(blob);
}

function removeUnsafeData(data: string) {
  return encodeURIComponent(data.split("::")[0].replace(/:/g, ""));
}
</script>
