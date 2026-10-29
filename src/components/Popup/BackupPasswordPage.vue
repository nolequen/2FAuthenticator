<template>
  <div>
    <a-page-header
      :title="i18n.drive_backup_password"
      @back="currentView.back()"
    />
    <div class="page-body">
      <p class="drive-lead">{{ i18n.drive_backup_password_info }}</p>
      <BackupPasswordForm
        class="panel padded"
        :title="
          record?.backupKey
            ? i18n.drive_change_backup_password
            : i18n.drive_set_backup_password
        "
        :password-label="i18n.drive_new_password"
        :repeat-label="i18n.drive_repeat_password"
        :warning="i18n.drive_password_warning"
        :submit-label="i18n.save"
        autofocus
        @saved="saved()"
        @failed="notification.alert(i18n.updateFailure)"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { storeToRefs } from "pinia";
import { resultText } from "../../drive/status";
import { i18n } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import { useNotificationStore } from "../../store/Notification";
import BackupPasswordForm from "../Drive/BackupPasswordForm.vue";

const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const drive = useDriveStore();
const { record } = storeToRefs(drive);

async function saved() {
  const result = await currentView.withBusy(() => drive.backupNow());
  currentView.back();
  if (result?.status === "uploaded" || result?.status === "unchanged") {
    notification.ephermalMessage(resultText(result));
  } else if (result?.status !== "empty") {
    notification.alert(resultText(result));
  }
}
</script>
