<template>
  <div>
    <a-page-header :title="i18n.backup" @back="currentView.back()" />
    <div class="page-body">
      <h2 class="section-title">{{ i18n.backup_save_header }}</h2>
      <div v-if="currentlyEncrypted" class="notice warning">
        <IconTriangle />
        <span>{{ i18n.phrase_incorrect_export }}</span>
      </div>
      <a
        v-if="!!defaultEncryption && exportEncryptedFile"
        class="option primary"
        download="authenticator.json"
        :href="exportEncryptedFile"
        target="_blank"
      >
        <span class="option-icon"><IconLock /></span>
        <span class="row-text">
          <span class="option-title">{{ i18n.download_enc_backup }}</span>
          <span class="row-subtitle">{{ i18n.download_enc_backup_info }}</span>
        </span>
        <IconDownload class="option-trail" />
      </a>
      <a
        v-if="exportOneLineOtpAuthFile"
        class="option stacked"
        download="authenticator.txt"
        :href="exportOneLineOtpAuthFile"
        target="_blank"
      >
        <span class="option-main">
          <span class="option-icon neutral"><IconFile /></span>
          <span class="row-text">
            <span class="option-title">{{ i18n.download_backup }}</span>
            <span class="row-subtitle">{{ i18n.download_backup_info }}</span>
          </span>
          <IconDownload class="option-trail neutral" />
        </span>
        <span class="notice warning">
          <IconTriangle />
          <span>{{ i18n.export_info }}</span>
        </span>
      </a>
      <h2 class="section-title">{{ i18n.restore_header }}</h2>
      <a class="option" href="import.html" target="_blank">
        <span class="row-text">
          <span class="row-title">{{ i18n.import_backup }}</span>
          <span class="row-subtitle">{{ i18n.import_backup_info }}</span>
        </span>
        <IconExternalLink class="row-trail" />
      </a>
    </div>
  </div>
</template>
<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { BrowserStorage, EntryStorage } from "../../models/storage";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";

import IconLock from "lucide-static/icons/lock.svg";
import IconFile from "lucide-static/icons/file-text.svg";
import IconDownload from "lucide-static/icons/download.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";
import IconExternalLink from "lucide-static/icons/external-link.svg";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const { defaultEncryption, currentlyEncrypted } = storeToRefs(accounts);

const exportEncryptedFile = ref("");
const exportOneLineOtpAuthFile = ref("");
let builds = 0;

buildBackupFiles();

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
