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
<script lang="ts">
import Vue from "vue";
import { decryptBackupData } from "../../models/backup";
import { getEntryDataFromOTPAuthPerLine } from "../../models/otpauth";
import { EntryStorage } from "../../models/storage";
import { Encryption } from "../../models/encryption";

export default Vue.extend({
  data: function () {
    return {
      getFilePassphrase: false,
      readFilePassphrase: false,
      importFilePassphrase: "",
    };
  },
  methods: {
    importFile(event: Event, closeWindow: Boolean) {
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
              ? await this.getOldPassphrase()
              : null;
            decryptedFileData = await decryptBackupData(importData, passphrase);
          } catch (e) {
            console.warn(e);
          }
          if (Object.keys(decryptedFileData).length) {
            await EntryStorage.import(
              this.$encryption as Encryption,
              decryptedFileData,
            );
            if (failedCount === 0) {
              alert(this.i18n.updateSuccess);
            } else if (succeededCount) {
              alert(this.i18n.migration_partly_fail);
            } else {
              alert(this.i18n.migration_fail);
            }

            if (closeWindow) {
              window.close();
            }
          } else {
            alert(this.i18n.migration_fail);
            this.getFilePassphrase = false;
            this.importFilePassphrase = "";
          }
        };
        reader.readAsText(target.files[0], "utf8");
      } else {
        alert(this.i18n.migration_fail);
        if (closeWindow) {
          window.close();
        }
      }
      return;
    },
    async getOldPassphrase() {
      this.getFilePassphrase = true;
      while (true) {
        if (this.readFilePassphrase) {
          if (this.importFilePassphrase) {
            this.readFilePassphrase = false;
            break;
          } else {
            this.readFilePassphrase = false;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return this.importFilePassphrase;
    },
  },
});
</script>
