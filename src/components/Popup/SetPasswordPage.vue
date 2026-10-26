<template>
  <div>
    <a-page-header :title="i18n.security" @back="currentView.back()" />
    <div class="page-body">
      <div v-if="defaultEncryption" class="status ok">
        <IconShieldCheck />
        <div>
          <div class="status-title">{{ i18n.password_set }}</div>
          <div class="status-text">{{ i18n.password_set_info }}</div>
        </div>
      </div>
      <div v-else class="status neutral">
        <IconShield />
        <div>
          <div class="status-title">{{ i18n.password_not_set }}</div>
          <div class="status-text">{{ i18n.password_not_set_info }}</div>
        </div>
      </div>
      <label v-if="defaultEncryption" class="panel autolock">
        <span class="autolock-label">{{ i18n.autolock }}</span>
        <input
          v-model.number="autolock"
          class="input"
          type="number"
          min="0"
          :aria-label="i18n.autolock_label"
        />
        <span class="autolock-unit">{{ i18n.minutes }}</span>
      </label>
      <div class="panel padded password-form">
        <h2 class="panel-title">
          {{ defaultEncryption ? i18n.change_password : i18n.set_password }}
        </h2>
        <a-text-input
          v-if="defaultEncryption"
          v-model="currentPhrase"
          type="password"
          :aria-label="i18n.current_phrase"
          :placeholder="i18n.current_phrase"
          :error="currentError"
        />
        <a-text-input
          v-model="phrase"
          type="password"
          :aria-label="i18n.new_phrase"
          :placeholder="i18n.new_phrase"
        />
        <a-text-input
          v-model="confirm"
          type="password"
          :aria-label="i18n.confirm_phrase"
          :placeholder="i18n.confirm_phrase"
          :error="confirmError"
          @enter="changePassphrase()"
        />
        <p class="hint">{{ i18n.security_warning }}</p>
        <div class="form-actions">
          <a-button
            id="security-save"
            variant="primary"
            small
            @click="changePassphrase()"
          >
            {{ defaultEncryption ? i18n.save : i18n.set_password }}
          </a-button>
          <a-button
            v-if="defaultEncryption"
            id="security-remove"
            variant="danger-soft"
            small
            @click="removePassphrase()"
          >
            {{ i18n.remove }}
          </a-button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { verifyPassword } from "../../models/keyring";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useMenuStore } from "../../store/Menu";
import { useNotificationStore } from "../../store/Notification";

import IconShield from "lucide-static/icons/shield.svg";
import IconShieldCheck from "lucide-static/icons/shield-check.svg";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const menu = useMenuStore();
const notification = useNotificationStore();
const { defaultEncryption } = storeToRefs(accounts);

const phrase = ref("");
const currentPhrase = ref("");
const confirm = ref("");
const currentError = ref<string>();
const confirmError = ref<string>();

const autolock = computed({
  get: () => menu.autolock,
  set: (autolock: number) => {
    menu.setAutolock(autolock);
    chrome.runtime.sendMessage({ action: "resetAutolock" });
  },
});

async function isCurrentPassword() {
  if (!defaultEncryption.value) {
    return true;
  }
  const isCorrectPassword = await verifyPassword(
    defaultEncryption.value,
    currentPhrase.value,
  );
  currentError.value = isCorrectPassword ? undefined : i18n.phrase_wrong;
  return isCorrectPassword;
}

async function updatePassphrase(password: string) {
  const updated = await currentView.withBusy(async () => {
    try {
      if (!(await isCurrentPassword())) {
        return false;
      }
      await accounts.changePassphrase(password);
      return true;
    } catch (error) {
      console.error(error);
      notification.alert(i18n.updateFailure);
      return false;
    }
  });
  if (updated) {
    currentView.close();
    notification.alert(i18n.updateSuccess);
  }
}

async function removePassphrase() {
  confirmError.value = undefined;
  await updatePassphrase("");
}

async function changePassphrase() {
  if (phrase.value === "") {
    return;
  }

  if (phrase.value !== confirm.value) {
    confirmError.value = i18n.phrase_not_match;
    return;
  }
  confirmError.value = undefined;

  await updatePassphrase(phrase.value);
}
</script>
