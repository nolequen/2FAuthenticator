<template>
  <div @keydown.stop>
    <div class="text">{{ i18n.passphrase_info }}</div>
    <a-text-input
      v-model="password"
      type="password"
      :class="{ badInput: wrongPassword }"
      :autofocus="true"
      @enter="applyPassphrase()"
    />
    <label v-show="wrongPassword" class="warning">{{
      i18n.phrase_not_match
    }}</label>
    <a-button type="small" @click="applyPassphrase()">{{ i18n.ok }}</a-button>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useAccountsStore } from "../../store/Accounts";

const accounts = useAccountsStore();
const { wrongPassword } = storeToRefs(accounts);

const password = ref("");

async function applyPassphrase() {
  await accounts.applyPassphrase(password.value);
  const firstEntry = document.querySelector(
    ".entry[tabindex='0']",
  ) as HTMLElement;
  firstEntry?.focus();
}
</script>
