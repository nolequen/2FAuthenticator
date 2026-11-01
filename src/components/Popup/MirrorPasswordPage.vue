<template>
  <div>
    <a-page-header
      :title="i18n.drive_copy_password"
      @back="currentView.back()"
    />
    <div class="page-body">
      <p class="drive-lead">{{ i18n.mirror_banner_password_text }}</p>
      <MirrorPasswordForm
        class="panel padded"
        :error="passwordError"
        small
        @submit="submit($event)"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { i18n } from "../../store/i18n";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useDriveStore } from "../../store/Drive";
import MirrorPasswordForm from "../Drive/MirrorPasswordForm.vue";
import { useMirrorUnlock } from "./mirrorUnlock";

const currentView = useCurrentViewStore();
const drive = useDriveStore();
const { openCopy, unlock } = useMirrorUnlock();
const passwordError = ref<string>();

async function submit(password: string) {
  const attention = drive.record?.attention;
  if (attention?.kind !== "mirrorPassword") {
    currentView.close();
    return;
  }
  passwordError.value = undefined;
  const opened = await openCopy(attention.fileId);
  if (opened && !(await unlock(opened.copy, password))) {
    passwordError.value = i18n.drive_wrong_password;
  }
}
</script>
