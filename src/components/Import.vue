<template>
  <div id="import" class="theme-normal">
    <div v-if="!shouldShowPassphrase">
      <div class="import_tab">
        <input
          type="radio"
          id="import_file_radio"
          value="FileImport"
          v-model="importType"
        />
        <label for="import_file_radio">{{ i18n.import_backup_file }}</label>
        <input
          type="radio"
          id="import_qr_radio"
          value="QrImport"
          v-model="importType"
        />
        <label for="import_qr_radio">{{ i18n.import_backup_qr }}</label>
        <input
          type="radio"
          id="import_code_radio"
          value="TextImport"
          v-model="importType"
        />
        <label for="import_code_radio">{{ i18n.import_backup_code }}</label>
      </div>
      <div>
        <p id="import_info">
          {{ i18n.otp_backup_inform }}
        </p>
      </div>
      <component v-bind:is="pages[importType]" />
    </div>
    <div v-if="shouldShowPassphrase" class="error_password">
      {{ i18n.import_error_password }}
    </div>
  </div>
</template>
<script setup lang="ts">
import { type Component, onMounted, ref } from "vue";
import FileImport from "./Import/FileImport.vue";
import QrImport from "./Import/QrImport.vue";
import TextImport from "./Import/TextImport.vue";

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
