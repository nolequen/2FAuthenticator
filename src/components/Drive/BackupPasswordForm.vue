<template>
  <form class="backup-password-form" @submit.prevent="save()">
    <h2 v-if="title" class="panel-title">{{ title }}</h2>
    <a-text-input
      v-model="password"
      type="password"
      :label="labelled ? passwordLabel : undefined"
      :aria-label="passwordLabel"
      :placeholder="labelled ? undefined : passwordLabel"
      :error="passwordError"
      :autofocus="autofocus"
    />
    <a-text-input
      v-model="repeated"
      type="password"
      :label="labelled ? repeatLabel : undefined"
      :aria-label="repeatLabel"
      :placeholder="labelled ? undefined : repeatLabel"
      :error="repeatError"
    />
    <p class="notice warning">
      <IconTriangle />
      <span>{{ warning }}</span>
    </p>
    <div class="form-actions">
      <a-button variant="primary" :small="!labelled" submit>
        {{ submitLabel }}
      </a-button>
    </div>
  </form>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { BACKUP_PASSWORD_MIN_LENGTH } from "../../drive/config";
import { i18n } from "../../store/i18n";
import { useDriveStore } from "../../store/Drive";

import IconTriangle from "lucide-static/icons/triangle-alert.svg";

defineProps<{
  title?: string;
  passwordLabel: string;
  repeatLabel: string;
  warning: string;
  submitLabel: string;
  labelled?: boolean;
  autofocus?: boolean;
}>();
const emit = defineEmits<{ saved: []; failed: [] }>();

const drive = useDriveStore();
const password = ref("");
const repeated = ref("");
const passwordError = ref<string>();
const repeatError = ref<string>();
let saving = false;

async function save() {
  if (saving) {
    return;
  }
  passwordError.value =
    password.value.length < BACKUP_PASSWORD_MIN_LENGTH
      ? i18n.drive_password_short
      : undefined;
  repeatError.value =
    !passwordError.value && password.value !== repeated.value
      ? i18n.phrase_not_match
      : undefined;
  if (passwordError.value || repeatError.value) {
    return;
  }

  saving = true;
  try {
    if (await drive.setBackupPassword(password.value)) {
      password.value = "";
      repeated.value = "";
      emit("saved");
    } else {
      emit("failed");
    }
  } catch (error) {
    console.error(error);
    emit("failed");
  } finally {
    saving = false;
  }
}
</script>
