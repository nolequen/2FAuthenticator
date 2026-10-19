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
<script lang="ts">
import Vue from "vue";
import { decryptBackupData } from "../../import";
import { getEntryDataFromOTPAuthPerLine } from "../../models/otpauth";
import { EntryStorage } from "../../models/storage";
import { Encryption } from "../../models/encryption";

export default Vue.extend({
  data: function () {
    return {
      importCode: "",
      importEncrypted: false,
      importPassphrase: "",
    };
  },
  methods: {
    async importBackupCode() {
      let exportData: { [hash: string]: OTPStorage | Key } = {};
      let failedCount = 0;
      let succeededCount = 0;
      try {
        exportData = JSON.parse(this.importCode);
      } catch (error) {
        console.warn(error);
        // Maybe one-otpauth-per line text
        const result = await getEntryDataFromOTPAuthPerLine(this.importCode);
        exportData = result.exportData;
        failedCount = result.failedCount;
        succeededCount = result.succeededCount;
      }

      try {
        const passphrase: string | null =
          this.importEncrypted && this.importPassphrase
            ? this.importPassphrase
            : null;
        const decryptedbackupData = await decryptBackupData(
          exportData,
          passphrase
        );

        if (Object.keys(decryptedbackupData).length) {
          await EntryStorage.import(
            this.$encryption as Encryption,
            decryptedbackupData
          );
          if (failedCount === 0) {
            alert(this.i18n.updateSuccess);
          } else if (succeededCount) {
            alert(this.i18n.import_backup_qr_partly_failed);
          } else {
            alert(this.i18n.updateFailure);
          }
          window.close();
        } else {
          alert(this.i18n.updateFailure);
        }
        return;
      } catch (error) {
        throw error;
      }
    },
  },
});
</script>
