<template>
  <div class="import_code">
    <textarea
      v-model="importCode"
      class="input"
      spellcheck="false"
      :aria-label="i18n.import_otp_urls"
      placeholder="otpauth://totp/...
otpauth://totp/...
otpauth://hotp/...
..."
    ></textarea>
    <label class="checkbox" for="encryptedCode">
      <input id="encryptedCode" v-model="importEncrypted" type="checkbox" />
      {{ i18n.import_text_encrypted }}
    </label>
    <a-text-input
      v-show="importEncrypted"
      v-model="importPassphrase"
      :label="i18n.phrase"
      type="password"
    />
    <div>
      <a-button variant="primary" @click="importBackupCode()">
        {{ i18n.import_action }}
      </a-button>
    </div>
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
  let exportData: { [hash: string]: OTPStorage | Key };
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
}
</script>
