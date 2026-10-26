<template>
  <main id="import" class="tab-page">
    <div class="brand">
      <IconApp class="brand-icon" aria-hidden="true" />
      {{ i18n.extName }}
    </div>
    <div>
      <h1>{{ i18n.import_title }}</h1>
      <p class="lead">{{ i18n.otp_backup_inform }}</p>
    </div>
    <template v-if="!shouldShowPassphrase">
      <a-segmented-input
        v-model="importType"
        class="import-tabs"
        :label="i18n.import_source"
        label-hidden
        :options="[
          { value: 'FileImport', label: i18n.import_backup_file },
          { value: 'QrImport', label: i18n.import_backup_qr },
          { value: 'TextImport', label: i18n.import_backup_code },
        ]"
      />
      <section class="card">
        <component :is="pages[importType]" />
        <div v-if="importType !== 'TextImport'" class="notice info">
          <IconInfo />
          <span>{{ i18n.import_google_hint }}</span>
        </div>
      </section>
    </template>
    <div v-else class="notice warning error_password">
      <IconTriangle />
      <span>{{ i18n.import_error_password }}</span>
    </div>
  </main>
</template>
<script setup lang="ts">
import { type Component, onMounted, ref } from "vue";
import FileImport from "./Import/FileImport.vue";
import QrImport from "./Import/QrImport.vue";
import TextImport from "./Import/TextImport.vue";

import IconApp from "../../images/icon.svg";
import IconInfo from "lucide-static/icons/info.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

const props = defineProps<{ entries: OTPEntryInterface[] }>();

const pages: { [name: string]: Component } = {
  FileImport,
  QrImport,
  TextImport,
};

const query = location.search ? location.search.substr(1) : "";
const importType = ref(
  ["FileImport", "QrImport", "TextImport"].includes(query)
    ? query
    : "FileImport",
);
const shouldShowPassphrase = ref(getShouldShowPassphrase(props.entries));

onMounted(() => {
  chrome.runtime.onMessage.addListener((event) => {
    if (event.action === "stopImport") {
      shouldShowPassphrase.value = true;
    }

    // https://stackoverflow.com/a/56483156
    return true;
  });
});

function getShouldShowPassphrase(entries: OTPEntryInterface[]) {
  for (const entry of entries) {
    if (!entry.secret) {
      return true;
    }
  }
  return false;
}
</script>
