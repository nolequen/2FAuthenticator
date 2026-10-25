<template>
  <div>
    <div class="text warning">{{ i18n.security_warning }}</div>
    <a-text-input
      v-show="!!defaultEncryption"
      v-model="currentPhrase"
      :label="i18n.current_phrase"
      type="password"
    />
    <a-text-input v-model="phrase" :label="i18n.phrase" type="password" />
    <a-text-input
      v-model="confirm"
      :label="i18n.confirm_phrase"
      type="password"
      @enter="changePassphrase()"
    />
    <a-button id="security-save" @click="changePassphrase()">
      {{ i18n.ok }}
    </a-button>
    <a-button id="security-remove" @click="removePassphrase()">
      {{ i18n.remove }}
    </a-button>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { verifyPassword } from "../../models/keyring";
import { i18n } from "../../store/i18n";
import { useAccountsStore } from "../../store/Accounts";
import { useCurrentViewStore } from "../../store/CurrentView";
import { useNotificationStore } from "../../store/Notification";
import { useStyleStore } from "../../store/Style";

const accounts = useAccountsStore();
const currentView = useCurrentViewStore();
const notification = useNotificationStore();
const styleStore = useStyleStore();
const { defaultEncryption } = storeToRefs(accounts);

const phrase = ref("");
const currentPhrase = ref("");
const confirm = ref("");

async function removePassphrase() {
  currentView.changeView("LoadingPage");

  try {
    if (defaultEncryption.value) {
      const isCorrectPassword = await verifyPassword(
        defaultEncryption.value,
        currentPhrase.value,
      );
      if (!isCorrectPassword) {
        notification.alert(i18n.phrase_not_match);
        currentView.changeView("SetPasswordPage");
        return;
      }
    }

    await accounts.changePassphrase("");
  } catch (error) {
    showFailure(error);
    return;
  }
  notification.alert(i18n.updateSuccess);
  styleStore.hideInfo();
  return;
}

async function changePassphrase() {
  if (phrase.value === "") {
    return;
  }

  if (phrase.value !== confirm.value) {
    notification.alert(i18n.phrase_not_match);
    return;
  }

  currentView.changeView("LoadingPage");

  try {
    if (defaultEncryption.value) {
      const isCorrectPassword = await verifyPassword(
        defaultEncryption.value,
        currentPhrase.value,
      );
      if (!isCorrectPassword) {
        notification.alert(i18n.phrase_wrong);
        currentView.changeView("SetPasswordPage");
        return;
      }
    }

    await accounts.changePassphrase(phrase.value);
  } catch (error) {
    showFailure(error);
    return;
  }
  notification.alert(i18n.updateSuccess);
  styleStore.hideInfo();
  return;
}

function showFailure(error: unknown) {
  console.error(error);
  notification.alert(i18n.updateFailure);
  currentView.changeView("SetPasswordPage");
}
</script>
