<template>
  <div>
    <a-file-input
      button-type="file"
      accept="application/json, text/plain"
      v-if="!getFilePassphrase"
      @change="importFile($event, true)"
      :label="i18n.import_backup_file"
    />
    <div class="import_file_passphrase" v-else>
      <p class="error_password">{{ i18n.passphrase_info }}</p>
      <a-text-input
        :label="i18n.phrase"
        type="password"
        @enter="readFilePassphrase = true"
        v-model="importFilePassphrase"
      />
      <a-button @click="readFilePassphrase = true">{{ i18n.ok }}</a-button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { decryptBackupData } from "../../models/backup";
import { getEntryDataFromOTPAuthPerLine } from "../../models/otpauth";
import { importUnderSession } from "../../models/session";
import { i18n } from "../../store/i18n";

const getFilePassphrase = ref(false);
const readFilePassphrase = ref(false);
const importFilePassphrase = ref("");

function importFile(event: Event, closeWindow: boolean) {
  const target = event.target as HTMLInputElement;
  if (!target || !target.files) {
    return;
  }
  if (target.files[0]) {
    const reader = new FileReader();
    reader.onload = async () => {
      let importData: { [hash: string]: OTPStorage | Key } = {};
      let failedCount = 0;
      let succeededCount = 0;
      try {
        importData = JSON.parse(reader.result as string);
        succeededCount = Object.keys(importData).length;
      } catch (e) {
        console.warn(e);
        const result = await getEntryDataFromOTPAuthPerLine(
          reader.result as string,
        );
        importData = result.exportData;
        failedCount = result.failedCount;
        succeededCount = result.succeededCount;
      }

      let decryptedFileData: { [hash: string]: RawOTPStorage } = {};
      try {
        const passphrase = Object.values(importData).some(
          (entry) => entry.dataType === "EncOTPStorage",
        )
          ? await getOldPassphrase()
          : null;
        decryptedFileData = await decryptBackupData(importData, passphrase);
      } catch (e) {
        console.warn(e);
      }
      if (Object.keys(decryptedFileData).length) {
        if (!(await importUnderSession(decryptedFileData))) {
          alert(i18n.phrase_incorrect);
          target.value = "";
          getFilePassphrase.value = false;
          importFilePassphrase.value = "";
          return;
        }
        if (failedCount === 0) {
          alert(i18n.updateSuccess);
        } else if (succeededCount) {
          alert(i18n.migration_partly_fail);
        } else {
          alert(i18n.migration_fail);
        }

        if (closeWindow) {
          window.close();
        }
      } else {
        alert(i18n.migration_fail);
        getFilePassphrase.value = false;
        importFilePassphrase.value = "";
      }
    };
    reader.readAsText(target.files[0], "utf8");
  } else {
    alert(i18n.migration_fail);
    if (closeWindow) {
      window.close();
    }
  }
  return;
}

async function getOldPassphrase() {
  getFilePassphrase.value = true;
  while (true) {
    if (readFilePassphrase.value) {
      if (importFilePassphrase.value) {
        readFilePassphrase.value = false;
        break;
      } else {
        readFilePassphrase.value = false;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return importFilePassphrase.value;
}
</script>
