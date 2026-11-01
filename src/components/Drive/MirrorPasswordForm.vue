<template>
  <form class="mirror-password-form" @submit.prevent="submit()">
    <div class="notice warning">
      <IconTriangle />
      <span>{{ i18n.mirror_password_warning }}</span>
    </div>
    <div v-if="existing" class="notice info">
      <IconInfo />
      <span>{{ t("mirror_replace_warning", String(existing)) }}</span>
    </div>
    <a-text-input
      v-model="password"
      type="password"
      :label="i18n.mirror_password_info"
      :error="error"
      autofocus
    />
    <div class="form-actions">
      <a-button variant="primary" :small="small" submit>
        {{ i18n.mirror_show_codes }}
      </a-button>
    </div>
  </form>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { i18n, t } from "../../store/i18n";

import IconInfo from "lucide-static/icons/info.svg";
import IconTriangle from "lucide-static/icons/triangle-alert.svg";

defineProps<{ error?: string; existing?: number; small?: boolean }>();
const emit = defineEmits<{ submit: [password: string] }>();

const password = ref("");

function submit() {
  if (password.value) {
    emit("submit", password.value);
  }
}
</script>
