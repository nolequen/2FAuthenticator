<template>
  <div>
    <div class="import_code">
      <textarea
        spellcheck="false"
        v-model="importCode"
        placeholder="otpauth://totp/...
otpauth://totp/...
otpauth://hotp/...
..."
      ></textarea>
    </div>
    <div class="import_encrypted">
      <input type="checkbox" id="encryptedCode" v-model="importEncrypted" />
      <label for="encryptedCode">{{ i18n.encrypted }}</label>
    </div>
    <a-text-input
      :label="i18n.phrase"
      v-model="importPassphrase"
      type="password"
      v-show="importEncrypted"
    />
    <a-button @click="importBackupCode()">
      {{ i18n.import_backup_code }}
    </a-button>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { decryptBackupData } from "../../models/backup";
import { getEntryDataFromOTPAuthPerLine } from "../../models/otpauth";
import { importUnderSession } from "../../models/session";
import { i18n } from "../../store/i18n";

const importCode = ref("");
const importEncrypted = ref(false);
const importPassphrase = ref("");

async function importBackupCode() {
  let exportData: { [hash: string]: OTPStorage | Key } = {};
  let failedCount = 0;
  let succeededCount = 0;
  try {
    exportData = JSON.parse(importCode.value);
  } catch (error) {
    console.warn(error);
    // Maybe one-otpauth-per line text
    const result = await getEntryDataFromOTPAuthPerLine(importCode.value);
    exportData = result.exportData;
    failedCount = result.failedCount;
    succeededCount = result.succeededCount;
  }

  try {
    const passphrase: string | null =
      importEncrypted.value && importPassphrase.value
        ? importPassphrase.value
        : null;
    const decryptedbackupData = await decryptBackupData(exportData, passphrase);

    if (Object.keys(decryptedbackupData).length) {
      if (!(await importUnderSession(decryptedbackupData))) {
        alert(i18n.phrase_incorrect);
        return;
      }
      if (failedCount === 0) {
        alert(i18n.updateSuccess);
      } else if (succeededCount) {
        alert(i18n.import_backup_qr_partly_failed);
      } else {
        alert(i18n.updateFailure);
      }
      window.close();
    } else {
      alert(i18n.updateFailure);
    }
    return;
  } catch (error) {
    throw error;
  }
}
</script>
